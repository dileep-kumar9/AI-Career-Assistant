import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { AnswerAnalysis, AnswerMetrics, InterviewQuestion, InterviewSession, InterviewSummary, InterviewTurn, InterviewTurnKind } from '../../../shared/careerTypes.js';
import { interviewAssist, interviewSummary, interviewTurn, runPrompt } from '../ai/prompts/index.js';
import type { DocBase } from '../db/store.js';
import { conflict, notFound } from '../errors.js';
import { logger } from '../logger.js';
import { type CareerContext, newId, now } from './context.js';
import { type InterviewService, ruleEvaluate } from './interview.js';

/**
 * Live / coached interview sessions.
 *
 * The interviewer asks a question, listens to the answer (voice or text) and
 * decides what to say next like a real interviewer:
 *   correct & clear          → short acknowledgement → next question
 *   partial / wrong / unclear → one connecting follow-up (max 2 per question)
 *   still not there           → brief clarification + suggested answer → next question
 *   silence / "I don't know"  → a hint first; if still stuck, a model answer → next question
 * Hesitation (fillers, hedging, long pauses, very short answers) is detected
 * from the words and the browser's speech timing and reported per answer.
 * Every session is written to its own folder after each turn:
 *   <DATA_DIR>/interviews/<Role> - <Company> - <YYYY-MM-DD HH-mm>/
 *     transcript.md · session.json · job-description.txt
 */

type SessionDoc = InterviewSession & DocBase & { jobDescription: string; resumeText: string };

const MAX_FOLLOWUPS = 2;

export const StartInput = z.object({
  mode: z.enum(['live', 'coach']).default('live'),
  applicationId: z.string().max(80).optional(),
  role: z.string().trim().max(200).optional(),
  company: z.string().trim().max(200).optional(),
  jobDescription: z.string().max(30_000).optional(),
  resumeId: z.string().uuid().optional(),
  count: z.number().int().min(3).max(20).default(8),
});

export const RespondInput = z.object({
  answer: z.string().max(10_000),
  metrics: z
    .object({
      source: z.enum(['voice', 'text']),
      secondsToStart: z.number().min(0).max(3600).nullable(),
      durationSec: z.number().min(0).max(7200).nullable(),
      longPauses: z.number().int().min(0).max(500),
      speechDetected: z.boolean(),
    })
    .default({ source: 'text', secondsToStart: null, durationSec: null, longPauses: 0, speechDetected: false }),
});

// ------------------------------------------------------------------ delivery signals (deterministic)

