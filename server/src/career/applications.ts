import fs from 'node:fs/promises';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import type { ApplicationStage, JobApplication, JobSourceId, LogEntry, TrackerStage } from '../../../shared/careerTypes.js';
import { TRACKER_STAGES } from '../../../shared/careerTypes.js';
import type { ResumeData } from '../../../shared/resumeTypes.js';
import { resumeToPlainText } from '../../../shared/normalize.js';
import type { DocBase } from '../db/store.js';
import { AIUnavailableError, HttpError, badRequest, conflict, notFound } from '../errors.js';
import { logger } from '../logger.js';
import { injectionSignals } from '../ai/guard.js';
import { coverLetter as coverPrompt, runPrompt } from '../ai/prompts/index.js';
import { type CareerContext, hashOf, newId, now } from './context.js';
import type { ProfileService } from './profile.js';
import { decide, getAgentSettings } from './agentSettings.js';
import { normQuestion } from './profile.js';
import { experienceRequirement } from '../../../shared/experience.js';
import type { Page } from 'playwright-core';
import { matchResume } from './matching.js';
import { type JobPosting, dedupeKeys } from './jobs/types.js';
import { readJobLink } from './jobs/readers.js';
import type { BrowserManager } from './automation/browser.js';
import { AnswerEngine } from './automation/answers.js';
import { runApplier } from './automation/appliers.js';

/**
 * Applications: the pipeline shared by Single Job Apply and the job agent,
 * plus the tracker (stages after applying, notes, follow-ups).
 *
 *   found → matched → tailoring → ready ─(approve / auto)→ applying → applied
 *                                  ↘ needs_attention / skipped / failed
 *   applied → interview → offer | rejected | no_response | withdrawn
 */

/** Stored application: also remembers whether to submit once you have answered its questions. */
export type AppDoc = JobApplication & DocBase & { submitAfterAnswers?: boolean };

const FOLLOW_UP_DAYS = 7;
const ACTIVE_STAGES: ApplicationStage[] = ['tailoring', 'applying'];

export class ApplicationService {
  /** Applications with a pipeline step running in this process. */
  private active = new Set<string>();
  private prepChain: Promise<unknown> = Promise.resolve();
  /** Tabs an application left open (paused for your answers), closed when it runs again. */
  private openPages = new Map<string, Page>();

  constructor(
    private ctx: CareerContext,
    private profiles: ProfileService,
    private browser: BrowserManager,
  ) {}

  // ------------------------------------------------------------------ storage helpers

  private async load(owner: string, id: string): Promise<AppDoc> {
    const doc = await this.ctx.store.docGet<AppDoc>('job_applications', id);
    if (!doc || doc.ownerUid !== owner) throw notFound('Application not found.');
    return this.heal(doc);
  }

  private async save(doc: AppDoc): Promise<AppDoc> {
    doc.updatedAt = now();
    doc.log = doc.log.slice(-200);
    doc.timeline = doc.timeline.slice(-100);
    await this.ctx.store.docPut('job_applications', doc);
    return doc;
  }

  /** A step that was running when the server stopped can never finish: say so and allow Retry. */
  private async heal(raw: AppDoc): Promise<AppDoc> {
    // Applications saved before these fields existed.
    const doc = raw;
    doc.waitingFor ??= null;
    doc.pendingQuestions ??= [];
    doc.answerOverrides ??= [];
    doc.experienceRequired ??= '';
    // Only when no process has touched it for a while: on serverless hosts another instance may still be working on it.
    const stale = Date.now() - Date.parse(doc.updatedAt) > 15 * 60_000;
    if (ACTIVE_STAGES.includes(doc.stage) && !this.active.has(doc.id) && stale) {
      moveTo(doc, 'needs_attention', 'Interrupted (the app was restarted or the step crashed). Click Retry.');
      await this.save(doc);
    }
    return doc;
  }

  async list(owner: string): Promise<JobApplication[]> {
    const docs = await this.ctx.store.docList<AppDoc>('job_applications', owner, 3000);
    const out: JobApplication[] = [];
    for (const d of docs) out.push(strip(await this.heal(d)));
    return out;
  }

  async get(owner: string, id: string): Promise<JobApplication> {
    return strip(await this.load(owner, id));
  }

  // ------------------------------------------------------------------ creation

