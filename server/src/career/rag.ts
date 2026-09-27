import type { JobApplication } from '../../../shared/careerTypes.js';
import { STAGE_LABELS } from '../../../shared/careerTypes.js';
import { resumeToPlainText } from '../../../shared/normalize.js';
import type { DocBase } from '../db/store.js';
import { redactSecrets } from '../ai/guard.js';
import { logger } from '../logger.js';
import { type CareerContext, hashOf, now } from './context.js';
import type { ApplicationService } from './applications.js';
import type { AgentService } from './agent.js';
import type { InterviewService } from './interview.js';
import { type ProfileService, profileToText } from './profile.js';
import type { SkillsService } from './skills.js';

/**
 * Retrieval over the user's own records (never the web): Career Profile,
 * default resume, applications + their JDs, interview practice, learning
 * plans and agent runs. Ranking is BM25 (always, free, deterministic),
 * blended with Gemini embeddings when a key is configured (cached per chunk
 * in aca_kb_chunks so each text is embedded once).
 */

export interface Chunk {
  id: string;
  source: 'profile' | 'resume' | 'application' | 'job_description' | 'interview' | 'learning' | 'agent';
  label: string;
  text: string;
  /** Application id / resume id the chunk is about (for actions and links). */
  ref?: string;
}

interface VectorDoc extends DocBase {
  model: string;
  vector: number[];
}

const date = (iso: string | null) => (iso ? iso.slice(0, 10) : '—');

export function splitText(text: string, size = 900, overlap = 150): string[] {
  const clean = text.replace(/\n{3,}/g, '\n\n').trim();
  if (clean.length <= size) return clean ? [clean] : [];
  const out: string[] = [];
  let i = 0;
  while (i < clean.length) {
    let end = Math.min(clean.length, i + size);
    const para = clean.lastIndexOf('\n', end);
    if (para > i + size / 2 && end < clean.length) end = para;
    out.push(clean.slice(i, end).trim());
    if (end >= clean.length) break;
    i = Math.max(end - overlap, i + 1);
  }
  return out.filter(Boolean);
}

