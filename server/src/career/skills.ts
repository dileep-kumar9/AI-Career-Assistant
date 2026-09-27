import { z } from 'zod';
import type { LearningPlan, SkillGapReport, SkillGapRow } from '../../../shared/careerTypes.js';
import type { ResumeData } from '../../../shared/resumeTypes.js';
import type { JDAnalysis } from '../../../shared/jdAnalyzer.js';
import { scoreResume } from '../../../shared/ats.js';
import { canonicalKeyword, matchKeyword, stemSet } from '../../../shared/match.js';
import { collectSkills, resumeToPlainText } from '../../../shared/normalize.js';
import { learningPlan, runPrompt } from '../ai/prompts/index.js';
import type { DocBase } from '../db/store.js';
import { badRequest, notFound } from '../errors.js';
import { type CareerContext, newId, now } from './context.js';
import type { ApplicationService } from './applications.js';
import type { AgentService, SeenJob } from './agent.js';
import type { ProfileService } from './profile.js';
import { getAgentSettings } from './agentSettings.js';

/**
 * Skills & Learning.
 * - Gap report: skills that real job descriptions (read by the agent, plus
 *   your applications) ask for, how often, whether your resume shows them,
 *   and how many jobs would reach your auto-apply score if it did — measured
 *   by re-scoring those JDs with the skill added, not guessed.
 * - Learning plans with a proof project; confirming a finished plan records
 *   a fact that tailoring may then use honestly.
 */

type PlanDoc = LearningPlan & DocBase;

export const PlanInput = z.object({ skill: z.string().trim().min(1).max(80), targetRole: z.string().trim().max(120).optional() });
export const PlanUpdate = z.object({ stepsDone: z.array(z.boolean()).max(20).optional(), status: z.enum(['planned', 'learning', 'done']).optional() });
export const ConfirmInput = z.object({ statement: z.string().trim().min(10).max(600), projectUrl: z.string().trim().max(500).url().or(z.literal('')).default('') });

function fullAnalysis(a: Partial<JDAnalysis>): JDAnalysis {
  return {
    jobTitle: a.jobTitle || '',
    company: a.company || '',
    requiredSkills: a.requiredSkills || [],
    preferredSkills: a.preferredSkills || [],
    tools: a.tools || [],
    experienceRequirements: a.experienceRequirements || [],
    minYears: a.minYears ?? null,
    education: a.education || [],
    educationLevel: a.educationLevel ?? 0,
    certifications: a.certifications || [],
    responsibilities: a.responsibilities || [],
    industryKeywords: a.industryKeywords || [],
    atsKeywords: a.atsKeywords || [],
    source: a.source || 'deterministic',
  };
}

/** The resume with one more skill listed (for measuring what showing that skill would change). */
export function withSkill(r: ResumeData, skill: string): ResumeData {
  const copy: ResumeData = JSON.parse(JSON.stringify(r));
  if (copy.skills.mode === 'categorized' && copy.skills.categorized.length) copy.skills.categorized[0].skills.push(skill);
  else copy.skills.simple.push(skill);
  return copy;
}