  private blank(owner: string, p: Partial<JobPosting> & { origin: JobApplication['origin']; mode: JobApplication['mode'] }): AppDoc {
    const t = now();
    const posting = { source: (p.source || 'link') as JobSourceId, externalId: p.externalId || '', company: p.company || '', title: p.title || '' };
    return {
      id: newId(),
      ownerUid: owner,
      origin: p.origin,
      source: posting.source,
      externalId: posting.externalId,
      dedupeKey: p.externalId ? dedupeKeys(posting).primary : '',
      jobUrl: p.jobUrl || '',
      applyUrl: p.applyUrl || p.jobUrl || '',
      jobTitle: posting.title,
      company: posting.company,
      location: p.location || '',
      remote: !!p.remote,
      postedAt: p.postedAt || null,
      description: p.description || '',
      jdAnalysis: null,
      injectionSignals: [],
      matchScore: null,
      atsBefore: null,
      atsAfter: null,
      matchedSkills: [],
      missingSkills: [],
      resumeSessionId: null,
      resumeVersionId: null,
      hasResumePdf: false,
      coverLetter: '',
      answers: [],
      waitingFor: null,
      pendingQuestions: [],
      answerOverrides: [],
      experienceRequired: '',
      mode: p.mode,
      stage: 'found',
      reason: '',
      timeline: [{ at: t, stage: 'found', note: p.origin === 'single' ? 'Link pasted' : p.origin === 'agent' ? `Found by the job agent (${posting.source})` : 'Added manually' }],
      log: [],
      appliedAt: null,
      interviewAt: null,
      followUpAt: null,
      notes: '',
      createdAt: t,
      updatedAt: t,
    };
  }

  /** An existing application for the same job (same source id, or same company + title). */
  async findDuplicate(owner: string, p: Pick<JobPosting, 'source' | 'externalId' | 'company' | 'title'>, apps?: JobApplication[]): Promise<JobApplication | null> {
    const keys = dedupeKeys(p);
    const all = apps || (await this.list(owner));
    return (
      all.find((a) => a.dedupeKey && a.dedupeKey === keys.primary) ||
      (p.company && p.title ? all.find((a) => a.company && a.jobTitle && dedupeKeys({ source: a.source, externalId: a.externalId, company: a.company, title: a.jobTitle }).fuzzy === keys.fuzzy) : undefined) ||
      null
    );
  }

  /** Single Job Apply: create from a pasted link and run the pipeline in the background. */
  async createFromLink(owner: string, input: { url: string; resumeId?: string | null; mode: 'review' | 'auto' }): Promise<JobApplication> {
    const url = new URL(input.url.trim()).toString();
    const all = await this.list(owner);
    const same = all.find((a) => a.jobUrl === url || a.applyUrl === url);
    if (same && !['skipped', 'failed'].includes(same.stage)) return same;
    const doc = this.blank(owner, { origin: 'single', mode: input.mode, jobUrl: url, applyUrl: url });
    log(doc, 'info', 'Reading the job page…');
    await this.save(doc);
    this.background(doc.id, () => this.runSingle(owner, doc.id, input.resumeId || null));
    return strip(doc);
  }

  /** Manual tracker entry for a job you applied to elsewhere. */
  async createManual(owner: string, input: { jobTitle: string; company: string; jobUrl: string; location: string; stage: TrackerStage; appliedAt: string | null; notes: string }): Promise<JobApplication> {
    const doc = this.blank(owner, { origin: 'manual', mode: 'manual', jobUrl: input.jobUrl, applyUrl: input.jobUrl, title: input.jobTitle, company: input.company, location: input.location, source: 'manual', externalId: `${input.company}|${input.jobTitle}|${Date.now()}` });
    doc.notes = input.notes;
    doc.appliedAt = input.appliedAt || now();
    doc.followUpAt = input.stage === 'applied' ? addDays(doc.appliedAt, FOLLOW_UP_DAYS) : null;
    moveTo(doc, input.stage, 'Added to the tracker manually');
    return strip(await this.save(doc));
  }

