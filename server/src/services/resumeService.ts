import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ResumeData } from '../../../shared/resumeTypes.js';
import { ATS_TEMPLATE_IDS } from '../../../shared/resumeTypes.js';
import type { ChatMessage, ChatMessageMeta, ChatOffer, CreateSessionResponse, EditResponse, JobMeta, OfferedProject, ReviewData, SessionOrigin, SessionView, VersionDetail, VersionSource, VersionSummary } from '../../../shared/apiTypes.js';
import { analyzeJobDescriptionDeterministic, isGenericPhrase, mergeJDAnalysis, type JDAnalysis } from '../../../shared/jdAnalyzer.js';
import { scoreResume, type AtsResult } from '../../../shared/ats.js';
import { improvementPlan, planToText } from '../../../shared/improve.js';
import { diffResumes, summarizeChanges, type ResumeChange } from '../../../shared/diff.js';
import { parseResumeText, toIsoMonth } from '../../../shared/heuristicParser.js';
import { blankResume, collectSkills, normalizeResume, normalizeSections, normalizeStyle, resumeToPlainText } from '../../../shared/normalize.js';
import { findKeyword, lexiconEntry, significantTokens, uniqueKeywords } from '../../../shared/match.js';
import { LEXICON } from '../../../shared/lexicon.js';
import type { AppConfig } from '../config.js';
import type { MessageRow, SessionRow, Store, VersionMeta, VersionRow } from '../db/store.js';
import type { AIChain } from '../ai/provider.js';
import { EDIT_SCHEMA, EditOutput, ENTRY_SCHEMA, EntryOutput, GENERATE_SCHEMA, GenerateOutput, JD_SCHEMA, JdOutput, PARSE_SCHEMA, ParseOutput, SEMANTIC_SCHEMA, SemanticOutput, validator } from '../ai/schemas.js';
import { editPrompt, entryPrompt, generatePrompt, jdPrompt, parsePrompt, semanticPrompt } from '../ai/prompts.js';
import { HEADLINE_REMOVED, applyEdit, applyGeneration, isMalformed } from './factGuard.js';
import { localEdit, parseCommand } from './commands.js';
import { ALLOWED_MIME, detectKind, extractAttachment, extractText, sanitizeText } from './extract.js';
import { renderDocx, renderPdf } from './export.js';
import { fitToPages } from './fitPages.js';
import { fetchJobPosting, findUrls } from './fetchJob.js';
import { applyEntry, formatExamples, isAddEntryRequest, sectionProfile } from './addEntry.js';
import { AIUnavailableError, HttpError, badRequest, conflict, notFound, unauthorized } from '../errors.js';
import { logger } from '../logger.js';

export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  size: number;
}

let lastTs = 0;
/** Strictly increasing ISO timestamps so message order is stable. */
function ts(): string {
  const now = Math.max(Date.now(), lastTs + 1);
  lastTs = now;
  return new Date(now).toISOString();
}

const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');
const jdHash = (jd: JDAnalysis | null) => (jd ? sha256(JSON.stringify(jd)).slice(0, 16) : '');

/** A session token (guest, stored in the browser) and/or a verified Firebase uid (signed-in user). */
export type Cred = string | undefined | { token?: string; uid?: string };

/** Resumes in an account are kept for 10 years (until the user deletes them). */
const OWNED_TTL_MS = 3650 * 86_400_000;

/** "SOC Analyst – Deloitte": how automation resumes are named in My resumes. */
export function automationTitle(job: Pick<JobMeta, 'title' | 'company'>): string {
  const clean = (v: string) => v.replace(/s+/g, ' ').trim();
  return [clean(job.title), clean(job.company)].filter(Boolean).join(' – ').slice(0, 120) || 'Automation resume';
}

export type JobInput = { title?: string; company?: string; url?: string; applicationId?: string | null };

export class ResumeService {
  private locks = new Map<string, Promise<unknown>>();

  constructor(
    private store: Store,
    private ai: AIChain,
    private config: AppConfig,
  ) {}

