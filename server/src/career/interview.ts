import { z } from 'zod';
import type { InterviewAttempt, InterviewQuestion, InterviewSet } from '../../../shared/careerTypes.js';
import type { ResumeData } from '../../../shared/resumeTypes.js';
import { analyzeJobDescriptionDeterministic } from '../../../shared/jdAnalyzer.js';
import { findKeyword } from '../../../shared/match.js';
import { resumeToPlainText } from '../../../shared/normalize.js';
import { evaluateAnswer, interviewQuestions, runPrompt } from '../ai/prompts/index.js';
import type { DocBase } from '../db/store.js';
import { badRequest, notFound } from '../errors.js';
import { type CareerContext, newId, now } from './context.js';
import type { ApplicationService } from './applications.js';

/**
 * Interview prep for one job: likely questions from that JD + your resume,
 * mock answers (typed or spoken in the browser) and per-answer coaching.
 * Without AI a rule-based question set and scoring rubric are used and
 * clearly labelled as such.
 */

type SetDoc = InterviewSet & DocBase;

export const CreateSetInput = z.object({
  applicationId: z.string().max(80).optional(),
  role: z.string().trim().max(200).optional(),
  company: z.string().trim().max(200).optional(),
  jobDescription: z.string().max(30_000).optional(),
  resumeId: z.string().uuid().optional(),
  count: z.number().int().min(5).max(25).default(15),
});

const BEHAVIORAL: Array<[string, string[]]> = [
  ['Tell me about a time you had to learn a new tool or technology quickly. What did you do?', ['Situation and why it was urgent', 'How you learned (steps, resources)', 'What you delivered', 'What you would do differently']],
  ['Describe a problem you solved that did not have an obvious answer.', ['The problem and its impact', 'How you investigated', 'The decision you made and why', 'The result']],
  ['Tell me about a time you disagreed with a teammate. How did you handle it?', ['Context', 'How you listened and communicated', 'The outcome', 'What you learned']],
  ['Describe a time you missed a deadline or made a mistake.', ['What happened honestly', 'How you took ownership', 'How you fixed it', 'What you changed afterwards']],
  ['Tell me about a time you worked under pressure with several priorities.', ['The competing priorities', 'How you prioritised', 'The result']],
];
const HR: Array<[string, string[]]> = [
  ['Tell me about yourself.', ['Current role or studies', '2-3 relevant achievements from your resume', 'Why this role is the next step']],
  ['Why are you interested in this role and this company?', ['What in the job matches your experience', 'What you want to learn/do', 'Something specific about the company you verified']],
  ['What are your salary expectations and notice period?', ['A researched range', 'Flexibility', 'Your notice period / start date']],
];

export function ruleQuestions(resume: ResumeData, role: string, jdText: string, count: number): InterviewQuestion[] {
  const jd = analyzeJobDescriptionDeterministic(jdText || role);
  const text = resumeToPlainText(resume);
  const q: InterviewQuestion[] = [];
  const add = (question: string, category: InterviewQuestion['category'], skill: string, why: string, idealPoints: string[]) => q.push({ id: newId(), question, category, skill, why, idealPoints });
  for (const skill of [...jd.requiredSkills, ...jd.preferredSkills].slice(0, 6)) {
    const has = !!findKeyword(text, skill);
    add(
      has ? `Your resume mentions ${skill}. Walk me through a specific time you used it — what was the task and what did you do?` : `This role needs ${skill}. How would you get productive with it, and what related experience do you have?`,
      'technical',
      skill,
      `${skill} is ${jd.requiredSkills.includes(skill) ? 'required' : 'preferred'} in the job description.`,
      has ? ['The concrete task', 'How you used the tool', 'The result', 'What you would improve'] : ['Honest current level', 'Closest related experience', 'A concrete plan to learn it'],
    );
  }
  for (const p of resume.projects.slice(0, 2)) add(`Walk me through your project “${p.title}”: your role, the tools you used and the result.`, 'resume', p.technologies[0] || '', 'Interviewers probe the projects on your resume.', ['Goal of the project', 'Your specific contribution', 'Technical choices and why', 'Outcome / what you learned']);
  for (const e of resume.experience.slice(0, 2)) add(`What were your main responsibilities as ${e.jobTitle} at ${e.company}, and what are you most proud of there?`, 'resume', '', 'Your recent experience is the first thing they check.', ['Scope of the role', 'A concrete achievement', 'Tools/skills used', 'What it taught you']);
  for (const [question, points] of BEHAVIORAL) add(question, 'behavioral', '', 'Behavioural (STAR) questions are asked in most interviews.', points);
  for (const [question, points] of HR) add(question.replace('this role', role ? `this ${role} role` : 'this role'), 'hr', '', 'Common screening question.', points);
  return q.slice(0, count);
}