export function gapRows(resume: ResumeData, jobs: JDAnalysis[], autoSubmitMin: number, maxMeasured = 15): SkillGapRow[] {
  const text = resumeToPlainText(resume);
  const stems = stemSet(text);
  const agg = new Map<string, { skill: string; jobs: number; required: number }>();
  for (const a of jobs) {
    const seen = new Set<string>();
    for (const [list, req] of [
      [a.requiredSkills, true],
      [a.preferredSkills, false],
    ] as const) {
      for (const s of list) {
        const key = canonicalKeyword(s);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const row = agg.get(key) || { skill: s, jobs: 0, required: 0 };
        row.jobs++;
        if (req) row.required++;
        agg.set(key, row);
      }
    }
  }
  const rows: SkillGapRow[] = [...agg.values()]
    .filter((r) => r.jobs >= (jobs.length >= 10 ? 2 : 1))
    .map((r) => ({
      skill: r.skill,
      jobs: r.jobs,
      demandPct: jobs.length ? Math.round((r.jobs / jobs.length) * 100) : 0,
      inResume: matchKeyword(text, r.skill, stems) !== 'missing',
      unlocks: 0,
      importance: r.required >= r.jobs / 2 ? ('required' as const) : ('preferred' as const),
    }))
    .sort((a, b) => b.jobs - a.jobs)
    .slice(0, 40);
  // Measure: which missing skills would push jobs over the auto-apply score?
  const baseScores = jobs.map((a) => scoreResume(resume, a, { semantic: null }).total);
  for (const row of rows.filter((r) => !r.inResume).slice(0, maxMeasured)) {
    const plus = withSkill(resume, row.skill);
    row.unlocks = jobs.reduce((n, a, i) => (baseScores[i] < autoSubmitMin && scoreResume(plus, a, { semantic: null }).total >= autoSubmitMin ? n + 1 : n), 0);
  }
  return rows;
}

function rulePlan(skill: string, role: string): Omit<LearningPlan, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'confirmation' | 'method'> {
  return {
    skill,
    targetRole: role,
    overview: `${skill} appears in the jobs you are targeting${role ? ` (${role})` : ''}. This plan takes you from the basics to a small project you can show. (Rule-based plan — add an AI key for a tailored one.)`,
    steps: [
      { title: `Understand what ${skill} is for`, detail: `Read the official overview and note the 5-10 core concepts and where ${skill} is used in ${role || 'your target role'}.`, hours: 3, done: false },
      { title: 'Set up a practice environment', detail: `Install or get free/trial access to ${skill} and follow the official quick-start end to end.`, hours: 3, done: false },
      { title: 'Learn the core features hands-on', detail: 'Work through a beginner course or tutorial series, typing every example yourself.', hours: 8, done: false },
      { title: 'Solve realistic tasks', detail: `Do practice exercises or labs that mirror job tasks mentioned in ${role || 'the'} job descriptions.`, hours: 6, done: false },
      { title: 'Build and publish the proof project', detail: 'Complete the project below, write a README with screenshots and what you learned, and publish it.', hours: 8, done: false },
    ],
    resources: [
      { type: 'docs', title: `${skill} official documentation`, searchQuery: `${skill} official documentation getting started` },
      { type: 'course', title: `Free ${skill} beginner course`, searchQuery: `${skill} free course for beginners` },
      { type: 'video', title: `${skill} tutorial walkthrough`, searchQuery: `${skill} tutorial full course` },
      { type: 'practice', title: `${skill} hands-on labs`, searchQuery: `${skill} hands-on lab exercises` },
    ],
    proofProject: {
      title: `${skill} mini project for ${role || 'your portfolio'}`,
      description: `A small, real project that uses ${skill} for a task typical of ${role || 'the role'} — something you can demo in 5 minutes.`,
      deliverables: ['Public repository or write-up with a README', 'Screenshots or a short demo', 'A section on what you learned and what you would improve'],
    },
  };
}

export class SkillsService {
  constructor(
    private ctx: CareerContext,
    private apps: ApplicationService,
    private agent: AgentService,
    private profiles: ProfileService,
  ) {}

  async gapReport(owner: string, opts: { role?: string; days?: number } = {}): Promise<SkillGapReport> {
    const days = opts.days ?? 30;
    const resumeId = await this.apps.baseResumeId(owner, null);
    if (!resumeId) throw badRequest('Add a resume first.');
    const resume = (await this.ctx.resumes.get(resumeId, { uid: owner })).current;
    const seen: SeenJob[] = await this.agent.seen(owner, days);
    const apps = (await this.apps.list(owner)).filter((a) => a.jdAnalysis && Date.parse(a.createdAt) >= Date.now() - days * 86_400_000);
    const role = (opts.role || '').toLowerCase();
    const byRole = (title: string) => !role || title.toLowerCase().includes(role) || role.split(/\s+/).every((w) => title.toLowerCase().includes(w));
    const analyses: JDAnalysis[] = [];
    const usedApps = new Set<string>();
    for (const s of seen) {
      if (!s.analysis || !byRole(s.title)) continue;
      if (s.applicationId) usedApps.add(s.applicationId);
      analyses.push(fullAnalysis(s.analysis));
    }
    for (const a of apps) if (!usedApps.has(a.id) && byRole(a.jobTitle)) analyses.push(fullAnalysis(a.jdAnalysis!));
    const settings = await getAgentSettings(this.ctx.store, owner);
    return { role: opts.role || '', jobsAnalysed: analyses.length, windowDays: days, rows: gapRows(resume, analyses, settings.autoSubmitMin), computedAt: now() };
  }