  /** Serialises mutations per session so concurrent requests cannot interleave. */
  private async withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) || Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    const chain = prev.then(() => next);
    this.locks.set(id, chain);
    await prev.catch(() => undefined);
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(id) === chain) this.locks.delete(id);
    }
  }

  // ------------------------------------------------------------------ auth

  async authorize(id: string, cred: Cred): Promise<SessionRow> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
    const { token, uid } = typeof cred === 'object' && cred ? cred : { token: cred as string | undefined, uid: undefined };
    if (!token && !uid) throw unauthorized(this.config.requireAuth ? 'Please sign in to open your resumes.' : undefined);
    const row = await this.store.getSession(id);
    if (!row) throw notFound();
    const ownerOk = !!uid && row.ownerUid === uid;
    let tokenOk = false;
    if (token) {
      const a = Buffer.from(sha256(token), 'hex');
      const b = Buffer.from(row.tokenHash, 'hex');
      tokenOk = a.length === b.length && crypto.timingSafeEqual(a, b);
    }
    // A resume owned by an account opens only for that account; guest resumes open with their token.
    if (row.ownerUid ? !ownerOk : !tokenOk) throw unauthorized(row.ownerUid ? 'This resume belongs to a different account.' : 'This session belongs to a different browser or the token is invalid.');
    if (new Date(row.expiresAt).getTime() < Date.now()) {
      await this.deleteSession(row);
      throw notFound('This resume session has expired.');
    }
    // Sliding expiration, refreshed at most hourly.
    const fresh = Date.now() + (row.ownerUid ? OWNED_TTL_MS : this.config.sessionTtlDays * 86_400_000);
    if (fresh - new Date(row.expiresAt).getTime() > 3_600_000) {
      row.expiresAt = new Date(fresh).toISOString();
      await this.store.updateSession(id, { expiresAt: row.expiresAt });
    }
    return row;
  }

  // ------------------------------------------------------------------ creation

  async createFromUpload(file: UploadedFile, ownerUid: string | null = null): Promise<CreateSessionResponse> {
    this.assertCanCreate(ownerUid);
    const kind = detectKind(file.buffer, file.originalname);
    const text = await extractText(file.buffer, kind);
    const structured = await this.structure(text, kind === 'pdf' ? file.buffer : undefined);
    const safeName = path.basename(file.originalname).replace(/[^\w.\- ]+/g, '_').slice(0, 120) || `resume.${kind}`;
    return this.createSession(text, structured, { name: safeName, mime: ALLOWED_MIME[kind], buffer: file.buffer, ext: kind }, ownerUid);
  }

  async createFromPaste(rawText: string, ownerUid: string | null = null): Promise<CreateSessionResponse> {
    this.assertCanCreate(ownerUid);
    const text = sanitizeText(rawText);
    if (text.replace(/\s/g, '').length < 80) throw badRequest('Please paste your full resume (at least a few lines of text).');
    return this.createSession(text, await this.structure(text), undefined, ownerUid);
  }

  private assertCanCreate(ownerUid: string | null) {
    if (this.config.requireAuth && !ownerUid) throw unauthorized('Please sign in to create a resume.');
  }

  /** Resumes of the signed-in user (for “My resumes” on any device). */
  async listMine(uid: string | undefined, origin?: SessionOrigin) {
    if (!uid) throw unauthorized('Please sign in to see your resumes.');
    const all = await this.store.listSessionsByOwner(uid);
    return origin ? all.filter((r) => r.origin === origin) : all;
  }

  /**
   * Job Apply Agent: copies a resume (its current version, original evidence
   * and confirmed facts, no AI call) into a new automation session named
   * "<Role> – <Company>", ready for a job description and tailoring. The base
   * resume is not changed.
   */
  async cloneForJob(baseId: string, cred: Cred, input: JobInput): Promise<CreateSessionResponse> {
    const base = await this.authorize(baseId, cred);
    const ownerUid = (typeof cred === 'object' && cred?.uid) || null;
    this.assertCanCreate(ownerUid);
    const current = await this.currentVersion(base);
    const job: JobMeta = {
      title: (input.title || '').trim().slice(0, 200),
      company: (input.company || '').trim().slice(0, 200),
      url: (input.url || '').trim().slice(0, 2000),
      applicationId: input.applicationId || null,
      baseResumeId: base.id,
    };
    const id = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString('base64url');
    const now = ts();
    const row: SessionRow = {
      id,
      tokenHash: sha256(token),
      title: automationTitle(job),
      status: 'draft',
      originalFileName: null,
      originalFileMime: null,
      originalFileSize: null,
      originalFilePath: null,
      originalText: base.originalText,
      originalResume: base.originalResume,
      originalLocked: false,
      jobDescription: '',
      jdAnalysis: null,
      currentVersionId: null,
      undoStack: [],
      redoStack: [],
      userFacts: [...base.userFacts],
      ownerUid,
      origin: 'automation',
      job,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + (ownerUid ? OWNED_TTL_MS : this.config.sessionTtlDays * 86_400_000)).toISOString(),
    };
    await this.store.createSession(row);
    const version = await this.addVersion(row, normalizeResume(current.resume), { label: `Copied from “${base.title}”`, source: 'original', instruction: null }, { trackUndo: false });
    await this.say(row.id, 'assistant', `Created by the Job Apply Agent from “${base.title}”${job.url ? ` for ${job.url}` : ''}. You can keep editing it here like any other resume.`, version.id, { kind: 'info' });
    return { session: await this.view(row), token, extraction: { method: 'heuristic', warnings: [] } };
  }

  /** Updates the job an automation resume belongs to (and its "<Role> – <Company>" title). */
  async setJob(id: string, cred: Cred, input: JobInput): Promise<SessionView> {
    const row = await this.authorize(id, cred);
    return this.withLock(row.id, async () => {
      const fresh = (await this.store.getSession(row.id))!;
      const prev: JobMeta = fresh.job || { title: '', company: '', url: '', applicationId: null, baseResumeId: null };
      const job: JobMeta = {
        ...prev,
        ...(input.title !== undefined && { title: input.title.trim().slice(0, 200) }),
        ...(input.company !== undefined && { company: input.company.trim().slice(0, 200) }),
        ...(input.url !== undefined && { url: input.url.trim().slice(0, 2000) }),
        ...(input.applicationId !== undefined && { applicationId: input.applicationId }),
      };
      fresh.job = job;
      fresh.updatedAt = ts();
      const patch: Partial<SessionRow> = { job, updatedAt: fresh.updatedAt };
      if (fresh.origin === 'automation') patch.title = fresh.title = automationTitle(job);
      await this.store.updateSession(fresh.id, patch);
      return this.view(fresh);
    });
  }

  /** Moves a guest resume (opened with its browser token) into the signed-in user's account. */
  async claim(id: string, token: string | undefined, uid: string | undefined): Promise<{ id: string; claimed: boolean }> {
    if (!uid || !token) throw unauthorized();
    const row = await this.authorize(id, token);
    if (row.ownerUid && row.ownerUid !== uid) throw unauthorized('This resume belongs to a different account.');
    if (row.ownerUid === uid) return { id, claimed: false };
    await this.store.updateSession(id, { ownerUid: uid, expiresAt: new Date(Date.now() + OWNED_TTL_MS).toISOString() });
    return { id, claimed: true };
  }

  private async structure(text: string, pdf?: Buffer): Promise<{ resume: ResumeData; method: 'ai' | 'heuristic'; warnings: string[] }> {
    const heuristic = parseResumeText(text);
    const warnings: string[] = [];
    if (!this.ai.available) {
      warnings.push('AI extraction is not configured, so a rule-based parser was used. Please review each section carefully.');
      return { resume: heuristic, method: 'heuristic', warnings };
    }
    try {
      const { system, prompt } = parsePrompt(text);
      const { data } = await this.ai.generate({ task: 'parse', system, prompt, schema: PARSE_SCHEMA, pdfBase64: pdf && pdf.length < 8_000_000 ? pdf.toString('base64') : undefined }, (raw) => {
        const v = validator(ParseOutput)(raw);
        if (!v.experience.length && !v.education.length && !v.skills.length && !v.projects.length) throw new Error('Extraction returned no resume sections.');
        return v;
      });
      const resume = fromParse(data);
      // Safety net: smaller models sometimes merge or drop bullets while
      // extracting. When the rule-based parser read more bullets for the same
      // job straight from the document, use those verbatim bullets instead.
      const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').slice(0, 2).join(' ');
      for (const e of resume.experience) {
        const h = heuristic.experience.find((x) => x.company && e.company && key(x.company) === key(e.company));
        if (h && h.bulletPoints.length > e.bulletPoints.length) e.bulletPoints = h.bulletPoints;
      }
      // Same for project bullets: keep the document's own line structure.
      const lineCount = (s: string) => s.split(/\n+/).filter((l) => l.trim()).length;
      for (const p of resume.projects) {
        const h = heuristic.projects.find((x) => x.title && p.title && key(x.title) === key(p.title));
        if (h && lineCount(h.description) > lineCount(p.description)) p.description = h.description;
      }
      for (const h of heuristic.experience) {
        const confident = h.company && h.jobTitle && h.startDate && h.bulletPoints.length > 0;
        if (confident && !resume.experience.some((e) => key(e.company) === key(h.company))) resume.experience.push(h);
      }
      // Safety net: never lose a section the rule-based parser found.
      if (!resume.experience.length && heuristic.experience.length) resume.experience = heuristic.experience;
      if (!resume.education.length && heuristic.education.length) resume.education = heuristic.education;
      if (!resume.projects.length && heuristic.projects.length) resume.projects = heuristic.projects;
      if (!collectSkills(resume).length && collectSkills(heuristic).length) resume.skills = heuristic.skills;
      for (const key of ['fullName', 'email', 'phone', 'location', 'linkedin', 'website', 'github'] as const) if (!resume.personalInfo[key]) resume.personalInfo[key] = heuristic.personalInfo[key] || '';
      return { resume, method: 'ai', warnings };
    } catch (e) {
      logger.warn('parse.fallback', { reason: (e as Error).message.slice(0, 120) });
      warnings.push('AI extraction was unavailable, so a rule-based parser was used. Please review each section carefully.');
      return { resume: heuristic, method: 'heuristic', warnings };
    }
  }

  private async createSession(
    text: string,
    structured: { resume: ResumeData; method: 'ai' | 'heuristic'; warnings: string[] },
    file?: { name: string; mime: string; buffer: Buffer; ext: string },
    ownerUid: string | null = null,
  ): Promise<CreateSessionResponse> {
    const id = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString('base64url');
    const now = ts();
    const resume = normalizeResume(structured.resume);
    // Keep the resume's own framing for internship-only experience.
    if (resume.experience.length && resume.experience.every((e) => /\bintern(ship)?\b/i.test(`${e.jobTitle} ${e.company}`))) {
      resume.sections = resume.sections.map((s) => (s.id === 'experience' ? { ...s, title: 'Internship Experience' } : s));
    }
    let filePath: string | null = null;
    if (file && this.store.putFile) {
      await this.store.putFile(id, file.buffer);
      filePath = `store:${id}`;
    } else if (file) {
      const dir = path.join(this.config.dataDir, 'uploads', id);
      await fs.mkdir(dir, { recursive: true });
      filePath = path.join(dir, `original.${file.ext}`);
      await fs.writeFile(filePath, file.buffer, { mode: 0o600 });
    }
    const row: SessionRow = {
      id,
      tokenHash: sha256(token),
      title: resume.personalInfo.fullName ? `${resume.personalInfo.fullName} – Resume` : file?.name || 'Untitled resume',
      status: 'draft',
      originalFileName: file?.name ?? null,
      originalFileMime: file?.mime ?? null,
      originalFileSize: file?.buffer.length ?? null,
      originalFilePath: filePath,
      originalText: text,
      originalResume: resume,
      originalLocked: false,
      jobDescription: '',
      jdAnalysis: null,
      currentVersionId: null,
      undoStack: [],
      redoStack: [],
      userFacts: [],
      ownerUid,
      origin: 'manual',
      job: null,
      createdAt: now,
      updatedAt: now,
      // Account resumes are kept until the user deletes them; guest sessions expire.
      expiresAt: new Date(Date.now() + (ownerUid ? OWNED_TTL_MS : this.config.sessionTtlDays * 86_400_000)).toISOString(),
    };
    await this.store.createSession(row);
    const version = await this.addVersion(row, resume, { label: 'Original extracted resume', source: 'original', instruction: null }, { trackUndo: false });
    await this.say(row.id, 'assistant', `Your resume is saved in this session${file ? ` (${file.name})` : ''}. Ask me anything about it — analyse it, improve it, rewrite a section, remove something, or paste a job description here to tailor it. You will not need to upload it again.`, version.id, { kind: 'info' });
    return { session: await this.view(row), token, extraction: { method: structured.method, warnings: structured.warnings } };
  }

  // ------------------------------------------------------------------ views

  async view(row: SessionRow): Promise<SessionView> {
    const versions = await this.store.listVersions(row.id);
    const current = row.currentVersionId ? await this.store.getVersion(row.id, row.currentVersionId) : null;
    if (!current) throw new HttpError(500, 'Session has no current version.');
    const ats = await this.atsForVersion(row, current);
    let previousScore: number | null = null;
    if (ats && current.parentId) {
      const parent = await this.store.getVersion(row.id, current.parentId);
      if (parent) previousScore = (await this.atsForVersion(row, parent))?.total ?? null;
    }
    const messages = await this.store.listMessages(row.id, 200);
    const summaries = versions.map(toSummary);
    return {
      id: row.id,
      title: row.title,
      origin: row.origin,
      job: row.job,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      expiresAt: row.expiresAt,
      originalFile: row.originalFileName ? { name: row.originalFileName, mimeType: row.originalFileMime || '', size: row.originalFileSize || 0 } : null,
      originalText: row.originalText,
      originalLocked: row.originalLocked,
      original: row.originalResume,
      current: current.resume,
      currentVersion: toSummary(current),
      jobDescription: row.jobDescription,
      jdAnalysis: row.jdAnalysis,
      ats,
      previousScore,
      versions: summaries.map((v) => (v.id === current.id ? { ...v, atsScore: ats?.total ?? v.atsScore } : v)),
      canUndo: row.undoStack.length > 0,
      canRedo: row.redoStack.length > 0,
      messages: messages.map(toChat),
      ai: { available: this.ai.available, providers: this.ai.names },
      weights: this.config.atsWeights,
    };
  }

  async get(id: string, token?: Cred) {
    return this.view(await this.authorize(id, token));
  }

  // ------------------------------------------------------------------ scoring

  private async semantic(resume: ResumeData, jdText: string): Promise<{ score: number; rationale: string } | null> {
    if (!this.config.atsSemantic || !this.ai.available || !jdText) return null;
    try {
      const { system, prompt } = semanticPrompt(resumeToPlainText(resume, { visibleOnly: true }), jdText);
      const { data } = await this.ai.generate({ task: 'semantic', system, prompt, schema: SEMANTIC_SCHEMA, effort: 'low' }, validator(SemanticOutput));
      return { score: data.score / 100, rationale: data.rationale.slice(0, 300) };
    } catch {
      return null; // deterministic score only
    }
  }

  private async computeAts(row: SessionRow, resume: ResumeData, semantic: 'compute' | { score: number; rationale: string } | null): Promise<AtsResult | null> {
    if (!row.jdAnalysis) return null;
    const sem = semantic === 'compute' ? await this.semantic(resume, row.jobDescription) : semantic;
    return { ...scoreResume(resume, row.jdAnalysis, { weights: this.config.atsWeights, original: row.originalResume, semantic: sem }), jdHash: jdHash(row.jdAnalysis) };
  }

  /** Returns the stored score when it matches the current JD, else re-scores (reusing any semantic component). */
  private async atsForVersion(row: SessionRow, version: VersionRow): Promise<AtsResult | null> {
    if (!row.jdAnalysis) return null;
    if (version.ats && version.ats.jdHash === jdHash(row.jdAnalysis) && JSON.stringify(version.ats.weights) === JSON.stringify(this.config.atsWeights)) return version.ats;
    const ats = await this.computeAts(row, version.resume, version.ats?.semantic ?? null);
    if (ats) {
      await this.store.updateVersionAts(version.id, ats, ats.total);
      version.ats = ats;
      version.atsScore = ats.total;
    }
    return ats;
  }

  // ------------------------------------------------------------------ versions

  private async addVersion(
    row: SessionRow,
    resume: ResumeData,
    meta: { label: string; source: VersionSource; instruction: string | null },
    opts: { trackUndo?: boolean; semantic?: 'compute' | { score: number; rationale: string } | null } = {},
  ): Promise<VersionRow> {
    const clean = normalizeResume(resume);
    const number = (await this.store.maxVersionNumber(row.id)) + 1;
    const ats = await this.computeAts(row, clean, opts.semantic === undefined ? 'compute' : opts.semantic);
    const version: VersionRow = {
      id: crypto.randomUUID(),
      sessionId: row.id,
      number,
      label: meta.label.slice(0, 120),
      source: meta.source,
      instruction: meta.instruction ? meta.instruction.slice(0, 2000) : null,
      parentId: row.currentVersionId,
      resume: clean,
      ats,
      atsScore: ats?.total ?? null,
      createdAt: ts(),
    };
    await this.store.insertVersion(version);
    const undoStack = opts.trackUndo === false || !row.currentVersionId ? row.undoStack : [...row.undoStack, row.currentVersionId].slice(-200);
    row.currentVersionId = version.id;
    row.undoStack = undoStack;
    row.redoStack = [];
    row.updatedAt = ts();
    await this.store.updateSession(row.id, { currentVersionId: version.id, undoStack, redoStack: [], updatedAt: row.updatedAt });
    return version;
  }

  private async currentVersion(row: SessionRow): Promise<VersionRow> {
    const v = row.currentVersionId ? await this.store.getVersion(row.id, row.currentVersionId) : null;
    if (!v) throw new HttpError(500, 'Session has no current version.');
    return v;
  }

  async listVersions(id: string, token?: Cred): Promise<VersionSummary[]> {
    const row = await this.authorize(id, token);
    return (await this.store.listVersions(row.id)).map(toSummary);
  }

  async getVersion(id: string, token: Cred, versionId: string): Promise<VersionDetail & { ats: AtsResult | null }> {
    const row = await this.authorize(id, token);
    const v = await this.store.getVersion(row.id, versionId);
    if (!v) throw notFound('Version not found.');
    return { ...toSummary(v), resume: v.resume, ats: await this.atsForVersion(row, v) };
  }

  async compare(id: string, token: Cred, a: string, b: string): Promise<{ from: VersionSummary; to: VersionSummary; changes: ResumeChange[] }> {
    const row = await this.authorize(id, token);
    const [va, vb] = await Promise.all([this.store.getVersion(row.id, a), this.store.getVersion(row.id, b)]);
    if (!va || !vb) throw notFound('Version not found.');
    return { from: toSummary(va), to: toSummary(vb), changes: diffResumes(va.resume, vb.resume) };
  }

  async restore(id: string, token: Cred, versionId: string, viaChat = false): Promise<SessionView> {
    const row = await this.authorize(id, token);
    return this.withLock(row.id, async () => {
      const fresh = (await this.store.getSession(row.id))!;
      this.assertDraft(fresh);
      await this.restoreInternal(fresh, versionId, viaChat ? null : 'Restore version');
      return this.view(fresh);
    });
  }

  private async restoreInternal(row: SessionRow, versionId: string, userText: string | null): Promise<VersionRow> {
    const target = await this.store.getVersion(row.id, versionId);
    if (!target) throw notFound('Version not found.');
    if (userText) await this.say(row.id, 'user', `${userText} ${target.number}`, row.currentVersionId, {});
    const before = await this.currentVersion(row);
    const v = await this.addVersion(row, target.resume, { label: `Restored version ${target.number}`, source: 'restore', instruction: null }, { semantic: target.ats?.semantic ?? null });
    await this.say(row.id, 'assistant', `Restored version ${target.number} (“${target.label}”) as a new version ${v.number}. All other versions are still available.`, v.id, {
      kind: 'restore',
      scoreBefore: (await this.atsForVersion(row, before))?.total ?? null,
      scoreAfter: v.atsScore,
    });
    return v;
  }

  async undo(id: string, token?: Cred): Promise<SessionView> {
    const row = await this.authorize(id, token);
    return this.withLock(row.id, async () => {
      const fresh = (await this.store.getSession(row.id))!;
      this.assertDraft(fresh);
      await this.undoRedo(fresh, 'undo');
      return this.view(fresh);
    });
  }

  async redo(id: string, token?: Cred): Promise<SessionView> {
    const row = await this.authorize(id, token);
    return this.withLock(row.id, async () => {
      const fresh = (await this.store.getSession(row.id))!;
      this.assertDraft(fresh);
      await this.undoRedo(fresh, 'redo');
      return this.view(fresh);
    });
  }

  private async undoRedo(row: SessionRow, dir: 'undo' | 'redo'): Promise<{ ok: boolean; message: string; versionId: string | null }> {
    const from = dir === 'undo' ? row.undoStack : row.redoStack;
    if (!from.length) {
      const message = dir === 'undo' ? 'There is nothing to undo.' : 'There is nothing to redo.';
      await this.say(row.id, 'assistant', message, row.currentVersionId, { kind: dir });
      return { ok: false, message, versionId: row.currentVersionId };
    }
    const targetId = from[from.length - 1];
    const target = await this.store.getVersion(row.id, targetId);
    if (!target) throw notFound('Version not found.');
    const prevCurrent = row.currentVersionId!;
    const prev = await this.currentVersion(row);
    if (dir === 'undo') {
      row.undoStack = row.undoStack.slice(0, -1);
      row.redoStack = [...row.redoStack, prevCurrent];
    } else {
      row.redoStack = row.redoStack.slice(0, -1);
      row.undoStack = [...row.undoStack, prevCurrent];
    }
    row.currentVersionId = targetId;
    row.updatedAt = ts();
    await this.store.updateSession(row.id, { currentVersionId: targetId, undoStack: row.undoStack, redoStack: row.redoStack, updatedAt: row.updatedAt });
    const before = (await this.atsForVersion(row, prev))?.total ?? null;
    const after = (await this.atsForVersion(row, target))?.total ?? null;
    const message = dir === 'undo' ? `Undid “${prev.label}”. You are back on version ${target.number} (“${target.label}”).` : `Redid the change. You are on version ${target.number} (“${target.label}”).`;
    await this.say(row.id, 'assistant', message, target.id, { kind: dir, scoreBefore: before, scoreAfter: after, changes: summarizeChanges(diffResumes(prev.resume, target.resume)) });
    return { ok: true, message, versionId: target.id };
  }

  // ------------------------------------------------------------------ original correction

  async correctOriginal(id: string, token: Cred, input: { text?: string; resume?: unknown }): Promise<SessionView> {
    const row = await this.authorize(id, token);
    return this.withLock(row.id, async () => {
      const fresh = (await this.store.getSession(row.id))!;
      if (fresh.originalLocked) throw conflict('The original resume is locked after a tailored resume has been generated. Edit the current version instead.', 'original_locked');
      let resume: ResumeData;
      let text = fresh.originalText;
      if (typeof input.text === 'string' && input.text.trim()) {
        text = sanitizeText(input.text);
        resume = (await this.structure(text)).resume;
      } else if (input.resume && typeof input.resume === 'object') {
        resume = normalizeResume(input.resume);
      } else throw badRequest('Provide corrected text or resume data.');
      if (!resume.personalInfo.fullName && !resume.experience.length && !resume.education.length) throw badRequest('The corrected resume is empty.');
      fresh.originalText = text;
      fresh.originalResume = normalizeResume(resume);
      fresh.title = resume.personalInfo.fullName ? `${resume.personalInfo.fullName} – Resume` : fresh.title;
      await this.store.updateSession(fresh.id, { originalText: text, originalResume: fresh.originalResume, title: fresh.title });
      await this.addVersion(fresh, fresh.originalResume, { label: 'Corrected original resume', source: 'correction', instruction: null });
      return this.view(fresh);
    });
  }

  // ------------------------------------------------------------------ job description

  async setJobDescription(id: string, token: Cred, rawJd: string): Promise<SessionView> {
    const row = await this.authorize(id, token);
    const jd = sanitizeText(rawJd, 30_000);
    if (jd.replace(/\s/g, '').length < 80) throw badRequest('Please paste the complete job description (at least a few sentences).');
    const analysis = await this.analyzeJd(jd);
    return this.withLock(row.id, async () => {
      const fresh = (await this.store.getSession(row.id))!;
      await this.applyJobDescription(fresh, jd, analysis);
      return this.view(fresh);
    });
  }

  /** Job description from a link to the posting (Job panel “Import from link”). */
  async setJobDescriptionFromUrl(id: string, token: Cred, url: string): Promise<SessionView> {
    const row = await this.authorize(id, token);
    const job = await fetchJobPosting(url);
    const analysis = await this.analyzeJd(job.text);
    return this.withLock(row.id, async () => {
      const fresh = (await this.store.getSession(row.id))!;
      await this.applyJobDescription(fresh, job.text, analysis);
      return this.view(fresh);
    });
  }

  /** Stores a JD + analysis on the session and re-scores the current version. Caller holds the lock. */
  private async applyJobDescription(fresh: SessionRow, jd: string, analysis: JDAnalysis): Promise<AtsResult | null> {
    const changed = fresh.jobDescription && fresh.jobDescription !== jd;
    fresh.jobDescription = jd;
    fresh.jdAnalysis = analysis;
    fresh.updatedAt = ts();
    await this.store.updateSession(fresh.id, { jobDescription: jd, jdAnalysis: analysis, updatedAt: fresh.updatedAt });
    const current = await this.currentVersion(fresh);
    const ats = await this.computeAts(fresh, current.resume, 'compute');
    if (ats) await this.store.updateVersionAts(current.id, ats, ats.total);
    await this.say(
      fresh.id,
      'assistant',
      `${changed ? 'Job description updated' : 'Job description analysed'}${analysis.jobTitle ? ` for “${analysis.jobTitle}”` : ''}: ${analysis.requiredSkills.length} required and ${analysis.preferredSkills.length} preferred skills, ${analysis.atsKeywords.length} ATS keywords. Your current resume scores ${ats?.total ?? '—'}/100.`,
      current.id,
      { kind: 'info', scoreAfter: ats?.total ?? null },
    );
    return ats;
  }

  private async analyzeJd(jd: string): Promise<JDAnalysis> {
    const base = analyzeJobDescriptionDeterministic(jd);
    if (!this.ai.available) return base;
    try {
      const { system, prompt } = jdPrompt(jd);
      const { data } = await this.ai.generate({ task: 'jd', system, prompt, schema: JD_SCHEMA, effort: 'low' }, validator(JdOutput));
      return mergeJDAnalysis(base, { ...data, education: data.educationRequirements } as Partial<JDAnalysis>, jd);
    } catch {
      return base;
    }
  }

  async updateJdAnalysis(id: string, token: Cred, patch: Partial<Pick<JDAnalysis, 'jobTitle' | 'company' | 'requiredSkills' | 'preferredSkills' | 'atsKeywords' | 'certifications' | 'tools'>>): Promise<SessionView> {
    const row = await this.authorize(id, token);
    return this.withLock(row.id, async () => {
      const fresh = (await this.store.getSession(row.id))!;
      if (!fresh.jdAnalysis) throw badRequest('Add a job description first.');
      const list = (v: unknown) => (Array.isArray(v) ? uniqueKeywords(v.map((x) => sanitizeText(String(x), 80)).filter(Boolean)).slice(0, 60) : undefined);
      const next: JDAnalysis = {
        ...fresh.jdAnalysis,
        jobTitle: typeof patch.jobTitle === 'string' ? sanitizeText(patch.jobTitle, 160) : fresh.jdAnalysis.jobTitle,
        company: typeof patch.company === 'string' ? sanitizeText(patch.company, 160) : fresh.jdAnalysis.company,
        requiredSkills: list(patch.requiredSkills) ?? fresh.jdAnalysis.requiredSkills,
        preferredSkills: list(patch.preferredSkills) ?? fresh.jdAnalysis.preferredSkills,
        atsKeywords: list(patch.atsKeywords) ?? fresh.jdAnalysis.atsKeywords,
        certifications: list(patch.certifications) ?? fresh.jdAnalysis.certifications,
        tools: list(patch.tools) ?? fresh.jdAnalysis.tools,
        userEdited: true,
      };
      fresh.jdAnalysis = next;
      await this.store.updateSession(fresh.id, { jdAnalysis: next, updatedAt: ts() });
      return this.view(fresh);
    });
  }

  // ------------------------------------------------------------------ generation

  async generate(id: string, token?: Cred): Promise<SessionView> {
    const row = await this.authorize(id, token);
    return this.withLock(row.id, async () => {
      const fresh = (await this.store.getSession(row.id))!;
      this.assertDraft(fresh);
      await this.runGeneration(fresh, null);
      return this.view(fresh);
    });
  }

  /**
   * Tailors the CURRENT version to the session's JD (so earlier chat edits are
   * kept), using the immutable original resume as the evidence source.
   * Caller holds the lock. Throws (and changes nothing) if the AI fails.
   */
  private async runGeneration(fresh: SessionRow, instruction: string | null): Promise<MessageRow> {
    if (!fresh.jdAnalysis || !fresh.jobDescription) throw badRequest('Add a job description before generating the tailored resume.');
    const original = fresh.originalResume;
    const current = await this.currentVersion(fresh);
    const beforeAts = await this.atsForVersion(fresh, current);
    let resume: ResumeData;
    let warnings: string[] = [];
    let gaps: string[] = [];
    let provider = 'rule-based';
    if (this.ai.available) {
      // Deterministic score (semantic part held constant) so attempts are compared fairly.
      const quickScore = (r: ResumeData) => scoreResume(r, fresh.jdAnalysis!, { weights: this.config.atsWeights, original, semantic: beforeAts?.semantic ?? null }).total;
      const baseline = quickScore(current.resume);
      let best: { resume: ResumeData; warnings: string[]; gaps: string[]; score: number } | null = null;
      let feedback = '';
      // Never-worse policy: if a rewrite scores below the version it started from,
      // retry once with feedback about what was lost, then keep the better attempt.
      for (let attempt = 0; attempt < 2; attempt++) {
        const { system, prompt } = generatePrompt(current.resume, original, fresh.jdAnalysis, fresh.jobDescription, beforeAts, feedback);
        const { data, provider: p } = await this.ai.generate({ task: 'generate', system, prompt, schema: GENERATE_SCHEMA }, (raw) => {
          const v = validator(GenerateOutput)(raw);
          if (!v.summary.trim() && !v.experience.length && !v.skills.length) throw new Error('Generation returned no content.');
          return v;
        });
        provider = p;
        const guarded = applyGeneration(original, current.resume, data, fresh.jdAnalysis.jobTitle, fresh.userFacts, fresh.jobDescription);
        const score = quickScore(guarded.resume);
        if (!best || score > best.score) best = { resume: guarded.resume, warnings: guarded.warnings, gaps: data.skillGaps, score };
        if (score >= baseline) break;
        const before = scoreResume(current.resume, fresh.jdAnalysis, { original }).keywords;
        const after = scoreResume(guarded.resume, fresh.jdAnalysis, { original }).keywords;
        const lost = before.filter((k) => k.status === 'matched' && after.find((x) => x.keyword === k.keyword)?.status !== 'matched').map((k) => k.keyword);
        feedback = `Your rewrite scored lower than the source resume (${score} vs ${baseline}). ${lost.length ? `It dropped these JD keywords that the resume already had: ${lost.join(', ')}. Keep them. ` : ''}Keep the wording of responsibilities close to the job description where the facts support it, and do not remove relevant details.`;
      }
      resume = best!.resume;
      warnings = best!.warnings;
      gaps = best!.gaps;
      if (best!.score < baseline) warnings.push(`This rewrite did not raise the estimated ATS score (${baseline} → ${best!.score}); the resume already matches this job about as well as its evidence allows. Say “undo” to keep the previous version.`);
    } else {
      resume = deterministicTailor(current.resume, fresh.jdAnalysis);
      warnings = ['No AI provider is configured on the server, so skills and sections were prioritised without rewriting. Add a free GEMINI_API_KEY or GROQ_API_KEY to .env for full tailoring.'];
    }
    // Keep the user's chosen template and layout.
    resume.template = current.resume.template;
    resume.layout = current.resume.layout;
    resume.fontSize = current.resume.fontSize;
    resume.pageFormat = current.resume.pageFormat;
    const malformed = isMalformed(current.resume, resume);
    if (malformed) throw new AIUnavailableError(`${malformed} Your resume was not changed — please try again.`);

    fresh.originalLocked = true;
    await this.store.updateSession(fresh.id, { originalLocked: true });
    const v = await this.addVersion(fresh, resume, { label: `Tailored to ${fresh.jdAnalysis.jobTitle || 'job description'}`.slice(0, 80), source: 'generate', instruction });
    const ats = await this.atsForVersion(fresh, v);
    const missing = (ats?.keywords || []).filter((k) => k.importance !== 'keyword' && k.status === 'missing' && !k.evidence.inOriginal).map((k) => k.keyword);
    const unsupportedGaps = uniqueKeywords([...gaps, ...missing]);
    const offer = this.buildOffer(v.resume, fresh, missing, [], gaps);
    return this.say(
      fresh.id,
      'assistant',
      [
        `I tailored your resume for ${fresh.jdAnalysis.jobTitle || 'the target role'} using only facts from your original resume. Estimated ATS compatibility: ${beforeAts?.total ?? '—'} → ${ats?.total ?? '—'}/100.`,
        offer.skills?.length ? offerQuestion(offer) : 'Tell me what to change next — for example “Make my summary shorter”.',
      ].join('\n\n'),
      v.id,
      { kind: 'generate', warnings, skillGaps: unsupportedGaps, offer, scoreBefore: beforeAts?.total ?? null, scoreAfter: ats?.total ?? null, provider, changes: summarizeChanges(diffResumes(current.resume, v.resume)).slice(0, 12) },
    );
  }

  // ------------------------------------------------------------------ chat editing

  async edit(id: string, token: Cred, rawInstruction: string): Promise<EditResponse> {
    const row = await this.authorize(id, token);
    const instruction = sanitizeText(rawInstruction, 30_000);
    if (instruction.length < 2) throw badRequest('Please type an editing instruction.');
    return this.withLock(row.id, async () => {
      const fresh = (await this.store.getSession(row.id))!;
      this.assertDraft(fresh);
      await this.say(fresh.id, 'user', instruction, fresh.currentVersionId, {});
      const cmd = parseCommand(instruction);
      let reply: MessageRow;
      let changed = false;
      const conversational = cmd ? null : await this.handleConversational(fresh, instruction);

      if (conversational) {
        reply = conversational.message;
        changed = conversational.changed;
      } else if (cmd?.type === 'undo' || cmd?.type === 'redo') {
        const r = await this.undoRedo(fresh, cmd.type);
        changed = r.ok;
        reply = await this.lastMessage(fresh.id);
      } else if (cmd?.type === 'restore-previous' || cmd?.type === 'restore-number') {
        const versions = await this.store.listVersions(fresh.id);
        const current = await this.currentVersion(fresh);
        const target = cmd.type === 'restore-number' ? versions.find((v) => v.number === cmd.number) : current.parentId ? versions.find((v) => v.id === current.parentId) : undefined;
        if (!target) reply = await this.say(fresh.id, 'assistant', cmd.type === 'restore-number' ? `There is no version ${cmd.number}. Available versions: 1–${versions.length}.` : 'There is no previous version to restore.', fresh.currentVersionId, { kind: 'info' });
        else {
          await this.restoreInternal(fresh, target.id, null);
          changed = true;
          reply = await this.lastMessage(fresh.id);
        }
      } else if (cmd?.type === 'show-diff') {
        const current = await this.currentVersion(fresh);
        const parent = current.parentId ? await this.store.getVersion(fresh.id, current.parentId) : null;
        if (!parent) reply = await this.say(fresh.id, 'assistant', 'This is the first version, so there is nothing to compare yet.', current.id, { kind: 'diff' });
        else {
          const diff = diffResumes(parent.resume, current.resume);
          reply = await this.say(fresh.id, 'assistant', `Changes in version ${current.number} (“${current.label}”) compared with version ${parent.number}:`, current.id, { kind: 'diff', diff, changes: summarizeChanges(diff) });
        }
      } else if (cmd?.type === 'recalculate') {
        const current = await this.currentVersion(fresh);
        const ats = await this.computeAts(fresh, current.resume, 'compute');
        if (ats) await this.store.updateVersionAts(current.id, ats, ats.total);
        reply = await this.say(fresh.id, 'assistant', ats ? `Recalculated: your estimated ATS compatibility is ${ats.total}/100.` : 'Add a job description first so I can calculate an ATS score.', current.id, { kind: 'info', scoreAfter: ats?.total ?? null });
      } else if (cmd?.type === 'template') {
        const current = await this.currentVersion(fresh);
        if (current.resume.template === cmd.template) reply = await this.say(fresh.id, 'assistant', 'That template is already selected.', current.id, { kind: 'template' });
        else {
          const v = await this.addVersion(fresh, { ...current.resume, template: cmd.template }, { label: `Template: ${cmd.template}`, source: 'template', instruction }, { semantic: current.ats?.semantic ?? null });
          changed = true;
          reply = await this.say(fresh.id, 'assistant', `Switched the template. All content, sections and edits are unchanged.`, v.id, { kind: 'template', changes: [`Template changed to ${cmd.template}`] });
        }
      } else if (cmd?.type === 'contact') {
        const current = await this.currentVersion(fresh);
        const labels: Record<string, string> = { fullName: 'name', jobTitle: 'headline', email: 'email', phone: 'phone number', location: 'location', linkedin: 'LinkedIn', website: 'portfolio', github: 'GitHub' };
        const next = normalizeResume({ ...current.resume, personalInfo: { ...current.resume.personalInfo, [cmd.field]: cmd.value } });
        if (!diffResumes(current.resume, next).length) reply = await this.say(fresh.id, 'assistant', `Your ${labels[cmd.field]} is already “${cmd.value}”.`, current.id, { kind: 'info' });
        else {
          const v = await this.addVersion(fresh, next, { label: `Updated ${labels[cmd.field]}`, source: 'edit', instruction }, { semantic: current.ats?.semantic ?? null });
          changed = true;
          reply = await this.say(fresh.id, 'assistant', `Updated your ${labels[cmd.field]} to “${next.personalInfo[cmd.field]}”.`, v.id, { kind: 'edit', changes: [`Updated ${labels[cmd.field]}`] });
        }
      } else if (cmd?.type === 'style') {
        const current = await this.currentVersion(fresh);
        const style = cmd.style === null ? undefined : normalizeStyle({ ...(current.resume.layout?.style || {}), ...cmd.style });
        const next = { ...current.resume, layout: { margins: current.resume.layout?.margins || 'normal', pageTarget: current.resume.layout?.pageTarget || 1, ...(style ? { style } : {}) } } as ResumeData;
        if (!diffResumes(current.resume, next).length) reply = await this.say(fresh.id, 'assistant', 'That style is already applied.', current.id, { kind: 'template' });
        else {
          const v = await this.addVersion(fresh, next, { label: cmd.summary.join(', ').slice(0, 80), source: 'template', instruction }, { semantic: current.ats?.semantic ?? null });
          changed = true;
          reply = await this.say(fresh.id, 'assistant', `Updated the formatting: ${cmd.summary.join('; ')}. Content is unchanged, and PDF/DOCX exports use the same styling.`, v.id, { kind: 'template', changes: cmd.summary });
        }
      } else if (cmd?.type === 'remove-headline') {
        const current = await this.currentVersion(fresh);
        if (!current.resume.personalInfo.jobTitle) reply = await this.say(fresh.id, 'assistant', 'There is no headline under your name to remove.', current.id, { kind: 'info' });
        else {
          const removed = current.resume.personalInfo.jobTitle;
          const next = { ...current.resume, personalInfo: { ...current.resume.personalInfo, jobTitle: '' } };
          if (!fresh.userFacts.includes(HEADLINE_REMOVED)) {
            fresh.userFacts = [...fresh.userFacts, HEADLINE_REMOVED];
            await this.store.updateSession(fresh.id, { userFacts: fresh.userFacts });
          }
          const v = await this.addVersion(fresh, next, { label: 'Removed headline under name', source: 'edit', instruction }, { semantic: current.ats?.semantic ?? null });
          changed = true;
          reply = await this.say(fresh.id, 'assistant', `Removed the line under your name (“${removed}”). Say “undo” to bring it back.`, v.id, { kind: 'edit', changes: ['Removed headline under name'], scoreBefore: current.atsScore, scoreAfter: v.atsScore });
        }
      } else if (jobLinkRequest(instruction)) {
        // A link to a job posting: read it, attach it as the JD, then tailor (or only analyse when that is all that was asked).
        const { url, analyseOnly } = jobLinkRequest(instruction)!;
        let job: Awaited<ReturnType<typeof fetchJobPosting>> | null = null;
        try {
          job = await fetchJobPosting(url);
        } catch (e) {
          reply = await this.say(fresh.id, 'assistant', e instanceof HttpError ? e.message : 'I could not open that link. Please paste the job description text instead.', fresh.currentVersionId, { kind: 'error' });
        }
        if (job) {
          await this.say(fresh.id, 'assistant', `I read the job posting${job.title ? ` “${job.title}”` : ''}${job.company ? ` at ${job.company}` : ''} from the link${job.method === 'page-text' ? ' (taken from the page text — check the Job panel that it picked up the right part)' : ''}.`, fresh.currentVersionId, { kind: 'info' });
          await this.applyJobDescription(fresh, job.text, await this.analyzeJd(job.text));
          if (analyseOnly) reply = await this.explainScore(fresh, await this.currentVersion(fresh));
          else {
            reply = await this.chatGeneration(fresh, instruction);
            changed = true;
          }
        } else reply = reply!;
      } else if (this.ai.available && isAddEntryRequest(instruction)) {
        const r = await this.addEntryFromSource(fresh, instruction, instruction);
        changed = r.changed;
        reply = r.message;
      } else if (pageFitTarget(instruction) && !extractJobDescription(instruction)) {
        const r = await this.fitPages(fresh, pageFitTarget(instruction)!, instruction);
        changed = r.changed;
        reply = r.message;
      } else if (extractJobDescription(instruction)) {
        // A job description pasted into the chat: analyse it, attach it to the session and tailor.
        const jd = extractJobDescription(instruction)!;
        await this.applyJobDescription(fresh, jd, await this.analyzeJd(jd));
        reply = await this.chatGeneration(fresh, instruction);
        changed = true;
      } else if (TAILOR_REQUEST.test(instruction) && !/cover letter/i.test(instruction)) {
        if (!fresh.jdAnalysis) reply = await this.say(fresh.id, 'assistant', 'Paste the job description here in the chat (or in the Job panel) and I will tailor your stored resume to it.', fresh.currentVersionId, { kind: 'question' });
        else {
          reply = await this.chatGeneration(fresh, instruction);
          changed = true;
        }
      } else if (!this.ai.available && ANALYSIS_REQUEST.test(instruction)) {
        reply = await this.localAnalysis(fresh);
      } else {
        const r = await this.aiEdit(fresh, instruction);
        changed = r.changed;
        reply = r.message;
      }
      return { session: await this.view(fresh), message: toChat(reply), changed };
    });
  }

  /**
   * Deterministic conversational turns, handled before any AI call:
   *  1. replies to an offer ("yes", "add all", "add Tableau", "add project 2", "no");
   *  2. explicit requests to add named skills ("add Tableau and Statistics to my skills");
   *  3. "why is my score / readability …" questions, answered from the real score breakdown.
   */
  private async handleConversational(row: SessionRow, instruction: string): Promise<{ message: MessageRow; changed: boolean } | null> {
    const text = instruction.trim();
    if (text.length > 400 || extractJobDescription(text) || isAddEntryRequest(text)) return null;
    const current = await this.currentVersion(row);

    // 1. Reply to the most recent offer.
    const recent = (await this.store.listMessages(row.id, 6)).reverse().find((m) => m.role === 'assistant');
    const offer = recent?.meta?.offer;
    if (offer && (offer.skills?.length || offer.projects?.length)) {
      if (/^(no|nope|nah|don'?t|do not|skip|not now|none)\b/i.test(text)) {
        return { changed: false, message: await this.say(row.id, 'assistant', 'Okay — I won’t add them. Your resume is unchanged.', current.id, { kind: 'info' }) };
      }
      const selection = selectFromOffer(text, offer);
      if (selection) {
        // "add SQL and Git" may name offered and non-offered skills together.
        const extra = explicitSkillRequest(text, row.jdAnalysis).filter((s) => !selection.skills.some((x) => x.toLowerCase() === s.toLowerCase()) && !/\b(not|except|without)\b/i.test(text));
        return this.applyAdditions(row, current, [...selection.skills, ...extra], selection.projects, instruction);
      }
    }

    // 2. Explicit "add <skills>" request naming concrete skills.
    const named = explicitSkillRequest(text, row.jdAnalysis);
    if (named.length) return this.applyAdditions(row, current, named, [], instruction);

    // 3. "How can I increase my score?" → measured action plan.
    if (/\b(increase|improve|boost|raise|maximi[sz]e|higher|better|more)\b/i.test(text) && /\b(score|ats|points?|match)\b/i.test(text) && /\b(how|ways?|methods?|suggest\w*|tips?|steps?|plan|what (can|should|else)|help)\b|\?/i.test(text)) {
      return { changed: false, message: await this.scorePlan(row, current) };
    }

    // 4. Questions about the score.
    if (/\b(why|how come|explain|what (is|are) (wrong|missing)|reason)\b/i.test(text) && /\b(score|ats|readability|structure|keywords?|passed|failed|partial|low|points?|match)\b/i.test(text)) {
      return { changed: false, message: await this.explainScore(row, current) };
    }
    return null;
  }

  /** Adds user-confirmed skills/projects deterministically and records them as confirmed facts. */
  private async applyAdditions(row: SessionRow, current: VersionRow, skills: string[], projects: OfferedProject[], instruction: string): Promise<{ message: MessageRow; changed: boolean }> {
    const next = normalizeResume(structuredClone(current.resume));
    const have = new Set(collectSkills(next).map((s) => s.toLowerCase()));
    const addedSkills = skills.filter((s) => !have.has(s.toLowerCase()));
    for (const skill of addedSkills) addSkill(next, skill);
    const addedProjects = projects.filter((p) => !next.projects.some((x) => x.title.toLowerCase() === p.title.toLowerCase()));
    for (const p of addedProjects) {
      next.projects.push({ id: `proj-${crypto.randomUUID().slice(0, 8)}`, title: p.title, description: p.description, technologies: p.technologies, liveUrl: '', githubUrl: '', startDate: '', endDate: '' });
    }
    if (addedProjects.length) next.sections = normalizeSections(next.sections).map((s) => (s.id === 'projects' ? { ...s, visible: true } : s));
    if (!addedSkills.length && !addedProjects.length) {
      return { changed: false, message: await this.say(row.id, 'assistant', 'Those are already in your resume, so nothing needed to change.', current.id, { kind: 'info' }) };
    }
    // Remember what the user confirmed so later edits and tailoring may use it as evidence.
    const facts = [...addedSkills.map((s) => `User confirmed experience with ${s}.`), ...addedProjects.map((p) => `User project: ${p.title}. ${p.description} Technologies: ${p.technologies.join(', ')}`)];
    row.userFacts = [...row.userFacts, ...facts].slice(-200);
    await this.store.updateSession(row.id, { userFacts: row.userFacts });
    const changes = [...(addedSkills.length ? [`Added to skills: ${addedSkills.join(', ')}`] : []), ...addedProjects.map((p) => `Added project: ${p.title}`)];
    const v = await this.addVersion(row, next, { label: changes[0].slice(0, 80), source: 'edit', instruction });
    const tail = addedProjects.length
      ? 'Review the new project wording and adjust it so it matches exactly what you built.'
      : 'I can also mention them in your summary or projects where they were really used — just tell me where.';
    return {
      changed: true,
      message: await this.say(row.id, 'assistant', `Done. ${changes.join('. ')}. ${tail}`, v.id, { kind: 'edit', changes, scoreBefore: current.atsScore, scoreAfter: v.atsScore }),
    };
  }

  /** A file attached in the chat (project report, README, internship letter, code…) → a new resume entry. */
  async attach(id: string, token: Cred, file: { buffer: Buffer; originalname: string }, rawMessage: string): Promise<EditResponse> {
    const row = await this.authorize(id, token);
    const source = await extractAttachment(file.buffer, file.originalname);
    const hint = sanitizeText(rawMessage || '', 2000);
    const name = file.originalname.replace(/[^\w .()-]/g, '').slice(0, 80) || 'file';
    return this.withLock(row.id, async () => {
      const fresh = (await this.store.getSession(row.id))!;
      this.assertDraft(fresh);
      await this.say(fresh.id, 'user', `📎 ${name}${hint ? ` — ${hint}` : ''}`, fresh.currentVersionId, {});
      const r = await this.addEntryFromSource(fresh, hint, source);
      return { session: await this.view(fresh), message: toChat(r.message), changed: r.changed };
    });
  }

  /** Builds one project / internship / certification entry from the user's own material. */
  private async addEntryFromSource(row: SessionRow, hint: string, source: string): Promise<{ message: MessageRow; changed: boolean }> {
    const current = await this.currentVersion(row);
    if (!this.ai.available) {
      return { changed: false, message: await this.say(row.id, 'assistant', 'Reading project or internship details needs an AI provider key on the server. You can still add the entry yourself in “Edit content”.', current.id, { kind: 'error' }) };
    }
    const profile = sectionProfile(current.resume);
    const { system, prompt } = entryPrompt({ source, hint, examples: formatExamples(current.resume), pointsTarget: { project: profile.projectPoints, experience: profile.experiencePoints } });
    let data: EntryOutput;
    try {
      ({ data } = await this.ai.generate({ task: 'entry', system, prompt, schema: ENTRY_SCHEMA }, validator(EntryOutput)));
    } catch (e) {
      const err = e instanceof HttpError ? e : new AIUnavailableError();
      await this.say(row.id, 'assistant', err.message, current.id, { kind: 'error' });
      throw err;
    }
    if (data.kind === 'experience' && (!data.experience.company.trim() || !data.experience.jobTitle.trim())) {
      const q = data.question.trim() || 'What was the organisation name and your role (e.g. “Data Engineering Intern at XYZ, Jan 2024 – Mar 2024”)?';
      return { changed: false, message: await this.say(row.id, 'assistant', `I can add this as an internship/experience entry, but one detail is missing. ${q}`, current.id, { kind: 'question' }) };
    }
    const res = applyEntry(current.resume, data, source, hint);
    if (!res) {
      return { changed: false, message: await this.say(row.id, 'assistant', data.question.trim() || 'I could not find project, internship or certificate details in that. Tell me the name, what you built or did, and the tools you used, and I will add it.', current.id, { kind: 'question' }) };
    }
    row.userFacts = [...row.userFacts, ...res.facts].slice(-200);
    await this.store.updateSession(row.id, { userFacts: row.userFacts });
    const v = await this.addVersion(row, res.resume, { label: res.label, source: 'edit', instruction: hint.slice(0, 500) || 'Added from attached file' }, { semantic: current.ats?.semantic ?? null });
    const lines = [`Done. ${res.changes.join('. ')}.`, 'The wording comes only from what you gave me — check it matches what you really did, and say “undo” to remove it.'];
    if (res.dropped.length) lines.push('', 'I left out these points because they went beyond your details:', ...res.dropped.map((d) => `- ${d}`));
    if (res.question) lines.push('', res.question);
    return { changed: true, message: await this.say(row.id, 'assistant', lines.join('\n'), v.id, { kind: 'edit', changes: res.changes, scoreBefore: current.atsScore, scoreAfter: v.atsScore }) };
  }

  /** Fits the current version into 1 or 2 pages (see fitPages.ts) and saves it as a new version. */
  private async fitPages(row: SessionRow, target: 1 | 2, instruction: string): Promise<{ message: MessageRow; changed: boolean }> {
    const current = await this.currentVersion(row);
    const fit = await fitToPages(current.resume, target, row.jdAnalysis);
    const want = target === 1 ? 'one page' : 'two pages';
    if (fit.before <= target) {
      return { changed: false, message: await this.say(row.id, 'assistant', `Your resume already fits on ${want} (${fit.before} page${fit.before === 1 ? '' : 's'}), so nothing needed to change.`, current.id, { kind: 'info' }) };
    }
    const changes = [...fit.layout, ...fit.removed.map((x) => `Removed — ${x}`)];
    const v = await this.addVersion(row, fit.resume, { label: `Fitted to ${want}`, source: 'edit', instruction }, { semantic: current.ats?.semantic ?? null });
    const lines = [
      fit.after <= target
        ? `Done — your resume now fits on ${want} (it was ${fit.before} pages). Structure, headings, roles, projects, education and skills are all kept.`
        : `I tightened it from ${fit.before} to ${fit.after} pages, but it still does not fit on ${want} without removing important content, so I stopped there.`,
    ];
    if (fit.layout.length) lines.push('', '**Layout:**', ...fit.layout.map((x) => `- ${x}`));
    if (fit.removed.length) lines.push('', '**Least important content removed** (say “undo” to bring it back):', ...fit.removed.map((x) => `- ${x}`));
    if (fit.after > target) lines.push('', 'To get further, tell me what to drop — for example “remove the SAMURAI REIMEI project” or “hide the certifications section”.');
    const scoreNote = current.atsScore !== null && v.atsScore !== null && v.atsScore !== current.atsScore ? ` ATS score: ${current.atsScore} → ${v.atsScore}.` : '';
    if (scoreNote) lines.push('', scoreNote.trim());
    return { changed: true, message: await this.say(row.id, 'assistant', lines.join('\n'), v.id, { kind: 'edit', changes, scoreBefore: current.atsScore, scoreAfter: v.atsScore }) };
  }

  /** Ranked, measured steps to raise the score (see shared/improve.ts). */
  private async scorePlan(row: SessionRow, current: VersionRow): Promise<MessageRow> {
    const ats = await this.atsForVersion(row, current);
    const pages = await renderPdf(current.resume).then((f) => f.pageCount).catch(() => undefined);
    const plan = improvementPlan(current.resume, row.jdAnalysis, ats, { weights: this.config.atsWeights, original: row.originalResume, pages });
    if (!plan) return this.say(row.id, 'assistant', 'Add a job description first — the score, and how to raise it, depend on the specific job.', current.id, { kind: 'info' });
    const gaps = plan.steps.find((s) => s.id === 'confirm-gaps')?.items || [];
    const offer = this.buildOffer(current.resume, row, gaps, []);
    const lines = [planToText(plan)];
    if (offer.skills?.length) lines.push('', offerQuestion(offer));
    return this.say(row.id, 'assistant', lines.join('\n'), current.id, { kind: 'info', offer });
  }

  /** Plain-language explanation of the current score, built from the real breakdown. */
  private async explainScore(row: SessionRow, current: VersionRow): Promise<MessageRow> {
    const ats = await this.atsForVersion(row, current);
    if (!ats) return this.say(row.id, 'assistant', 'Add a job description first — the score is calculated against a specific job.', current.id, { kind: 'info' });
    const lines = [`Your estimated ATS score is ${ats.total}/100. Here is where points were lost:`];
    for (const c of ats.categories) {
      if (c.points >= c.weight - 0.05) continue;
      lines.push(`\n**${c.label}: ${c.points.toFixed(1)} / ${c.weight}**`);
      if (c.id === 'structure') for (const k of ats.checks.filter((x) => !x.passed)) lines.push(`- ${k.label} — ${k.detail}`);
      else lines.push(...c.details.map((d) => `- ${d}`));
    }
    const missing = ats.keywords.filter((k) => k.status !== 'matched' && k.importance !== 'keyword');
    if (missing.length) lines.push(`\nMissing or partial JD skills: ${missing.map((k) => k.keyword).join(', ')}.`);
    const offer = this.buildOffer(current.resume, row, missing.filter((k) => !k.evidence.inOriginal).map((k) => k.keyword), []);
    if (offer.skills?.length) lines.push('', offerQuestion(offer));
    const fixable = ats.checks.filter((x) => !x.passed);
    if (fixable.length) lines.push('', 'Say “fix the readability issues” and I’ll correct what can be fixed from your existing content.');
    return this.say(row.id, 'assistant', lines.join('\n'), current.id, { kind: 'info', offer });
  }

  /** Runs tailoring from a chat request; on AI failure records the error and leaves the resume unchanged. */
  private async chatGeneration(row: SessionRow, instruction: string): Promise<MessageRow> {
    try {
      return await this.runGeneration(row, instruction);
    } catch (e) {
      const err = e instanceof HttpError ? e : new AIUnavailableError();
      await this.say(row.id, 'assistant', err.message, row.currentVersionId, { kind: 'error' });
      throw err;
    }
  }

  /** Rule-based resume review used when no AI provider is configured. */
  private async localAnalysis(row: SessionRow): Promise<MessageRow> {
    const current = await this.currentVersion(row);
    const r = current.resume;
    const emptyJd = analyzeJobDescriptionDeterministic('');
    const ats = (await this.atsForVersion(row, current)) || scoreResume(r, emptyJd, { weights: this.config.atsWeights, original: row.originalResume });
    const passed = ats.checks.filter((c) => c.passed).map((c) => c.label);
    const failed = ats.checks.filter((c) => !c.passed).map((c) => `${c.label} — ${c.detail}`);
    const lines = [
      `Here is a review of your current resume (version ${current.number}):`,
      '',
      `Content: ${r.experience.length} role(s), ${r.projects.length} project(s), ${r.education.length} education entr${r.education.length === 1 ? 'y' : 'ies'}, ${collectSkills(r).length} skills, ${(r.certifications || []).length} certification(s).`,
      passed.length ? `Strengths:\n${passed.map((p) => `- ${p}`).join('\n')}` : '',
      failed.length ? `To improve:\n${failed.map((f) => `- ${f}`).join('\n')}` : 'No formatting problems found.',
      row.jdAnalysis
        ? `Against the job description: estimated ATS ${ats.total}/100. Missing required skills: ${ats.requiredMissing.join(', ') || 'none'}.`
        : 'Paste a job description to get a keyword match and ATS score for a specific role.',
      '',
      'For a detailed AI review and rewrites, add a free GEMINI_API_KEY or GROQ_API_KEY to the server .env.',
    ];
    return this.say(row.id, 'assistant', lines.filter((l) => l !== '').join('\n'), current.id, { kind: 'info' });
  }

  private async aiEdit(row: SessionRow, instruction: string): Promise<{ changed: boolean; message: MessageRow }> {
    const current = await this.currentVersion(row);
    if (!this.ai.available) {
      const local = localEdit(instruction, current.resume);
      if (!local) {
        return { changed: false, message: await this.say(row.id, 'assistant', 'AI editing is not configured on the server (set ANTHROPIC_API_KEY or another provider key). Without it I can only handle simple commands such as undo, restore, template changes, hiding sections, shortening the summary or one-page layout. You can also edit any section directly in the editor.', current.id, { kind: 'error' }) };
      }
      const v = await this.addVersion(row, local.resume, { label: local.changes[0] || 'Edit', source: 'edit', instruction }, { semantic: current.ats?.semantic ?? null });
      return { changed: true, message: await this.say(row.id, 'assistant', local.message, v.id, { kind: 'edit', changes: local.changes, scoreBefore: current.atsScore, scoreAfter: v.atsScore }) };
    }

    const history = (await this.store.listMessages(row.id, 12)).map((m) => ({ role: m.role, content: m.content.slice(0, 500) }));
    const ats = await this.atsForVersion(row, current);
    const { system, prompt } = editPrompt({ instruction, current: current.resume, original: row.originalResume, jd: row.jdAnalysis, jdText: row.jobDescription, ats, history });
    let data: EditOutput;
    try {
      ({ data } = await this.ai.generate({ task: 'edit', system, prompt, schema: EDIT_SCHEMA }, validator(EditOutput)));
    } catch (e) {
      const err = e instanceof HttpError ? e : new AIUnavailableError();
      await this.say(row.id, 'assistant', err.message, current.id, { kind: 'error' });
      throw err;
    }

    const { resume, warnings } = applyEdit(current.resume, row.originalResume, data, instruction, row.userFacts, row.jobDescription);
    const malformed = isMalformed(current.resume, resume);
    if (malformed) {
      const err = new AIUnavailableError(`${malformed} Your resume was not changed — please try again.`);
      await this.say(row.id, 'assistant', err.message, current.id, { kind: 'error' });
      throw err;
    }
    const offer = this.buildOffer(current.resume, row, data.offer?.skills || [], data.offer?.projects || [], data.skillGaps);
    const question = data.clarifyingQuestion.trim();
    const diff = diffResumes(current.resume, resume);
    if (!diff.length) {
      const claimedChanges = data.changes.length > 0 && !offer.projects?.length;
      // Never report edits that were not actually applied.
      const text = claimedChanges
        ? ['I could not apply that change to your resume.', ...warnings.map((w) => `- ${w}`), question || (offer.skills?.length ? offerQuestion(offer) : 'Could you tell me more precisely what to change (section and wording)?')].join('\n')
        : [data.message.trim() || question || 'No changes were needed for that request.', question && data.message.trim() && !data.message.includes(question) ? question : '', offer.skills?.length && !/\?\s*$/.test(data.message.trim()) ? offerQuestion(offer) : ''].filter(Boolean).join('\n\n');
      return {
        changed: false,
        message: await this.say(row.id, 'assistant', stripReupload(text), current.id, { kind: question || offer.skills?.length || offer.projects?.length ? 'question' : 'info', warnings: claimedChanges ? [] : warnings, skillGaps: data.skillGaps, offer }),
      };
    }
    const actual = summarizeChanges(diff);
    const label = (actual[0] || instruction).replace(/\s+/g, ' ').slice(0, 80);
    const v = await this.addVersion(row, resume, { label, source: 'edit', instruction });
    const closing = question || (offer.skills?.length ? offerQuestion(offer) : '');
    const message = await this.say(row.id, 'assistant', stripReupload([data.message.trim() || 'Done — I updated your resume.', closing].filter(Boolean).join('\n\n')), v.id, {
      kind: 'edit',
      // What actually changed, computed from the versions — not what the model claims.
      changes: actual,
      warnings,
      skillGaps: data.skillGaps,
      offer,
      scoreBefore: ats?.total ?? null,
      scoreAfter: v.atsScore,
      diff,
    });
    return { changed: true, message };
  }

  /** Items worth offering: JD skills with no evidence that the user may still have, plus suggested projects. */
  private buildOffer(resume: ResumeData, row: SessionRow, skills: string[], projects: OfferedProject[], gaps: string[] = []): ChatOffer {
    const have = collectSkills(resume).map((s) => s.toLowerCase());
    const jdTerms = row.jdAnalysis ? [...row.jdAnalysis.requiredSkills, ...row.jdAnalysis.preferredSkills, ...row.jdAnalysis.atsKeywords] : [];
    const text = resumeToPlainText(resume);
    const candidates = uniqueKeywords([...skills, ...gaps.filter((g) => jdTerms.some((t) => t.toLowerCase() === g.toLowerCase()))]);
    const offerSkills = candidates.filter((s) => s.length <= 40 && !/[()]/.test(s) && !have.includes(s.toLowerCase()) && !findKeyword(text, s) && !isGenericPhrase(s)).slice(0, 8);
    const offerProjects = projects.filter((p) => p.title.trim()).slice(0, 6).map((p) => ({ title: p.title.trim().slice(0, 100), description: p.description.trim().slice(0, 400), technologies: p.technologies.slice(0, 8) }));
    return { ...(offerSkills.length ? { skills: offerSkills } : {}), ...(offerProjects.length ? { projects: offerProjects } : {}) };
  }

  // ------------------------------------------------------------------ manual edits & design

  async saveManual(id: string, token: Cred, resume: unknown, label?: string): Promise<SessionView> {
    const row = await this.authorize(id, token);
    return this.withLock(row.id, async () => {
      const fresh = (await this.store.getSession(row.id))!;
      this.assertDraft(fresh);
      const current = await this.currentVersion(fresh);
      const next = normalizeResume(resume);
      if (isMalformed(current.resume, next)) throw badRequest('The edited resume would be empty; nothing was saved.');
      if (!diffResumes(current.resume, next).length) return this.view(fresh);
      await this.addVersion(fresh, next, { label: (label || 'Manual edit').slice(0, 80), source: 'manual', instruction: null });
      return this.view(fresh);
    });
  }

  async updateDesign(
    id: string,
    token: Cred,
    patch: { template?: string; fontSize?: string; margins?: string; pageTarget?: number; pageFormat?: string; sections?: Array<{ id: string; visible: boolean; title?: string }>; style?: Record<string, unknown> | null },
  ): Promise<SessionView> {
    const row = await this.authorize(id, token);
    return this.withLock(row.id, async () => {
      const fresh = (await this.store.getSession(row.id))!;
      this.assertDraft(fresh);
      const current = await this.currentVersion(fresh);
      const next = structuredClone(current.resume);
      const changes: string[] = [];
      if (patch.template !== undefined) {
        if (!(ATS_TEMPLATE_IDS as string[]).includes(patch.template)) throw badRequest('Unknown template.');
        next.template = patch.template as ResumeData['template'];
        changes.push('template');
      }
      if (patch.fontSize !== undefined) {
        if (!['small', 'medium', 'large'].includes(patch.fontSize)) throw badRequest('Invalid font size.');
        next.fontSize = patch.fontSize as ResumeData['fontSize'];
        changes.push('font size');
      }
      if (patch.margins !== undefined || patch.pageTarget !== undefined) {
        if (patch.margins !== undefined && !['narrow', 'normal', 'wide'].includes(patch.margins)) throw badRequest('Invalid margins.');
        next.layout = { ...next.layout, margins: (patch.margins as any) ?? next.layout?.margins ?? 'normal', pageTarget: patch.pageTarget === 2 ? 2 : patch.pageTarget === 1 ? 1 : next.layout?.pageTarget ?? 1 };
        changes.push(patch.margins !== undefined ? 'margins' : 'page target');
      }
      if (patch.pageFormat !== undefined) {
        if (!['letter', 'a4'].includes(patch.pageFormat)) throw badRequest('Invalid page format.');
        next.pageFormat = patch.pageFormat as ResumeData['pageFormat'];
        changes.push('page size');
      }
      if (patch.style !== undefined) {
        // null resets to the template's own fonts, sizes and colours.
        const style = patch.style === null ? undefined : normalizeStyle({ ...(next.layout?.style || {}), ...patch.style });
        next.layout = { margins: next.layout?.margins || 'normal', pageTarget: next.layout?.pageTarget || 1, ...(style ? { style } : {}) };
        changes.push('fonts & colours');
      }
      if (Array.isArray(patch.sections)) {
        const byId = new Map(patch.sections.map((s, i) => [String(s.id), { ...s, order: i }]));
        next.sections = normalizeSections(
          normalizeSections(next.sections).map((s) => {
            const n = byId.get(s.id);
            return n ? { ...s, visible: n.visible !== false, title: n.title ? sanitizeText(n.title, 60) : s.title, order: n.order } : { ...s, order: 100 + s.order };
          }),
        );
        changes.push('sections');
      }
      if (!changes.length) throw badRequest('Nothing to update.');
      if (!diffResumes(current.resume, next).length) return this.view(fresh);
      const onlyDesign = !Array.isArray(patch.sections);
      await this.addVersion(fresh, next, { label: `Changed ${changes.join(', ')}`, source: 'template', instruction: null }, onlyDesign ? { semantic: current.ats?.semantic ?? null } : {});
      return this.view(fresh);
    });
  }

  // ------------------------------------------------------------------ ATS

  async atsScore(id: string, token?: Cred): Promise<{ ats: AtsResult | null; previousScore: number | null }> {
    const view = await this.get(id, token);
    return { ats: view.ats, previousScore: view.previousScore };
  }

  async recalculate(id: string, token?: Cred): Promise<SessionView> {
    const row = await this.authorize(id, token);
    return this.withLock(row.id, async () => {
      const fresh = (await this.store.getSession(row.id))!;
      if (!fresh.jdAnalysis) throw badRequest('Add a job description first so the score can be calculated.');
      const current = await this.currentVersion(fresh);
      const ats = await this.computeAts(fresh, current.resume, 'compute');
      if (ats) await this.store.updateVersionAts(current.id, ats, ats.total);
      return this.view(fresh);
    });
  }

  // ------------------------------------------------------------------ export, review, finish

  async exportFile(id: string, token: Cred, format: 'pdf' | 'docx', versionId?: string) {
    const row = await this.authorize(id, token);
    const v = versionId ? await this.store.getVersion(row.id, versionId) : await this.currentVersion(row);
    if (!v) throw notFound('Version not found.');
    return format === 'pdf' ? renderPdf(v.resume) : renderDocx(v.resume);
  }

  async review(id: string, token?: Cred): Promise<ReviewData> {
    const view = await this.get(id, token);
    const { pageCount } = await renderPdf(view.current);
    const target = view.current.layout?.pageTarget ?? 1;
    const warnings: string[] = [];
    if (pageCount > target) warnings.push(`The resume is ${pageCount} pages but your target is ${target}. Try “Reduce this resume to one page” or choose the Minimal template.`);
    for (const c of view.ats?.checks.filter((x) => !x.passed) || []) warnings.push(`${c.label}: ${c.detail}`);
    if (!view.jdAnalysis) warnings.push('No job description has been added, so no ATS score is available.');
    return {
      resume: view.current,
      ats: view.ats,
      pageCount,
      template: view.current.template,
      warnings,
      missingKeywords: view.ats ? [...view.ats.requiredMissing, ...view.ats.preferredMissing] : [],
    };
  }

  async finish(id: string, token?: Cred): Promise<SessionView> {
    const row = await this.authorize(id, token);
    return this.withLock(row.id, async () => {
      const fresh = (await this.store.getSession(row.id))!;
      fresh.status = 'finalized';
      fresh.updatedAt = ts();
      await this.store.updateSession(fresh.id, { status: 'finalized', updatedAt: fresh.updatedAt });
      const v = await this.currentVersion(fresh);
      await this.say(fresh.id, 'assistant', `Resume finalized (version ${v.number}). Your original resume, every version and this conversation are kept — you can reopen it for more edits at any time.`, v.id, { kind: 'info' });
      return this.view(fresh);
    });
  }

  async reopen(id: string, token?: Cred): Promise<SessionView> {
    const row = await this.authorize(id, token);
    return this.withLock(row.id, async () => {
      const fresh = (await this.store.getSession(row.id))!;
      if (fresh.status !== 'draft') {
        fresh.status = 'draft';
        fresh.updatedAt = ts();
        await this.store.updateSession(fresh.id, { status: 'draft', updatedAt: fresh.updatedAt });
        await this.say(fresh.id, 'assistant', 'Reopened for editing. Everything from your previous session is still here — no need to upload anything again.', fresh.currentVersionId, { kind: 'info' });
      }
      return this.view(fresh);
    });
  }

  async rename(id: string, token: Cred, title: string): Promise<SessionView> {
    const row = await this.authorize(id, token);
    const clean = sanitizeText(title, 120);
    if (!clean) throw badRequest('Title cannot be empty.');
    await this.store.updateSession(row.id, { title: clean });
    row.title = clean;
    return this.view(row);
  }

  async originalFile(id: string, token?: Cred) {
    const row = await this.authorize(id, token);
    if (!row.originalFilePath) throw notFound('This session was created from pasted text, so there is no original file.');
    const buffer = row.originalFilePath.startsWith('store:') ? await (this.store.getFile?.(row.id) ?? null) : await fs.readFile(row.originalFilePath).catch(() => null);
    if (!buffer) throw notFound('The original file is no longer available.');
    return { buffer, name: row.originalFileName || 'resume', mime: row.originalFileMime || 'application/octet-stream' };
  }

  async remove(id: string, token?: Cred) {
    const row = await this.authorize(id, token);
    await this.deleteSession(row);
  }

  private async deleteSession(row: { id: string; originalFilePath: string | null }) {
    await this.store.deleteSession(row.id);
    await fs.rm(path.join(this.config.dataDir, 'uploads', row.id), { recursive: true, force: true }).catch(() => undefined);
  }

  /** Deletes expired sessions and orphaned upload folders. */
  async cleanup(): Promise<number> {
    const expired = await this.store.listExpiredSessions(new Date().toISOString());
    for (const s of expired) await this.deleteSession(s);
    const uploads = path.join(this.config.dataDir, 'uploads');
    const dirs = await fs.readdir(uploads).catch(() => [] as string[]);
    for (const d of dirs) {
      if (!/^[0-9a-f-]{36}$/i.test(d)) continue;
      const stat = await fs.stat(path.join(uploads, d)).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > 86_400_000 && !(await this.store.getSession(d))) await fs.rm(path.join(uploads, d), { recursive: true, force: true }).catch(() => undefined);
    }
    if (expired.length) logger.info('cleanup.expired', { count: expired.length });
    return expired.length;
  }

  // ------------------------------------------------------------------ helpers

  private assertDraft(row: SessionRow) {
    if (row.status === 'finalized') throw conflict('This resume is finalized. Reopen it to continue editing.', 'finalized');
  }

  private async say(sessionId: string, role: 'user' | 'assistant', content: string, versionId: string | null, meta: ChatMessageMeta): Promise<MessageRow> {
    const m: MessageRow = { id: crypto.randomUUID(), sessionId, role, content: content.slice(0, 8000), versionId, meta, createdAt: ts() };
    await this.store.insertMessage(m);
    return m;
  }

  private async lastMessage(sessionId: string): Promise<MessageRow> {
    const [m] = await this.store.listMessages(sessionId, 1);
    return m;
  }
}