/** Heuristic coach used when no AI provider is available. Transparent about what it measures. */
export function ruleEvaluate(q: InterviewQuestion, answer: string): Omit<InterviewAttempt, 'questionId' | 'at'> {
  const words = answer.trim().split(/\s+/).filter(Boolean);
  const lower = answer.toLowerCase();
  const covered = q.idealPoints.filter((p) => {
    const keys = p.toLowerCase().split(/[^a-z0-9+#]+/).filter((w) => w.length > 3);
    return keys.some((k) => lower.includes(k));
  });
  const star = ['situation', 'task', 'action', 'result', 'because', 'so that', 'as a result', 'i did', 'i built', 'i used'].filter((w) => lower.includes(w)).length;
  const skillHit = q.skill ? lower.includes(q.skill.toLowerCase()) : true;
  const lengthScore = words.length < 25 ? 0.5 : words.length < 60 ? 1.5 : words.length <= 350 ? 2 : 1.5;
  const coverage = q.idealPoints.length ? covered.length / q.idealPoints.length : 0.5;
  const structure = q.category === 'behavioral' ? Math.min(star, 3) : skillHit ? 2 : 1;
  const score = words.length < 5 ? 0 : Math.max(1, Math.min(10, Math.round(coverage * 5 + structure + lengthScore)));
  const strengths = [...(covered.length ? [`Covers: ${covered.join('; ')}`] : []), ...(words.length >= 60 && words.length <= 350 ? ['Good length for a spoken answer'] : []), ...(q.skill && skillHit ? [`Names ${q.skill} explicitly`] : [])];
  const missing = [...q.idealPoints.filter((p) => !covered.includes(p)).map((p) => `Add: ${p}`), ...(words.length < 60 ? ['Too short — give a specific example with details'] : []), ...(q.category === 'behavioral' && star < 2 ? ['Use STAR: situation, task, action, result'] : [])];
  return {
    answer,
    score,
    strengths,
    missing,
    improvedAnswer: `Structure for a stronger answer (rule-based coach — add an AI key for a rewritten answer):\n${q.idealPoints.map((p, i) => `${i + 1}. ${p}: [your real example]`).join('\n')}`,
    followUp: q.skill ? `What would you do differently next time you use ${q.skill}?` : 'What did you learn from that experience?',
    method: 'rule-based',
  };
}

export class InterviewService {
  constructor(
    private ctx: CareerContext,
    private apps: ApplicationService,
  ) {}

  async list(owner: string): Promise<InterviewSet[]> {
    return (await this.ctx.store.docList<SetDoc>('interviews', owner, 200)).map(strip);
  }

  private async load(owner: string, id: string): Promise<SetDoc> {
    const doc = await this.ctx.store.docGet<SetDoc>('interviews', id);
    if (!doc || doc.ownerUid !== owner) throw notFound('Interview set not found.');
    return doc;
  }

  async get(owner: string, id: string) {
    return strip(await this.load(owner, id));
  }

  async remove(owner: string, id: string) {
    await this.load(owner, id);
    await this.ctx.store.docDelete('interviews', id);
  }

  async create(owner: string, input: z.infer<typeof CreateSetInput>): Promise<InterviewSet> {
    let role = input.role || '';
    let company = input.company || '';
    let jd = input.jobDescription || '';
    let resumeId = input.resumeId || null;
    if (input.applicationId) {
      const a = await this.apps.get(owner, input.applicationId);
      role ||= a.jobTitle;
      company ||= a.company;
      jd ||= a.description;
      resumeId ||= a.resumeSessionId || (await this.apps.baseResumeId(owner, null));
    } else resumeId ||= await this.apps.baseResumeId(owner, null);
    if (!resumeId) throw badRequest('Add a resume first so the questions can be based on it.');
    if (!role && !jd) throw badRequest('Choose an application or give a role / job description.');
    const resume = (await this.ctx.resumes.get(resumeId, { uid: owner })).current;
    let questions: InterviewQuestion[] = [];
    let method: InterviewSet['method'] = 'rule-based';
    if (this.ctx.ai.available) {
      try {
        const { data } = await runPrompt(this.ctx.ai, interviewQuestions, { resumeText: resumeToPlainText(resume, { visibleOnly: true }), job: { title: role, company, description: jd || role }, count: input.count }, (d) => {
          if (d.questions.length < 5) throw new Error('Too few questions.');
        });
        questions = data.questions.map((q) => ({ id: newId(), ...q }));
        method = 'ai';
      } catch {
        /* fall back */
      }
    }
    if (!questions.length) questions = ruleQuestions(resume, role, jd, input.count);
    const t = now();
    const doc: SetDoc = { id: newId(), ownerUid: owner, applicationId: input.applicationId || null, role, company, questions, attempts: [], method, createdAt: t, updatedAt: t };
    await this.ctx.store.docPut('interviews', doc);
    return strip(doc);
  }

  async answer(owner: string, id: string, questionId: string, answer: string): Promise<{ set: InterviewSet; attempt: InterviewAttempt }> {
    const doc = await this.load(owner, id);
    const q = doc.questions.find((x) => x.id === questionId);
    if (!q) throw notFound('Question not found.');
    let result: Omit<InterviewAttempt, 'questionId' | 'at'> | null = null;
    if (this.ctx.ai.available && answer.trim().split(/\s+/).length >= 3) {
      try {
        let resumeText = '';
        const rid = doc.applicationId ? (await this.apps.get(owner, doc.applicationId).catch(() => null))?.resumeSessionId : await this.apps.baseResumeId(owner, null);
        if (rid) resumeText = resumeToPlainText((await this.ctx.resumes.get(rid, { uid: owner })).current, { visibleOnly: true });
        const { data } = await runPrompt(this.ctx.ai, evaluateAnswer, { question: q.question, category: q.category, idealPoints: q.idealPoints, answer, resumeText, jobTitle: doc.role });
        result = { answer, ...data, score: Math.round(data.score), method: 'ai' };
      } catch {
        result = null;
      }
    }
    result ||= ruleEvaluate(q, answer);
    const attempt: InterviewAttempt = { questionId, at: now(), ...result };
    doc.attempts.push(attempt);
    doc.attempts = doc.attempts.slice(-300);
    doc.updatedAt = now();
    await this.ctx.store.docPut('interviews', doc);
    return { set: strip(doc), attempt };
  }
}

function strip(d: SetDoc): InterviewSet {
  const { ownerUid: _o, ...rest } = d;
  return rest;
}