const FILLERS = /\b(um+|uh+|erm+|hmm+|ah+|you know|basically|sort of|kind of|i mean)\b|\blike(?=,)/gi;
const HEDGES = /\b(i think|i guess|maybe|probably|not sure|i'?m not sure|i don'?t know|i do not know|perhaps|might be|i believe|i suppose|no idea|can'?t remember|don'?t remember)\b/gi;
const GIVE_UP = /^\s*(i\s+)?(don'?t|do not)\s+know\.?\s*$|^\s*(no idea|pass|skip|next( question)?|not sure)\.?\s*$/i;

export function deliverySignals(answer: string, m?: AnswerMetrics): { signals: string[]; confidence: AnswerAnalysis['confidence']; words: number } {
  const words = answer.trim() ? answer.trim().split(/\s+/).length : 0;
  const fillers = (answer.match(FILLERS) || []).length;
  const hedges = [...new Set((answer.match(HEDGES) || []).map((h) => h.toLowerCase()))];
  const signals: string[] = [];
  if (fillers >= 2) signals.push(`${fillers} filler words (um, uh, like…)`);
  if (hedges.length) signals.push(`hedging: “${hedges.slice(0, 4).join('”, “')}”`);
  if (m?.secondsToStart !== null && m?.secondsToStart !== undefined && m.secondsToStart >= 6) signals.push(`took ${Math.round(m.secondsToStart)} s to start`);
  if (m && m.longPauses >= 2) signals.push(`${m.longPauses} long pauses while answering`);
  if (words > 0 && words < 20) signals.push('very short answer');
  if (words > 400) signals.push('very long answer — may lose the interviewer');
  const unsure = /don'?t know|not sure|no idea|can'?t remember/i.test(answer) || hedges.length >= 3;
  const hesitant = !unsure && (fillers / Math.max(words, 1) > 0.05 || hedges.length >= 1 || (m?.longPauses ?? 0) >= 2 || (m?.secondsToStart ?? 0) >= 6);
  return { signals, confidence: unsure ? 'unsure' : hesitant ? 'hesitant' : 'confident', words };
}

// ------------------------------------------------------------------ rule-based interviewer (no AI)

function ruleTurn(q: InterviewQuestion, answer: string, delivery: ReturnType<typeof deliverySignals>, followUps: number) {
  const base = ruleEvaluate(q, answer);
  const verdict: AnswerAnalysis['verdict'] = base.score >= 7 ? 'correct' : base.score >= 4 ? 'partially_correct' : delivery.words < 12 ? 'unclear' : 'incorrect';
  const missing = q.idealPoints.filter((p) => base.missing.some((m) => m.includes(p)));
  const clarity: AnswerAnalysis['clarity'] = delivery.words < 12 ? 'unclear' : verdict === 'correct' ? 'clear' : 'somewhat_clear';
  const followUp = verdict === 'correct' || followUps >= MAX_FOLLOWUPS ? '' : missing[0] ? `Can you tell me more about ${missing[0].charAt(0).toLowerCase()}${missing[0].slice(1)}?` : 'Can you walk me through a specific example of that?';
  return {
    verdict,
    score: base.score,
    clarity,
    confidence: delivery.confidence,
    strengths: base.strengths,
    gaps: base.missing,
    followUp,
    clarification: verdict === 'correct' ? '' : `A strong answer here would cover: ${q.idealPoints.join('; ')}.`,
    acknowledgement: verdict === 'correct' ? 'Okay, good.' : 'Okay.',
    suggestion: base.missing.length ? base.missing.join(' ') : 'Keep answers specific: situation, what you did, result.',
    suggestedAnswer: base.improvedAnswer,
  };
}

function ruleAssist(q: InterviewQuestion) {
  return {
    hint: q.idealPoints[0] ? `Take your time. Think about ${q.idealPoints[0].charAt(0).toLowerCase()}${q.idealPoints[0].slice(1)}.` : 'Take your time — start with a specific situation you were in.',
    modelAnswer: `A good answer would cover:\n${q.idealPoints.map((p, i) => `${i + 1}. ${p}: [your real example]`).join('\n')}\n(Rule-based outline — add an AI key for a written model answer.)`,
  };
}

// ------------------------------------------------------------------ folder output

const safe = (s: string) => s.replace(/[<>:"/\\|?*]+/g, ' ').replace(/[.\s]+$/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);

export function folderName(role: string, company: string, at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}-${pad(at.getMinutes())}-${pad(at.getSeconds())}`;
  return [safe(role) || 'Interview', safe(company), stamp].filter(Boolean).join(' - ');
}

const LABEL: Record<InterviewTurnKind, string> = { intro: 'Interviewer', question: 'Interviewer — question', followup: 'Interviewer — follow-up', hint: 'Interviewer — hint', model_answer: 'Suggested answer', feedback: 'Interviewer', clarification: 'Interviewer — clarification', answer: 'You', closing: 'Interviewer' };

export function transcriptMarkdown(s: InterviewSession, jd: string): string {
  const lines = [`# Interview practice — ${s.role || 'Interview'}${s.company ? ` at ${s.company}` : ''}`, '', `- Date: ${new Date(s.createdAt).toLocaleString()}`, `- Mode: ${s.mode === 'live' ? 'Live AI interview (voice)' : 'Coach mode'}`, `- Questions: ${s.questions.length} (${s.method})`, `- Job description: ${jd ? 'included (job-description.txt)' : 'not provided'}`, ''];
  if (s.summary) {
    lines.push(`## Summary`, '', `Overall ${s.summary.overallScore}/10 — ${s.summary.readiness.replace('_', ' ')}`, '', `**Strengths**`, ...s.summary.strengths.map((x) => `- ${x}`), '', `**Practise next**`, ...s.summary.improve.map((x) => `- ${x}`), '');
  }
  let q = -1;
  for (const t of s.turns) {
    if (t.questionIndex !== q && t.questionIndex < s.questions.length) {
      q = t.questionIndex;
      lines.push(`## Question ${q + 1}: ${s.questions[q].question}`, `_${s.questions[q].category}${s.questions[q].skill ? ` · ${s.questions[q].skill}` : ''}_`, '');
    }
    if (t.kind === 'question') continue;
    lines.push(`**${LABEL[t.kind]}:** ${t.text}`, '');
    if (t.analysis) {
      const a = t.analysis;
      lines.push(`> ${a.verdict.replace('_', ' ')} · ${a.score}/10 · clarity: ${a.clarity.replace('_', ' ')} · confidence: ${a.confidence}${a.deliverySignals.length ? ` · ${a.deliverySignals.join('; ')}` : ''}`);
      if (a.strengths.length) lines.push(`> Good: ${a.strengths.join(' | ')}`);
      if (a.gaps.length) lines.push(`> Missing: ${a.gaps.join(' | ')}`);
      if (a.suggestion) lines.push(`> Tip: ${a.suggestion}`);
      if (a.suggestedAnswer) lines.push('>', `> Stronger answer: ${a.suggestedAnswer.replace(/\n/g, '\n> ')}`);
      lines.push('');
    }
  }
  return lines.join('\n');
}

// ------------------------------------------------------------------ service

export class InterviewSessionService {
  constructor(
    private ctx: CareerContext,
    private interviews: InterviewService,
  ) {}

  private root() {
    return path.resolve(process.env.INTERVIEWS_DIR || path.join(this.ctx.config.dataDir, 'interviews'));
  }

  private async load(owner: string, id: string): Promise<SessionDoc> {
    const d = await this.ctx.store.docGet<SessionDoc>('interview_sessions', id);
    if (!d || d.ownerUid !== owner) throw notFound('Interview session not found.');
    return d;
  }

  /** Saves to the database and rewrites the session folder (transcript.md, session.json, job-description.txt). */
  private async save(doc: SessionDoc): Promise<InterviewSession> {
    doc.updatedAt = now();
    await this.ctx.store.docPut('interview_sessions', doc);
    const view = strip(doc);
    try {
      const dir = path.join(this.root(), doc.folder);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'transcript.md'), transcriptMarkdown(view, doc.jobDescription), 'utf8');
      const qa = view.questions.map((q, i) => ({
        question: q.question,
        category: q.category,
        skill: q.skill,
        exchange: view.turns.filter((t) => t.questionIndex === i && t.kind !== 'question').map((t) => ({ speaker: t.speaker, kind: t.kind, text: t.text, analysis: t.analysis ?? null, metrics: t.metrics ?? null, at: t.at })),
      }));
      await fs.writeFile(path.join(dir, 'session.json'), JSON.stringify({ role: view.role, company: view.company, mode: view.mode, createdAt: view.createdAt, updatedAt: view.updatedAt, status: view.status, summary: view.summary, questionsAndAnswers: qa }, null, 2), 'utf8');
      if (doc.jobDescription) await fs.writeFile(path.join(dir, 'job-description.txt'), doc.jobDescription, 'utf8');
    } catch (e) {
      logger.warn('interview.folder.write_failed', { error: String((e as Error).message).slice(0, 160) });
    }
    return view;
  }

  folderPath(folder: string) {
    return path.join(this.root(), folder);
  }

  async list(owner: string): Promise<InterviewSession[]> {
    return (await this.ctx.store.docList<SessionDoc>('interview_sessions', owner, 200)).map(strip);
  }

  async get(owner: string, id: string) {
    return strip(await this.load(owner, id));
  }

  async transcript(owner: string, id: string) {
    const d = await this.load(owner, id);
    return { markdown: transcriptMarkdown(strip(d), d.jobDescription), filename: `${d.folder}.md` };
  }

  async remove(owner: string, id: string) {
    const d = await this.load(owner, id);
    await this.ctx.store.docDelete('interview_sessions', d.id);
    // The saved folder stays on disk: it is your record of the practice.
  }

  private turn(doc: SessionDoc, speaker: InterviewTurn['speaker'], kind: InterviewTurnKind, text: string, extra: Partial<InterviewTurn> = {}): InterviewTurn {
    const t: InterviewTurn = { id: newId(), at: now(), speaker, kind, text: text.trim(), questionIndex: doc.current, ...extra };
    doc.turns.push(t);
    return t;
  }

  private ask(doc: SessionDoc, lead = '') {
    const q = doc.questions[doc.current];
    doc.pending = { followUps: 0, hintGiven: false, asking: q.question };
    this.turn(doc, 'ai', 'question', lead ? `${lead} ${q.question}` : q.question);
  }

  private async finishInternal(doc: SessionDoc, closing = true) {
    doc.current = doc.questions.length;
    doc.status = 'finished';
    doc.pending = { followUps: 0, hintGiven: false, asking: '' };
    doc.summary = await this.summarize(doc);
    if (closing) this.turn(doc, 'ai', 'closing', `That's the end of the interview. Thank you${doc.company ? ` for your interest in ${doc.company}` : ''}. Your overall score is ${doc.summary.overallScore} out of 10 — see the summary for what to practise next.`, { questionIndex: doc.questions.length });
  }

  async start(owner: string, input: z.infer<typeof StartInput>): Promise<InterviewSession> {
    const plan = await this.interviews.plan(owner, { ...input, count: input.count });
    const t = new Date();
    const doc: SessionDoc = {
      id: newId(),
      ownerUid: owner,
      mode: input.mode,
      applicationId: plan.applicationId,
      role: plan.role,
      company: plan.company,
      hasJobDescription: !!plan.jd,
      jobDescription: plan.jd.slice(0, 30_000),
      resumeText: plan.resumeText.slice(0, 20_000),
      questions: plan.questions,
      current: 0,
      pending: { followUps: 0, hintGiven: false, asking: '' },
      turns: [],
      status: 'active',
      summary: null,
      folder: folderName(plan.role, plan.company, t),
      method: plan.method,
      createdAt: t.toISOString(),
      updatedAt: t.toISOString(),
    };
    this.turn(doc, 'ai', 'intro', `Hi, thanks for joining. This is a practice interview for the ${plan.role || 'role'}${plan.company ? ` at ${plan.company}` : ''}. I'll ask ${plan.questions.length} questions and may ask follow-ups. Take your time and think out loud.`);
    this.ask(doc, "Let's start.");
    return this.save(doc);
  }

  /** The candidate answered (or stayed silent). Decides and records what the interviewer says next. */
  async respond(owner: string, id: string, input: z.infer<typeof RespondInput>): Promise<{ session: InterviewSession; said: InterviewTurn[] }> {
    const doc = await this.load(owner, id);
    if (doc.status !== 'active') throw conflict('This interview has finished. Start a new one to practise again.');
    const q = doc.questions[doc.current];
    const before = doc.turns.length;
    const answer = input.answer.trim();
    const delivery = deliverySignals(answer, input.metrics);
    const noAnswer = delivery.words < 3 || GIVE_UP.test(answer);

    if (noAnswer) {
      if (answer) this.turn(doc, 'user', 'answer', answer, { metrics: input.metrics });
      const help = await this.assist(doc, q);
      if (!doc.pending.hintGiven) {
        doc.pending.hintGiven = true;
        this.turn(doc, 'ai', 'hint', answer ? `No problem. Here's a hint: ${help.hint}` : `I didn't hear an answer. Here's a hint: ${help.hint}`);
      } else {
        this.turn(doc, 'ai', 'model_answer', help.modelAnswer);
        await this.advance(doc, "Let's move on.");
      }
      return { session: await this.save(doc), said: doc.turns.slice(before) };
    }

    const judged = await this.judge(doc, q, answer, delivery, input.metrics);
    const analysis: AnswerAnalysis = {
      verdict: judged.verdict,
      score: Math.round(judged.score),
      clarity: judged.clarity,
      confidence: delivery.confidence === 'unsure' ? 'unsure' : judged.confidence,
      deliverySignals: delivery.signals,
      strengths: judged.strengths,
      gaps: judged.gaps,
      suggestion: judged.suggestion,
      suggestedAnswer: judged.suggestedAnswer,
      method: judged.method,
    };
    this.turn(doc, 'user', 'answer', answer, { analysis, metrics: input.metrics });
    const good = analysis.verdict === 'correct' && analysis.clarity !== 'unclear';
    if (good) {
      this.turn(doc, 'ai', 'feedback', judged.acknowledgement || 'Good.');
      await this.advance(doc);
    } else if (doc.pending.followUps < MAX_FOLLOWUPS && judged.followUp) {
      doc.pending.followUps++;
      doc.pending.asking = judged.followUp;
      this.turn(doc, 'ai', 'followup', `${judged.acknowledgement ? `${judged.acknowledgement} ` : ''}${judged.followUp}`);
    } else {
      this.turn(doc, 'ai', 'clarification', judged.clarification || `The key points here are: ${q.idealPoints.join('; ')}.`);
      await this.advance(doc, "Let's move on.");
    }
    return { session: await this.save(doc), said: doc.turns.slice(before) };
  }

  /** Candidate asks for a hint (or the UI detected a long silence). */
  async hint(owner: string, id: string): Promise<{ session: InterviewSession; said: InterviewTurn[] }> {
    return this.respond(owner, id, { answer: '', metrics: { source: 'voice', secondsToStart: null, durationSec: null, longPauses: 0, speechDetected: false } });
  }

  /** Skip the current question: show the model answer and move on. */
  async skip(owner: string, id: string): Promise<{ session: InterviewSession; said: InterviewTurn[] }> {
    const doc = await this.load(owner, id);
    if (doc.status !== 'active') throw conflict('This interview has finished.');
    const before = doc.turns.length;
    const help = await this.assist(doc, doc.questions[doc.current]);
    this.turn(doc, 'ai', 'model_answer', help.modelAnswer);
    await this.advance(doc, 'Next question.');
    return { session: await this.save(doc), said: doc.turns.slice(before) };
  }

  async finish(owner: string, id: string): Promise<InterviewSession> {
    const doc = await this.load(owner, id);
    if (doc.status === 'finished') return strip(doc);
    await this.finishInternal(doc);
    return this.save(doc);
  }

  private async advance(doc: SessionDoc, lead = '') {
    if (doc.current + 1 >= doc.questions.length) return this.finishInternal(doc);
    doc.current++;
    this.ask(doc, lead ? `${lead} Next question:` : 'Next question:');
  }

  private async judge(doc: SessionDoc, q: InterviewQuestion, answer: string, delivery: ReturnType<typeof deliverySignals>, _m: AnswerMetrics) {
    const followUp = doc.pending.asking !== q.question ? doc.pending.asking : '';
    if (this.ctx.ai.available) {
      try {
        const { data } = await runPrompt(this.ctx.ai, interviewTurn, {
          role: doc.role,
          company: doc.company,
          question: q.question,
          followUp,
          idealPoints: q.idealPoints,
          answer,
          delivery: delivery.signals,
          followUpsSoFar: doc.pending.followUps,
          resumeText: doc.resumeText,
          jobDescription: doc.jobDescription.slice(0, 6000),
        });
        return { ...data, method: 'ai' as const };
      } catch {
        /* rule-based below */
      }
    }
    return { ...ruleTurn(q, answer, delivery, doc.pending.followUps), method: 'rule-based' as const };
  }

  private async assist(doc: SessionDoc, q: InterviewQuestion) {
    if (this.ctx.ai.available) {
      try {
        const { data } = await runPrompt(this.ctx.ai, interviewAssist, { role: doc.role, question: doc.pending.asking || q.question, idealPoints: q.idealPoints, resumeText: doc.resumeText });
        if (data.hint && data.modelAnswer) return data;
      } catch {
        /* rules */
      }
    }
    return ruleAssist(q);
  }

  private async summarize(doc: SessionDoc): Promise<InterviewSummary> {
    const perQuestion = doc.questions.map((q, i) => {
      const answers = doc.turns.filter((t) => t.questionIndex === i && t.analysis);
      const last = answers[answers.length - 1]?.analysis;
      return { question: q.question, score: last ? last.score : null, verdict: last ? last.verdict : ('no_answer' as const) };
    });
    const scored = perQuestion.filter((p) => p.score !== null);
    const avg = scored.length ? Math.round((scored.reduce((n, p) => n + (p.score || 0), 0) / doc.questions.length) * 10) / 10 : 0;
    if (this.ctx.ai.available && doc.turns.some((t) => t.speaker === 'user')) {
      try {
        const transcript = doc.turns.map((t) => `${t.speaker === 'ai' ? 'Interviewer' : 'Candidate'} (${t.kind}${t.analysis ? `, ${t.analysis.verdict} ${t.analysis.score}/10` : ''}): ${t.text}`).join('\n');
        const { data } = await runPrompt(this.ctx.ai, interviewSummary, { role: doc.role, company: doc.company, transcript });
        return { ...data, overallScore: Math.round(data.overallScore * 10) / 10, perQuestion, method: 'ai' };
      } catch {
        /* rules */
      }
    }
    const analyses = doc.turns.map((t) => t.analysis).filter((a): a is AnswerAnalysis => !!a);
    const hesitant = analyses.filter((a) => a.confidence !== 'confident').length;
    return {
      overallScore: avg,
      readiness: avg >= 7.5 ? 'ready' : avg >= 5 ? 'almost' : 'needs_practice',
      strengths: [...new Set(analyses.flatMap((a) => a.strengths))].slice(0, 5),
      improve: [
        ...perQuestion.filter((p) => p.verdict !== 'correct').slice(0, 3).map((p) => `Revisit: ${p.question}`),
        ...(hesitant > analyses.length / 2 ? ['Answer more confidently: fewer fillers and hedges, start with the main point'] : []),
      ],
      perQuestion,
      method: 'rule-based',
    };
  }
}

function strip(d: SessionDoc): InterviewSession {
  const { ownerUid: _o, jobDescription: _j, resumeText: _r, ...rest } = d;
  return rest;
}