/** "Tailor my resume to the JD", "optimise for this job", "regenerate for the role"… */
/**
 * A message that is (mostly) a link to a job posting, e.g. "tailor my resume for
 * https://…" or just the link. "analyse / check / match / score" alone → no rewrite.
 */
export function jobLinkRequest(text: string): { url: string; analyseOnly: boolean } | null {
  const urls = findUrls(text);
  if (!urls.length) return null;
  const rest = urls.reduce((t, u) => t.replace(u, ' '), text).trim();
  if (rest.length > 300 || /\b(portfolio|my (website|profile|github|linkedin))\b|linkedin\.com\/in\/|github\.com\/[^/\s]+\/?(\s|$)/i.test(text)) return null;
  const analyseOnly = /\b(analy[sz]e|check|match|score|compare|fit|suitable|eligible)\b/i.test(rest) && !/\b(tailor|customi[sz]e|optimi[sz]e|rewrite|update|apply|make)\b/i.test(rest);
  return { url: urls[0], analyseOnly };
}

/** "make it one page", "fit into 1 page", "reduce to two pages", "I need it in a single page". */
const FIT_PAGES = /\b(one|1|single|two|2)[\s-]?pages?\b|\bpage\s*(count|limit)\b/i;
const FIT_VERB = /\b(fit|make|reduce|shrink|compress|keep|need|want|convert|bring|get|limit|squeeze|adjust|into|within|to|in)\b/i;
export function pageFitTarget(text: string): 1 | 2 | null {
  const m = text.match(FIT_PAGES);
  if (!m || !FIT_VERB.test(text) || /\?$/.test(text.trim()) && /\b(is|are|does|will|how many)\b/i.test(text)) return null;
  return /\b(two|2)[\s-]?pages?\b/i.test(text) ? 2 : 1;
}