  /** Job agent: create from a found posting (already matched). */
  async createFromPosting(owner: string, p: JobPosting, extra: { mode: 'review' | 'auto'; match?: { score: number; matched: string[]; missing: string[]; analysis: JobApplication['jdAnalysis'] } }): Promise<AppDoc> {
    const doc = this.blank(owner, { ...p, origin: 'agent', mode: extra.mode });
    doc.injectionSignals = injectionSignals(p.description);
    if (extra.match) {
      doc.matchScore = extra.match.score;
      doc.matchedSkills = extra.match.matched;
      doc.missingSkills = extra.match.missing;
      doc.jdAnalysis = extra.match.analysis;
      moveTo(doc, 'matched', `Match ${extra.match.score}/100`);
    }
    return this.save(doc);
  }

  // ------------------------------------------------------------------ pipeline

  private background(id: string, fn: () => Promise<unknown>) {
    this.active.add(id);
    const run = this.prepChain.then(fn, fn);
    this.prepChain = run.catch(() => undefined);
    run
      .catch((e) => logger.warn('application.pipeline.failed', { error: String((e as Error)?.message || e).slice(0, 200) }))
      .finally(() => this.active.delete(id));
  }

  /** The resume to tailor from: the one you chose, else the profile default, else your newest resume. */
  async baseResumeId(owner: string, preferred: string | null): Promise<string | null> {
    if (preferred) return preferred;
    const profile = await this.profiles.get(owner);
    if (profile.defaultResumeId) return profile.defaultResumeId;
    const mine = await this.ctx.resumes.listMine(owner, 'manual').catch(() => []);
    return mine[0]?.id || null;
  }

  private async runSingle(owner: string, id: string, resumeId: string | null) {
    const doc = await this.load(owner, id);
    try {
      const posting = await readJobLink(doc.jobUrl, (u) => this.browser.readPage(u));
      Object.assign(doc, {
        source: posting.source,
        externalId: posting.externalId,
        dedupeKey: dedupeKeys(posting).primary,
        jobTitle: posting.title || doc.jobTitle,
        company: posting.company || doc.company,
        location: posting.location,
        remote: posting.remote,
        postedAt: posting.postedAt,
        description: posting.description,
        applyUrl: posting.applyUrl || doc.applyUrl,
        injectionSignals: injectionSignals(posting.description),
      });
      log(doc, 'info', `Found the job description (${posting.description.length.toLocaleString()} characters) via ${posting.source}.`);
      if (doc.injectionSignals.length) log(doc, 'warn', `The job page contains text aimed at AI tools (${doc.injectionSignals.join(', ')}). It is treated as data only — review this posting carefully.`);
      const others = (await this.list(owner)).filter((a) => a.id !== doc.id);
      const dup = await this.findDuplicate(owner, posting, others);
      if (dup && TRACKER_STAGES.includes(dup.stage as TrackerStage)) {
        moveTo(doc, 'skipped', `Already applied on ${dup.appliedAt?.slice(0, 10) || 'an earlier date'} (${dup.jobTitle} at ${dup.company}).`);
        await this.save(doc);
        return;
      }
      await this.save(doc);
    } catch (e) {
      moveTo(doc, 'failed', e instanceof HttpError ? e.message : `Could not read the job page: ${String((e as Error).message).slice(0, 200)}`);
      await this.save(doc);
      return;
    }
    await this.prepare(owner, id, resumeId);
    await this.autoApplyIfDecided(owner, id);
  }

  /** After tailoring: apply by itself when the scores allow it (both ≥ auto-approve, or "apply automatically" chosen). */
  private async autoApplyIfDecided(owner: string, id: string) {
    const after = await this.load(owner, id);
    if (after.stage !== 'ready') return;
    const settings = await getAgentSettings(this.ctx.store, owner);
    const lowInfo = after.description.replace(/\s/g, '').length < 200;
    // Without recognised keywords the ATS score is not meaningful: judge by the match alone.
    const ats = keywordsKnown(after) ? after.atsAfter : after.matchScore;
    const decision = lowInfo ? (after.mode === 'auto' ? 'apply' : 'review') : decide(settings, after.matchScore, ats, after.mode === 'auto' ? 'auto' : undefined);
    if (decision === 'apply') {
      log(after, 'info', after.mode === 'auto' ? 'Applying automatically (you chose “apply automatically”).' : `Auto-approved: match ${after.matchScore} and tailored ATS ${after.atsAfter} are both ≥ ${settings.autoSubmitMin}.`);
      await this.save(after);
      await this.apply(owner, id, { submit: true, trigger: 'auto' });
    }
  }