export function applicationChunk(a: JobApplication): Chunk {
  const text = [
    `Application [app:${a.id}] — ${a.jobTitle || 'Unknown role'} at ${a.company || 'unknown company'} (${a.location || 'location not stated'})`,
    `Source: ${a.source}; added via ${a.origin === 'single' ? 'Single Job Apply' : a.origin === 'agent' ? 'the job agent' : 'manual entry'} on ${date(a.createdAt)}`,
    `Stage: ${STAGE_LABELS[a.stage]}${a.reason ? ` — ${a.reason}` : ''}`,
    `Applied: ${date(a.appliedAt)}; interview: ${date(a.interviewAt)}; follow-up: ${date(a.followUpAt)}`,
    `Match score: ${a.matchScore ?? '—'}; ATS before/after tailoring: ${a.atsBefore ?? '—'} → ${a.atsAfter ?? '—'}`,
    `Matched skills: ${a.matchedSkills.join(', ') || '—'}`,
    `Missing skills: ${a.missingSkills.join(', ') || '—'}`,
    a.notes ? `Notes: ${a.notes}` : '',
    `Timeline: ${a.timeline.slice(-6).map((t) => `${date(t.at)} ${STAGE_LABELS[t.stage]}${t.note ? ` (${t.note})` : ''}`).join('; ')}`,
    a.jobUrl ? `Link: ${a.jobUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return { id: `app-${a.id}`, source: 'application', label: `${a.jobTitle} at ${a.company}`, text, ref: a.id };
}

// ------------------------------------------------------------------ BM25

const STOP = new Set('a an and are as at be by for from has have i in is it its me my of on or our so that the their them this to was were what when where which who why will with you your do does did can how'.split(' '));
export const tokenize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^\.+|\.+$/g, ''))
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => (w.length > 4 ? w.replace(/(ing|ed|es|s)$/, '') : w));

export function bm25(query: string, chunks: Chunk[], k1 = 1.4, b = 0.75): number[] {
  const q = [...new Set(tokenize(query))];
  const docs = chunks.map((c) => tokenize(`${c.label} ${c.text}`));
  const avg = docs.reduce((n, d) => n + d.length, 0) / Math.max(docs.length, 1);
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) || 0) + 1);
  return docs.map((d) => {
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) || 0) + 1);
    let score = 0;
    for (const t of q) {
      const f = tf.get(t) || 0;
      if (!f) continue;
      const idf = Math.log(1 + (docs.length - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / (avg || 1))));
    }
    return score;
  });
}

const cosine = (a: number[], b: number[]) => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
};

export class RagService {
  constructor(
    private ctx: CareerContext,
    private deps: { profiles: ProfileService; apps: ApplicationService; interviews: InterviewService; skills: SkillsService; agent: AgentService },
  ) {}

  async corpus(owner: string): Promise<{ chunks: Chunk[]; apps: JobApplication[] }> {
    const chunks: Chunk[] = [];
    const [profile, apps, sets, plans, runs] = await Promise.all([
      this.deps.profiles.get(owner),
      this.deps.apps.list(owner),
      this.deps.interviews.list(owner).catch(() => []),
      this.deps.skills.plans(owner).catch(() => []),
      this.deps.agent.runs(owner, 3).catch(() => []),
    ]);
    chunks.push({ id: 'profile', source: 'profile', label: 'Career Profile', text: profileToText(profile) });
    const resumeId = await this.deps.apps.baseResumeId(owner, null);
    if (resumeId) {
      const view = await this.ctx.resumes.get(resumeId, { uid: owner }).catch(() => null);
      if (view) splitText(resumeToPlainText(view.current, { visibleOnly: true })).forEach((t, i) => chunks.push({ id: `resume-${i}`, source: 'resume', label: `Resume “${view.title}”`, text: t, ref: view.id }));
    }
    const counts = new Map<string, number>();
    for (const a of apps) counts.set(STAGE_LABELS[a.stage], (counts.get(STAGE_LABELS[a.stage]) || 0) + 1);
    chunks.push({ id: 'apps-summary', source: 'application', label: 'Applications summary', text: `Total applications: ${apps.length}. By stage: ${[...counts.entries()].map(([k, v]) => `${k}: ${v}`).join(', ') || 'none'}. Today is ${now().slice(0, 10)}.` });
    for (const a of apps.slice(0, 300)) {
      chunks.push(applicationChunk(a));
      if (a.description) chunks.push({ id: `jd-${a.id}`, source: 'job_description', label: `Job description: ${a.jobTitle} at ${a.company}`, text: a.description.slice(0, 1600), ref: a.id });
    }
    for (const s of sets.slice(0, 20)) {
      const scored = s.attempts.slice(-10).map((t) => `${s.questions.find((q) => q.id === t.questionId)?.question.slice(0, 80)} → ${t.score}/10`);
      chunks.push({ id: `iv-${s.id}`, source: 'interview', label: `Interview prep: ${s.role} at ${s.company}`, text: `Interview practice for ${s.role} at ${s.company} (${s.questions.length} questions, ${s.attempts.length} answers). Recent scores: ${scored.join('; ') || 'none yet'}.`, ref: s.applicationId || undefined });
    }
    for (const p of plans.slice(0, 30)) chunks.push({ id: `lp-${p.id}`, source: 'learning', label: `Learning plan: ${p.skill}`, text: `Learning plan for ${p.skill} (${p.status}; ${p.steps.filter((s) => s.done).length}/${p.steps.length} steps done). Proof project: ${p.proofProject.title}. ${p.confirmation ? `Confirmed: ${p.confirmation.statement}` : ''}` });
    const missing = new Map<string, number>();
    for (const a of apps) for (const m of a.missingSkills) missing.set(m, (missing.get(m) || 0) + 1);
    if (missing.size) chunks.push({ id: 'gaps', source: 'application', label: 'Most frequent missing skills', text: `Skills most often missing from your resume in your applications: ${[...missing.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `${k} (${v} jobs)`).join(', ')}.` });
    for (const r of runs) chunks.push({ id: `run-${r.id}`, source: 'agent', label: `Agent run ${date(r.startedAt)}`, text: `Job agent run on ${r.startedAt.slice(0, 16).replace('T', ' ')} (${r.status}): ${JSON.stringify(r.counts)}. ${r.log.slice(-3).map((l) => l.message).join(' ')}` });
    return { chunks: chunks.map((c) => ({ ...c, text: redactSecrets(c.text) })), apps };
  }

  /** Top-k chunks for a question (hybrid when embeddings are available). */
  async search(owner: string, query: string, chunks: Chunk[], k = 8): Promise<Chunk[]> {
    const lexical = bm25(query, chunks);
    const maxL = Math.max(...lexical, 0.0001);
    let scores = lexical.map((s) => s / maxL);
    const vectors = await this.embedAll(owner, [query, ...chunks.map((c) => `${c.label}\n${c.text}`)]).catch((e) => {
      logger.debug('rag.embeddings.skipped', { reason: String(e?.message || e).slice(0, 120) });
      return null;
    });
    if (vectors) {
      const [qv, ...cv] = vectors;
      scores = scores.map((s, i) => 0.5 * s + 0.5 * Math.max(0, cosine(qv, cv[i])));
    }
    // Always keep the summary chunks available for counting questions.
    const ranked = chunks.map((c, i) => ({ c, s: scores[i] + (c.id === 'apps-summary' || c.id === 'profile' ? 0.05 : 0) })).sort((a, b) => b.s - a.s);
    return ranked.slice(0, k).map((r) => r.c);
  }

  private async embedAll(owner: string, texts: string[]): Promise<number[][] | null> {
    const key = this.ctx.config.ai.geminiKey;
    if (!key || process.env.NODE_ENV === 'test') return null;
    const model = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';
    const prefix = hashOf(owner).slice(0, 12);
    const ids = texts.map((t) => `${prefix}_${hashOf(`${model}|${t}`)}`);
    const out: Array<number[] | null> = await Promise.all(ids.map((id, i) => (i === 0 ? null : this.ctx.store.docGet<VectorDoc>('kb_chunks', id).then((d) => d?.vector ?? null))));
    const missing = out.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
    for (let s = 0; s < missing.length; s += 100) {
      const batch = missing.slice(s, s + 100);
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:batchEmbedContents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ requests: batch.map((i) => ({ model: `models/${model}`, content: { parts: [{ text: texts[i].slice(0, 6000) }] }, outputDimensionality: 768 })) }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`embeddings HTTP ${res.status}`);
      const data: any = await res.json();
      batch.forEach((i, j) => (out[i] = data.embeddings?.[j]?.values || null));
      await Promise.all(batch.filter((i) => i > 0 && out[i]).map((i) => this.ctx.store.docPut<VectorDoc>('kb_chunks', { id: ids[i], ownerUid: owner, updatedAt: now(), model, vector: out[i]! })));
    }
    return out.every(Boolean) ? (out as number[][]) : null;
  }
}