const TAILOR_REQUEST = /\b(tailor|re-?tailor|customi[sz]e|optimi[sz]e|re-?generate|generate)\b[^.?!\n]{0,60}\b(jd|job description|job|role|position|posting)\b/i;
const ANALYSIS_REQUEST = /\b(analy[sz]e|analysis|review|critique|evaluate|assess|feedback|rate|how (good|strong) is)\b/i;

const JD_SIGNALS = [
  /\bresponsibilit(y|ies)\b/i,
  /\brequirements?\b/i,
  /\bqualifications?\b/i,
  /\byears? of (professional )?experience\b/i,
  /\b(we are|we're) (looking|hiring|seeking)\b/i,
  /\bjob (title|description|summary)\b/i,
  /\babout (the role|the job|us)\b/i,
  /\b(nice to have|preferred|must have)\b/i,
  /\bwhat you('ll| will) (do|bring)\b/i,
  /\b(benefits|salary|compensation)\b/i,
];

/**
 * Detects a job description pasted into the chat (optionally after a short
 * instruction such as "Tailor my resume to this JD:") and returns the JD text.
 */
export function extractJobDescription(instruction: string): string | null {
  const text = instruction.trim();
  if (text.length < 350) return null;
  if (JD_SIGNALS.filter((re) => re.test(text)).length < 2) return null;
  const lines = text.split('\n');
  const first = lines[0];
  const leadIn = lines.length > 3 && first.length < 160 && /\b(tailor|jd|job description|this job|this role|optimi[sz]e|match|apply)\b/i.test(first);
  return (leadIn ? lines.slice(1).join('\n') : text).trim();
}

/** The follow-up question attached to an offer. */
export function offerQuestion(offer: ChatOffer): string {
  const parts: string[] = [];
  if (offer.skills?.length) {
    parts.push(
      `The job description also asks for ${offer.skills.join(', ')}, which ${offer.skills.length === 1 ? 'is' : 'are'} not in your resume. Do you have experience with any of ${offer.skills.length === 1 ? 'it' : 'them'}? Reply “add ${offer.skills[0]}” (or “add all”) and I’ll add ${offer.skills.length === 1 ? 'it' : 'them'} — only add what you have genuinely used — or “no” to skip.`,
    );
  }
  if (offer.projects?.length) parts.push('Reply with the numbers or names of the projects to add (for example “add 1 and 3” or “add all”). Only add projects you have built or will build.');
  return parts.join('\n\n');
}

const ORDINALS: Record<string, number> = { first: 0, '1st': 0, second: 1, '2nd': 1, two: 1, third: 2, '3rd': 2, three: 2, fourth: 3, '4th': 3, four: 3, fifth: 4, '5th': 4, five: 4, sixth: 5, '6th': 5, six: 5 };

/** Interprets a reply to an offer. Returns null when the message is not a reply to it. */
export function selectFromOffer(text: string, offer: ChatOffer): { skills: string[]; projects: OfferedProject[] } | null {
  const t = text.toLowerCase();
  const exceptIdx = t.search(/\b(except|but not|not|without|excluding)\b/);
  const included = exceptIdx >= 0 ? text.slice(0, exceptIdx) : text;
  const excluded = exceptIdx >= 0 ? text.slice(exceptIdx) : '';
  const affirmative = /^(yes|yeah|yep|yup|sure|ok(ay)?|please( do)?|do it|go ahead|add|include|all)\b/i.test(text.trim());
  const wantsAll = /\b(all|them|those|these|both|everything|it)\b/i.test(included) || /^(yes|yeah|yep|yup|sure|ok(ay)?|please do|do it|go ahead)\W*$/i.test(text.trim());
  const skillsOnly = /\bskills?\b/i.test(text) && !/\bprojects?\b/i.test(text);
  const projectsOnly = /\bprojects?\b/i.test(text) && !/\bskills?\b/i.test(text);

  const offeredSkills = offer.skills || [];
  const offeredProjects = offer.projects || [];
  let skills = offeredSkills.filter((s) => findKeyword(included, s));
  const picked = new Set<number>();
  for (const m of included.matchAll(/\b(\d)\b/g)) picked.add(Number(m[1]) - 1);
  for (const [word, i] of Object.entries(ORDINALS)) if (new RegExp(`\\b${word}\\b`, 'i').test(included)) picked.add(i);
  offeredProjects.forEach((p, i) => {
    const words = significantTokens(p.title).filter((w) => w.length > 3);
    if (words.length && words.filter((w) => included.toLowerCase().includes(w)).length / words.length >= 0.6) picked.add(i);
  });
  let projects = offeredProjects.filter((_, i) => picked.has(i));

  if (!skills.length && !projects.length) {
    if (!(affirmative && wantsAll)) return null;
    skills = projectsOnly ? [] : offeredSkills;
    projects = skillsOnly ? [] : offeredProjects;
  }
  if (excluded) {
    skills = skills.filter((s) => !findKeyword(excluded, s));
    projects = projects.filter((p) => !significantTokens(p.title).some((w) => w.length > 3 && excluded.toLowerCase().includes(w)));
  }
  return skills.length || projects.length ? { skills, projects } : null;
}

/** "Add Tableau and Statistics to my skills" → ["Tableau", "Statistics"]. Not "add more AWS keywords from my resume". */
export function explicitSkillRequest(text: string, jd: JDAnalysis | null): string[] {
  if (!/^(please\s+)?(can you\s+|could you\s+)?(add|include|put|insert|list)\b/i.test(text.trim()) && !/\b(add|include)\b.{0,60}\bskills?\b/i.test(text)) return [];
  if (/\b(section|summary|bullets?|experience|more|from my|existing|keywords?|projects?|verbs?|metrics?|details?|headline|line|certificat\w*)\b/i.test(text)) return [];
  const candidates = [...(jd ? [...jd.requiredSkills, ...jd.preferredSkills, ...jd.atsKeywords, ...jd.tools] : []), ...LEXICON.map((l) => l.label)];
  return uniqueKeywords(candidates.filter((c) => c.length > 1 && findKeyword(text, c))).filter((s) => !isGenericPhrase(s));
}

const CATEGORY_HINTS: Record<string, RegExp> = {
  data: /data|analytic|\bbi\b|database|visuali/i,
  language: /program|language|scripting|coding/i,
  cloud: /cloud|aws|azure/i,
  devops: /devops|ci\/?cd|tools?/i,
  tool: /tools?|software/i,
  web: /web|api|framework/i,
  os: /system|operating|admin/i,
  network: /network|infra/i,
  security: /secur/i,
  soft: /soft|strength|professional|competenc|interpersonal/i,
  practice: /competenc|professional|method|practice/i,
};

/** Puts a skill into the most fitting existing category, else "Additional Skills" / "Professional Skills". */
export function addSkill(r: ResumeData, skill: string) {
  if (r.skills.mode === 'simple' && !r.skills.categorized.length) {
    r.skills.simple.push(skill);
    return;
  }
  const cat = lexiconEntry(skill)?.category;
  const target = cat ? r.skills.categorized.find((c) => CATEGORY_HINTS[cat]?.test(c.name)) : undefined;
  if (target) {
    target.skills.push(skill);
    return;
  }
  const name = cat === 'soft' || cat === 'practice' ? 'Professional Skills' : 'Additional Skills';
  const existing = r.skills.categorized.find((c) => c.name === name);
  if (existing) existing.skills.push(skill);
  else r.skills.categorized.push({ id: `skills-${crypto.randomUUID().slice(0, 8)}`, name, skills: [skill] });
  r.skills.mode = 'categorized';
}

/** Defence in depth: the assistant must never ask for the resume to be uploaded again. */
export function stripReupload(text: string): string {
  const asksReupload = /\b(re-?upload|upload (it|your resume|the resume) again|send (me )?your resume again|provide your resume again|share your resume again|attach your resume)\b/i;
  // Filter sentence by sentence but keep line breaks, so bullet lists survive.
  return (
    text
      .split('\n')
      .map((line) =>
        line
          .split(/(?<=[.!?])[ \t]+/)
          .filter((s) => !asksReupload.test(s))
          .join(' ')
          .trimEnd(),
      )
      .filter((line, i, all) => line.trim() || (i > 0 && all[i - 1].trim()))
      .join('\n')
      .trim() || 'Done.'
  );
}

function toSummary(v: VersionMeta | VersionRow): VersionSummary {
  return { id: v.id, number: v.number, label: v.label, source: v.source, instruction: v.instruction, parentId: v.parentId, atsScore: v.atsScore, createdAt: v.createdAt };
}

function toChat(m: MessageRow): ChatMessage {
  return { id: m.id, role: m.role, content: m.content, versionId: m.versionId, meta: m.meta || {}, createdAt: m.createdAt };
}

function fromParse(o: ParseOutput): ResumeData {
  const r = blankResume();
  const pi = o.personalInfo || {};
  r.personalInfo = { fullName: pi.fullName || '', jobTitle: pi.headline || '', email: pi.email || '', phone: pi.phone || '', location: pi.location || '', linkedin: pi.linkedin || '', website: pi.website || '', github: pi.github || '' };
  r.summary = o.summary;
  const date = (d: string) => toIsoMonth(d) || (/present|current/i.test(d) ? '' : d);
  r.skills = { mode: 'categorized', simple: [], categorized: o.skills.filter((c) => c.skills.length).map((c) => ({ id: '', name: c.category || 'Skills', skills: c.skills })) };
  r.experience = o.experience.map((e) => ({ id: '', jobTitle: e.jobTitle, company: e.company, location: e.location, startDate: date(e.startDate), endDate: date(e.endDate), current: e.current || /present|current/i.test(e.endDate), description: e.description, bulletPoints: e.bullets }));
  r.projects = o.projects.map((p) => ({ id: '', title: p.title, description: p.description, technologies: p.technologies, liveUrl: /github\.com/i.test(p.url) ? '' : p.url, githubUrl: /github\.com/i.test(p.url) ? p.url : '', startDate: date(p.startDate), endDate: date(p.endDate) }));
  r.education = o.education.map((e) => ({ id: '', ...e }));
  r.certifications = o.certifications.map((c) => ({ id: '', name: c.name, issuer: c.issuer, date: date(c.date) }));
  r.achievements = o.achievements.map((text) => ({ id: '', text }));
  r.customSections = o.additionalSections.filter((s) => s.title || s.content).map((s, i) => ({ id: '', title: s.title, content: s.content, type: /\n/.test(s.content) ? 'bullets' : 'paragraph', visible: true, order: i }));
  return normalizeResume(r);
}

/** No-AI fallback: re-prioritise existing skills and sections without rewriting any text. */
export function deterministicTailor(original: ResumeData, jd: JDAnalysis): ResumeData {
  const out = normalizeResume(structuredClone(original));
  const important = [...jd.requiredSkills, ...jd.preferredSkills, ...jd.atsKeywords];
  const rank = (skill: string) => {
    const i = important.findIndex((k) => findKeyword(skill, k) || findKeyword(k, skill));
    return i < 0 ? 1000 : i;
  };
  out.skills = {
    ...out.skills,
    simple: [...out.skills.simple].sort((a, b) => rank(a) - rank(b)),
    categorized: out.skills.categorized
      .map((c) => ({ ...c, skills: [...c.skills].sort((a, b) => rank(a) - rank(b)) }))
      .sort((a, b) => Math.min(...a.skills.map(rank)) - Math.min(...b.skills.map(rank))),
  };
  return out;
}