  /** Prepare a job the skip rule left out (you decided to apply anyway). */
  async prepareAnyway(owner: string, id: string): Promise<JobApplication> {
    const doc = await this.load(owner, id);
    if (ACTIVE_STAGES.includes(doc.stage)) throw conflict('This application is already being processed.');
    doc.matchScore = null;
    moveTo(doc, 'matched', 'You chose to apply anyway');
    await this.save(doc);
    this.background(id, async () => {
      await this.prepare(owner, id, null, { force: true });
    });
    return strip(doc);
  }

  /**
   * Match → copy the base resume as "<Role> – <Company>" → tailor to the JD →
   * PDF of that exact version. Leaves the application "ready" (or explains why not).
   */
  async prepare(owner: string, id: string, resumeId: string | null, opts: { force?: boolean } = {}): Promise<AppDoc> {
    this.active.add(id);
    const doc = await this.load(owner, id);
    try {
      const baseId = await this.baseResumeId(owner, resumeId);
      if (!baseId) {
        moveTo(doc, 'needs_attention', 'Add a resume first (Resume Builder → upload), then click Retry.');
        return await this.save(doc);
      }
      const settings = await getAgentSettings(this.ctx.store, owner);
      const base = await this.ctx.resumes.get(baseId, { uid: owner });
      // Forms / short posts may carry almost no job text: tailoring and the ATS rule need a real description.
      const lowInfo = doc.description.replace(/\s/g, '').length < 200;
      const req = experienceRequirement(`${doc.jobTitle}\n${doc.description}`);
      doc.experienceRequired = req ? `${req.min}${req.max ? `-${req.max}` : '+'} years${req.fresherOk ? ' (freshers welcome)' : ''}` : '';
      if (doc.matchScore === null) {
        const m = matchResume(base.current, doc.description, { weights: this.ctx.config.atsWeights, original: base.original });
        Object.assign(doc, { matchScore: m.score, matchedSkills: m.matched, missingSkills: m.missing, jdAnalysis: m.analysis });
        if (!doc.jobTitle && m.analysis.jobTitle) doc.jobTitle = m.analysis.jobTitle;
        if (!doc.company && m.analysis.company) doc.company = m.analysis.company;
        moveTo(doc, 'matched', `Match ${m.score}/100 against “${base.title}”`);
      }
      if (!opts.force && !lowInfo && (doc.matchScore ?? 0) < settings.minMatch) {
        moveTo(doc, 'skipped', `ATS match ${doc.matchScore} is below ${settings.minMatch}, so this job was left automatically. Use “Apply anyway” if you still want it.`);
        return await this.save(doc);
      }
      moveTo(doc, 'tailoring', 'Tailoring your resume to this job');
      await this.save(doc);

      const profile = await this.profiles.get(owner);
      const clone = await this.ctx.resumes.cloneForJob(baseId, { uid: owner }, { title: doc.jobTitle, company: doc.company, url: doc.jobUrl, applicationId: doc.id, facts: profile.confirmedFacts });
      doc.resumeSessionId = clone.session.id;
      log(doc, 'info', `Created “${clone.session.title}” in Automation resumes.`);
      let view = clone.session;
      if (doc.description.replace(/\s/g, '').length >= 80) {
        view = await this.ctx.resumes.setJobDescription(clone.session.id, { uid: owner }, doc.description);
        doc.atsBefore = view.ats?.total ?? doc.matchScore;
        // The AI JD analysis often knows the real role/company when the page did not say.
        const jd = view.jdAnalysis;
        if (jd && ((!doc.jobTitle && jd.jobTitle) || (!doc.company && jd.company))) {
          doc.jobTitle ||= jd.jobTitle;
          doc.company ||= jd.company;
          view = await this.ctx.resumes.setJob(clone.session.id, { uid: owner }, { title: doc.jobTitle, company: doc.company });
        }
        doc.jdAnalysis = jd || doc.jdAnalysis;
        try {
          view = await this.ctx.resumes.generate(clone.session.id, { uid: owner });
          log(doc, 'info', `Tailored: ATS ${doc.atsBefore ?? '—'} → ${view.ats?.total ?? '—'}.`);
        } catch (e) {
          if (!(e instanceof AIUnavailableError)) throw e;
          log(doc, 'warn', 'The AI service was unavailable, so your resume is used as is (it still carries this job’s description). You can Retry tailoring later.');
        }
      } else {
        log(doc, 'warn', 'This link has too little job text to tailor to, so your resume is used as is.');
      }
      doc.atsAfter = view.ats?.total ?? doc.atsBefore ?? doc.matchScore;
      doc.resumeVersionId = view.currentVersion.id;
      await this.writeResumePdf(owner, doc, profile.basics.fullName || view.current.personalInfo.fullName);
      if (!opts.force && !lowInfo && keywordsKnown(doc) && (doc.atsAfter ?? 0) < settings.minMatch) {
        moveTo(doc, 'skipped', `Even after tailoring the ATS score is ${doc.atsAfter} (below ${settings.minMatch}), so this job was left automatically. Use “Apply anyway” if you still want it.`);
        return await this.save(doc);
      }
      moveTo(doc, 'ready', doc.mode === 'auto' ? 'Tailored resume ready' : 'Ready for your review');
      return await this.save(doc);
    } catch (e) {
      moveTo(doc, 'needs_attention', e instanceof HttpError ? e.message : `Tailoring failed: ${String((e as Error).message).slice(0, 200)}`);
      return await this.save(doc);
    } finally {
      this.active.delete(id);
    }
  }