  // ------------------------------------------------------------------ learning plans

  async plans(owner: string): Promise<LearningPlan[]> {
    return (await this.ctx.store.docList<PlanDoc>('learning', owner, 200)).map(strip);
  }

  private async load(owner: string, id: string): Promise<PlanDoc> {
    const d = await this.ctx.store.docGet<PlanDoc>('learning', id);
    if (!d || d.ownerUid !== owner) throw notFound('Learning plan not found.');
    return d;
  }

  async createPlan(owner: string, input: z.infer<typeof PlanInput>): Promise<LearningPlan> {
    const profile = await this.profiles.get(owner);
    const role = input.targetRole || profile.career.targetRoles[0] || '';
    const known = profile.skills.map((s) => s.name);
    const resumeId = await this.apps.baseResumeId(owner, null);
    if (resumeId) known.push(...collectSkills((await this.ctx.resumes.get(resumeId, { uid: owner })).current));
    let body = rulePlan(input.skill, role);
    let method: LearningPlan['method'] = 'rule-based';
    if (this.ctx.ai.available) {
      try {
        const { data } = await runPrompt(this.ctx.ai, learningPlan, { skill: input.skill, targetRole: role, knownSkills: [...new Set(known)] }, (d) => {
          if (d.steps.length < 3) throw new Error('Too few steps.');
        });
        body = { skill: input.skill, targetRole: role, overview: data.overview, steps: data.steps.map((s) => ({ ...s, done: false })), resources: data.resources, proofProject: data.proofProject };
        method = 'ai';
      } catch {
        /* rule-based */
      }
    }
    const t = now();
    const doc: PlanDoc = { ...body, id: newId(), ownerUid: owner, status: 'planned', confirmation: null, method, createdAt: t, updatedAt: t };
    await this.ctx.store.docPut('learning', doc);
    return strip(doc);
  }

  async updatePlan(owner: string, id: string, input: z.infer<typeof PlanUpdate>): Promise<LearningPlan> {
    const d = await this.load(owner, id);
    if (input.stepsDone) d.steps = d.steps.map((s, i) => ({ ...s, done: !!input.stepsDone![i] }));
    if (input.status) d.status = input.status;
    else if (d.steps.some((s) => s.done) && d.status === 'planned') d.status = 'learning';
    d.updatedAt = now();
    await this.ctx.store.docPut('learning', d);
    return strip(d);
  }

  /** You confirm you learned the skill (with proof); it becomes a fact resumes may use. */
  async confirm(owner: string, id: string, input: z.infer<typeof ConfirmInput>): Promise<LearningPlan> {
    const d = await this.load(owner, id);
    const statement = `${input.statement}${input.projectUrl ? ` (project: ${input.projectUrl})` : ''}`;
    d.confirmation = { statement: input.statement, projectUrl: input.projectUrl, at: now() };
    d.status = 'done';
    d.updatedAt = now();
    await this.ctx.store.docPut('learning', d);
    await this.profiles.addConfirmedFact(owner, statement, d.skill);
    return strip(d);
  }

  async removePlan(owner: string, id: string) {
    await this.load(owner, id);
    await this.ctx.store.docDelete('learning', id);
  }
}

function strip(d: PlanDoc): LearningPlan {
  const { ownerUid: _o, ...rest } = d;
  return rest;
}