  // ------------------------------------------------------------------ files

  private dir(owner: string, id: string) {
    return path.join(this.ctx.config.automation.filesDir, hashOf(owner), id);
  }

  private resumeFileName(name: string) {
    return `${(name || 'Resume').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'Resume'}_Resume.pdf`;
  }

  private async writeResumePdf(owner: string, doc: AppDoc, name: string) {
    if (!doc.resumeSessionId) return;
    const file = await this.ctx.resumes.exportFile(doc.resumeSessionId, { uid: owner }, 'pdf', doc.resumeVersionId || undefined);
    const dir = this.dir(owner, doc.id);
    await fs.mkdir(dir, { recursive: true });
    for (const f of await fs.readdir(dir).catch(() => [] as string[])) if (f.endsWith('_Resume.pdf')) await fs.rm(path.join(dir, f), { force: true });
    await fs.writeFile(path.join(dir, this.resumeFileName(name)), file.buffer, { mode: 0o600 });
    doc.hasResumePdf = true;
  }

  /** The PDF of the exact resume version prepared for this application. */
  async resumePdf(owner: string, id: string): Promise<{ buffer: Buffer; filename: string }> {
    const doc = await this.load(owner, id);
    const dir = this.dir(owner, doc.id);
    const name = (await fs.readdir(dir).catch(() => [] as string[])).find((f) => f.endsWith('_Resume.pdf'));
    if (!name) throw notFound('No tailored resume PDF for this application yet.');
    return { buffer: await fs.readFile(path.join(dir, name)), filename: name };
  }

  private async resumePath(owner: string, doc: AppDoc, fullName: string): Promise<string> {
    const dir = this.dir(owner, doc.id);
    let name = (await fs.readdir(dir).catch(() => [] as string[])).find((f) => f.endsWith('_Resume.pdf'));
    if (!name) {
      await this.writeResumePdf(owner, doc, fullName);
      name = this.resumeFileName(fullName);
    }
    return path.join(dir, name);
  }

  private async coverLetterPdf(owner: string, doc: AppDoc, text: string, fullName: string): Promise<string> {
    const dir = this.dir(owner, doc.id);
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${(fullName || 'Cover').replace(/[^A-Za-z0-9]+/g, '_')}_Cover_Letter.pdf`);
    const pdf = new PDFDocument({ size: 'A4', margin: 64 });
    const chunks: Buffer[] = [];
    pdf.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<void>((r) => pdf.on('end', () => r()));
    pdf.font('Helvetica').fontSize(11).text(text, { align: 'left', lineGap: 3 });
    pdf.end();
    await done;
    await fs.writeFile(file, Buffer.concat(chunks), { mode: 0o600 });
    return file;
  }

  // ------------------------------------------------------------------ applying

  /** Applications submitted today (local time), overall and on LinkedIn. */
  async todayCounts(owner: string, apps?: JobApplication[]): Promise<{ applied: number; linkedin: number }> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const today = (apps || (await this.list(owner))).filter((a) => a.appliedAt && a.origin !== 'manual' && new Date(a.appliedAt) >= start);
    return { applied: today.length, linkedin: today.filter((a) => a.source === 'linkedin').length };
  }

  /**
   * Your answers to the questions an application paused on. Each answer is
   * remembered in your Career Profile (unless you untick it) so the same
   * question is filled next time, then the application continues.
   */
  async provideAnswers(owner: string, id: string, input: { answers: Array<{ question: string; answer: string; remember: boolean }>; submit?: boolean }): Promise<JobApplication> {
    const doc = await this.load(owner, id);
    if (ACTIVE_STAGES.includes(doc.stage)) throw conflict('This application is already being processed.');
    if (!doc.resumeSessionId) throw conflict('Prepare the tailored resume first (Retry).');
    for (const a of input.answers) {
      const answer = a.answer.trim();
      if (!answer) continue;
      doc.answerOverrides = [...doc.answerOverrides.filter((o) => normQuestion(o.question) !== normQuestion(a.question)), { question: a.question, answer }];
      if (a.remember) await this.profiles.saveAnswer(owner, { question: a.question, answer });
    }
    const unanswered = doc.pendingQuestions.filter((q) => q.required && !doc.answerOverrides.some((o) => normQuestion(o.question) === normQuestion(q.question)));
    if (unanswered.length) throw badRequest(`Please answer: ${unanswered.map((q) => q.question).join(' · ')}`);
    const submit = input.submit ?? doc.submitAfterAnswers ?? true;
    doc.waitingFor = null;
    doc.pendingQuestions = [];
    moveTo(doc, 'applying', `You answered ${input.answers.length} question${input.answers.length === 1 ? '' : 's'}: continuing`);
    await this.save(doc);
    this.background(doc.id, () => this.apply(owner, id, { submit, trigger: 'user' }));
    return strip(doc);
  }

  /** Approve & apply (review mode) or fill only. Runs in the background; poll the application. */
  async approve(owner: string, id: string, submit: boolean): Promise<JobApplication> {
    const doc = await this.load(owner, id);
    if (!['ready', 'needs_attention', 'failed'].includes(doc.stage)) throw conflict(`This application is “${doc.stage}”; it can be applied from Ready or Needs attention.`);
    if (!doc.resumeSessionId) throw conflict('Prepare the tailored resume first (Retry).');
    moveTo(doc, 'applying', submit ? 'You approved: applying' : 'You asked to fill the form only');
    await this.save(doc);
    this.background(doc.id, () => this.apply(owner, id, { submit, trigger: 'user' }));
    return strip(doc);
  }

  async apply(owner: string, id: string, opts: { submit: boolean; trigger: 'user' | 'auto' | 'agent' }): Promise<AppDoc> {
    this.active.add(id);
    const doc = await this.load(owner, id);
    try {
      const settings = await getAgentSettings(this.ctx.store, owner);
      if (opts.trigger !== 'user') {
        const counts = await this.todayCounts(owner);
        if (counts.applied >= settings.dailyLimit) {
          moveTo(doc, 'ready', `Daily limit reached (${settings.dailyLimit}). It will wait for tomorrow or your approval.`);
          return await this.save(doc);
        }
        if (doc.source === 'linkedin' && counts.linkedin >= settings.linkedinDailyLimit) {
          moveTo(doc, 'ready', `LinkedIn daily limit reached (${settings.linkedinDailyLimit}).`);
          return await this.save(doc);
        }
      }
      const dryRun = this.ctx.config.automation.forceDryRun || settings.dryRun;
      const submit = opts.submit && !dryRun;
      if (opts.submit && dryRun) log(doc, 'warn', 'Dry run is on: the form will be filled but not submitted.');
      if (doc.stage !== 'applying') moveTo(doc, 'applying', opts.trigger === 'user' ? 'Applying' : 'Auto-applying');
      await this.save(doc);

      const profile = await this.profiles.get(owner);
      const view = await this.ctx.resumes.get(doc.resumeSessionId!, { uid: owner });
      const resumeText = resumeToPlainText(view.current, { visibleOnly: true });
      const fullName = profile.basics.fullName || view.current.personalInfo.fullName;
      const resumeFile = await this.resumePath(owner, doc, fullName);
      const ai = this.ctx.ai.available ? this.ctx.ai : null;
      const makeCover = async () => {
        if (doc.coverLetter) return doc.coverLetter;
        doc.coverLetter = await this.writeCoverLetter(view.current, doc, fullName);
        return doc.coverLetter;
      };
      const engine = new AnswerEngine({
        profile,
        resumeText,
        employers: view.original.experience.map((e) => e.company).filter(Boolean),
        job: { title: doc.jobTitle, company: doc.company, description: doc.description.slice(0, 12_000), source: doc.source },
        coverLetter: makeCover,
        wantCoverLetter: settings.coverLetters,
        ai,
        overrides: doc.answerOverrides,
      });
      // A tab left open by an earlier attempt (paused for your answers) is replaced by this run.
      await this.openPages.get(doc.id)?.close().catch(() => undefined);
      this.openPages.delete(doc.id);
      const outcome = await this.browser.exclusive((bctx) =>
        runApplier(
          bctx,
          { applyUrl: doc.applyUrl || doc.jobUrl, jobUrl: doc.jobUrl, source: doc.source, jobTitle: doc.jobTitle, company: doc.company, submit },
          {
            engine,
            files: { resume: resumeFile, cover: async () => (settings.coverLetters ? this.coverLetterPdf(owner, doc, await makeCover(), fullName) : null) },
            log: (m) => log(doc, 'info', m),
            reviewAnswers: settings.reviewAnswers,
            confirmed: doc.answerOverrides.map((o) => o.question),
            onPage: (p) => this.openPages.set(doc.id, p),
          },
        ),
      );
      doc.answers = outcome.answers;
      doc.waitingFor = null;
      doc.pendingQuestions = [];
      if (outcome.status === 'submitted') {
        doc.appliedAt = now();
        doc.followUpAt = addDays(doc.appliedAt, FOLLOW_UP_DAYS);
        this.openPages.delete(doc.id);
        moveTo(doc, 'applied', outcome.reason || (opts.trigger === 'user' ? 'Submitted' : 'Submitted automatically'));
      } else if (outcome.status === 'needs_input' || outcome.status === 'needs_review') {
        doc.waitingFor = outcome.status === 'needs_input' ? 'answers' : 'review';
        doc.pendingQuestions = outcome.questions || [];
        doc.submitAfterAnswers = opts.submit;
        moveTo(doc, 'needs_attention', outcome.reason);
      } else if (outcome.status === 'filled') {
        moveTo(doc, 'needs_attention', outcome.reason);
      } else {
        moveTo(doc, outcome.status === 'failed' ? 'failed' : 'needs_attention', outcome.reason);
      }
      return await this.save(doc);
    } catch (e) {
      moveTo(doc, 'needs_attention', `Could not apply: ${String((e as Error).message).split('\n')[0].slice(0, 240)}`);
      return await this.save(doc);
    } finally {
      this.active.delete(id);
    }
  }

  /** Cover letter from resume facts (AI), or a plain template when AI is unavailable. */
  private async writeCoverLetter(resume: ResumeData, doc: AppDoc, fullName: string): Promise<string> {
    if (this.ctx.ai.available) {
      try {
        const { data } = await runPrompt(this.ctx.ai, coverPrompt, { resumeText: resumeToPlainText(resume, { visibleOnly: true }), job: { title: doc.jobTitle, company: doc.company, description: doc.description.slice(0, 10_000) }, candidateName: fullName });
        if (data.coverLetter.length > 200) return data.coverLetter;
      } catch {
        /* template below */
      }
    }
    const skills = doc.matchedSkills.slice(0, 4).join(', ');
    const latest = resume.experience[0];
    return [
      `Dear Hiring Team,`,
      ``,
      `I am applying for the ${doc.jobTitle || 'open'} role${doc.company ? ` at ${doc.company}` : ''}.${latest ? ` Most recently I worked as ${latest.jobTitle} at ${latest.company}.` : ''}${skills ? ` My resume shows hands-on work with ${skills}, which this role asks for.` : ''}`,
      ``,
      `My resume is attached with the details. I would welcome the chance to discuss how I can help your team.`,
      ``,
      `Kind regards,`,
      fullName || '',
    ].join('\n');
  }

  // ------------------------------------------------------------------ tracker actions

  async retry(owner: string, id: string): Promise<JobApplication> {
    const doc = await this.load(owner, id);
    if (ACTIVE_STAGES.includes(doc.stage)) throw conflict('This application is already being processed.');
    if (!doc.description) {
      moveTo(doc, 'found', 'Retrying: reading the job page');
      await this.save(doc);
      this.background(id, () => this.runSingle(owner, id, null));
    } else {
      doc.matchScore = doc.resumeSessionId ? doc.matchScore : null;
      moveTo(doc, 'matched', 'Retrying: tailoring');
      await this.save(doc);
      this.background(id, () => this.prepare(owner, id, null));
    }
    return strip(doc);
  }

  async setStage(owner: string, id: string, input: { stage: ApplicationStage; note?: string; interviewAt?: string | null }): Promise<JobApplication> {
    const doc = await this.load(owner, id);
    if (ACTIVE_STAGES.includes(doc.stage)) throw conflict('Wait until the current step finishes.');
    if (!TRACKER_STAGES.includes(input.stage as TrackerStage) && input.stage !== 'skipped') throw badRequest('Stage must be one of: applied, interview, offer, rejected, no_response, withdrawn or skipped.');
    if (input.stage === 'applied' && !doc.appliedAt) {
      doc.appliedAt = now();
      doc.followUpAt = addDays(doc.appliedAt, FOLLOW_UP_DAYS);
    }
    if (input.stage === 'interview') {
      doc.interviewAt = input.interviewAt ?? doc.interviewAt;
      doc.followUpAt = null;
    }
    if (['offer', 'rejected', 'withdrawn', 'no_response'].includes(input.stage)) doc.followUpAt = null;
    moveTo(doc, input.stage, input.note || (input.stage === 'applied' ? 'Marked as applied' : `Moved to ${input.stage.replace('_', ' ')}`));
    return strip(await this.save(doc));
  }

  async update(owner: string, id: string, input: { notes?: string; followUpAt?: string | null; interviewAt?: string | null; jobTitle?: string; company?: string }): Promise<JobApplication> {
    const doc = await this.load(owner, id);
    if (input.notes !== undefined) doc.notes = input.notes;
    if (input.followUpAt !== undefined) doc.followUpAt = input.followUpAt;
    if (input.interviewAt !== undefined) doc.interviewAt = input.interviewAt;
    if (input.jobTitle !== undefined) doc.jobTitle = input.jobTitle;
    if (input.company !== undefined) doc.company = input.company;
    if ((input.jobTitle !== undefined || input.company !== undefined) && doc.resumeSessionId) {
      await this.ctx.resumes.setJob(doc.resumeSessionId, { uid: owner }, { title: doc.jobTitle, company: doc.company }).catch(() => undefined);
    }
    return strip(await this.save(doc));
  }

  async remove(owner: string, id: string): Promise<void> {
    const doc = await this.load(owner, id);
    if (ACTIVE_STAGES.includes(doc.stage)) throw conflict('Wait until the current step finishes.');
    await this.ctx.store.docDelete('job_applications', doc.id);
    await fs.rm(this.dir(owner, doc.id), { recursive: true, force: true }).catch(() => undefined);
  }
}

// ------------------------------------------------------------------ helpers

export function moveTo(doc: JobApplication, stage: ApplicationStage, note: string) {
  const at = now();
  doc.stage = stage;
  doc.reason = ['needs_attention', 'failed', 'skipped'].includes(stage) || stage === 'ready' ? note : '';
  doc.timeline.push({ at, stage, note: note.slice(0, 500) });
  doc.log.push({ at, level: stage === 'failed' ? 'error' : stage === 'needs_attention' ? 'warn' : 'info', message: note.slice(0, 500) });
}

export function log(doc: JobApplication, level: LogEntry['level'], message: string) {
  doc.log.push({ at: now(), level, message: message.slice(0, 500) });
}

/** The job analysis recognised skills/keywords, so ATS scores for it are meaningful. */
export function keywordsKnown(doc: Pick<JobApplication, 'jdAnalysis'>): boolean {
  const a = doc.jdAnalysis;
  return !!a && a.requiredSkills.length + a.preferredSkills.length + a.atsKeywords.length > 0;
}

export function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();
}

function strip(doc: AppDoc | JobApplication): JobApplication {
  const { ownerUid: _o, submitAfterAnswers: _s, ...rest } = doc as AppDoc;
  return rest;
}
