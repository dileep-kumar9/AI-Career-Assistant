import { z } from 'zod';
import type { AssistantMessage, ChatCitation, JobApplication, ProposedAction, TrackerStage } from '../../../shared/careerTypes.js';
import { STAGE_LABELS, TRACKER_STAGES } from '../../../shared/careerTypes.js';
import { careerChat, runPrompt } from '../ai/prompts/index.js';
import { findUrls } from '../services/fetchJob.js';
import { badRequest } from '../errors.js';
import { type CareerContext, now } from './context.js';
import type { ApplicationService } from './applications.js';
import type { AgentService } from './agent.js';
import type { InterviewService } from './interview.js';
import type { SkillsService } from './skills.js';
import type { Chunk, RagService } from './rag.js';

/**
 * Career Assistant chat: answers from your own records (RAG) and proposes
 * actions. Actions are (1) only accepted when YOUR message asks for that kind
 * of thing, (2) validated server-side (the application must be yours, the
 * link must be one you typed), and (3) executed only after you press Confirm.
 */

export const ChatInput = z.object({
  message: z.string().trim().min(1).max(4000),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(8000) })).max(20).default([]),
});

export const ActionInput = z.object({
  type: z.enum(['single_apply', 'agent_start', 'agent_stop', 'set_stage', 'interview_prep', 'learning_plan', 'open_resume']),
  url: z.string().max(2000).optional(),
  applicationId: z.string().max(80).optional(),
  stage: z.string().max(40).optional(),
  skill: z.string().max(80).optional(),
});

/** Does the user's own message ask for this kind of action? (Retrieved text can never trigger one.) */
export function intentAllows(type: ProposedAction['type'], message: string): boolean {
  const m = message.toLowerCase();
  switch (type) {
    case 'single_apply':
      return findUrls(message).length > 0 && /\b(apply|tailor|prepare|submit|go for|send)\b/.test(m);
    case 'agent_start':
      return /\b(start|turn on|resume|run|switch on|enable)\b.*\bagent\b|\bagent\b.*\b(on|start|run)\b/.test(m);
    case 'agent_stop':
      return /\b(stop|pause|turn off|switch off|disable|halt)\b.*\bagent\b|\bagent\b.*\b(off|stop|pause)\b/.test(m);
    case 'set_stage':
      return /\b(mark|move|set|update|got|have|received|rejected|offer|interview|withdr[ae]w|no response|ghosted)\b/.test(m);
    case 'interview_prep':
      return /\b(prepare|prep|practi[cs]e|mock|interview questions?)\b/.test(m);
    case 'learning_plan':
      return /\b(learn|study|plan|course|roadmap|upskill)\b/.test(m);
    case 'open_resume':
      return /\b(open|show|see|view|edit)\b.*\bresume\b/.test(m);
  }
}

function describe(a: ProposedAction, apps: JobApplication[]): string {
  const app = a.applicationId ? apps.find((x) => x.id === a.applicationId) : null;
  const name = app ? `${app.jobTitle} at ${app.company}` : '';
  switch (a.type) {
    case 'single_apply':
      return `Start Single Job Apply for ${a.url}`;
    case 'agent_start':
      return 'Switch the job agent ON';
    case 'agent_stop':
      return 'Switch the job agent OFF';
    case 'set_stage':
      return `Move “${name}” to ${STAGE_LABELS[a.stage as TrackerStage] || a.stage}`;
    case 'interview_prep':
      return `Create interview practice for ${name || 'this job'}`;
    case 'learning_plan':
      return `Create a learning plan for ${a.skill}`;
    case 'open_resume':
      return `Open the resume for ${name}`;
  }
}

export class AssistantService {
  constructor(
    private ctx: CareerContext,
    private rag: RagService,
    private deps: { apps: ApplicationService; agent: AgentService; interviews: InterviewService; skills: SkillsService },
  ) {}

  /** Validates a proposed action against your data; null when it is not acceptable. */
  validate(raw: z.infer<typeof ActionInput>, message: string, apps: JobApplication[], requireIntent = true): ProposedAction | null {
    if (requireIntent && !intentAllows(raw.type, message)) return null;
    const a: ProposedAction = { type: raw.type, summary: '' };
    if (raw.type === 'single_apply') {
      const typed = findUrls(message);
      const url = raw.url && typed.includes(raw.url) ? raw.url : typed[0];
      if (!url) return null;
      a.url = url;
    }
    if (['set_stage', 'interview_prep', 'open_resume'].includes(raw.type)) {
      const app = apps.find((x) => x.id === raw.applicationId);
      if (!app) return null;
      a.applicationId = app.id;
      if (raw.type === 'open_resume' && !app.resumeSessionId) return null;
    }
    if (raw.type === 'set_stage') {
      if (!TRACKER_STAGES.includes(raw.stage as TrackerStage)) return null;
      a.stage = raw.stage;
    }
    if (raw.type === 'learning_plan') {
      if (!raw.skill?.trim()) return null;
      a.skill = raw.skill.trim();
    }
    a.summary = describe(a, apps);
    return a;
  }

  async chat(owner: string, input: z.infer<typeof ChatInput>): Promise<AssistantMessage> {
    const { chunks, apps } = await this.rag.corpus(owner);
    const hits = await this.rag.search(owner, `${input.message}\n${input.history.slice(-2).map((h) => h.content).join('\n')}`, chunks, 10);
    const cite = (ids: string[]): ChatCitation[] =>
      ids
        .map((id) => hits.find((h) => h.id === id) || chunks.find((c) => c.id === id))
        .filter((c): c is Chunk => !!c)
        .map((c) => ({ id: c.id, source: c.source, label: c.label }));

    if (this.ctx.ai.available) {
      try {
        const history = input.history.slice(-8).map((h) => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content.slice(0, 1500)}`).join('\n');
        const { data } = await runPrompt(this.ctx.ai, careerChat, { question: input.message, history, context: hits.map((h) => ({ id: h.id, source: h.source, text: h.text })), today: now().slice(0, 10) });
        const action = data.action.type === 'none' ? null : this.validate({ ...data.action, type: data.action.type }, input.message, apps);
        return { role: 'assistant', content: data.answer, citations: cite(data.citations), action, method: 'ai', at: now() };
      } catch {
        /* rule-based below */
      }
    }
    return this.ruleAnswer(input.message, apps, hits);
  }

  /** Answers common questions and commands without AI; otherwise shows the most relevant records. */
  ruleAnswer(message: string, apps: JobApplication[], hits: Chunk[]): AssistantMessage {
    const m = message.toLowerCase();
    const reply = (content: string, citations: ChatCitation[] = [], action: ProposedAction | null = null): AssistantMessage => ({ role: 'assistant', content, citations, action, method: 'rule-based', at: now() });
    const url = findUrls(message)[0];
    if (url && intentAllows('single_apply', message)) return reply('I can start Single Job Apply for that link (read the job → tailor your resume → prepare the application for your review).', [], this.validate({ type: 'single_apply', url }, message, apps));
    if (intentAllows('agent_stop', message)) return reply('I can switch the job agent off.', [], this.validate({ type: 'agent_stop' }, message, apps));
    if (intentAllows('agent_start', message)) return reply('I can switch the job agent on. It will search, tailor and (in auto mode) apply within your daily limits.', [], this.validate({ type: 'agent_start' }, message, apps));
    if (/how many|count|number of|stats|this week|today/.test(m) && /appl/.test(m)) {
      const week = Date.now() - 7 * 86_400_000;
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const applied = apps.filter((a) => a.appliedAt);
      const by = TRACKER_STAGES.map((s) => `${STAGE_LABELS[s]}: ${apps.filter((a) => a.stage === s).length}`).join(' · ');
      return reply(
        `**Applications:** ${apps.length} in total, ${applied.length} submitted — ${applied.filter((a) => Date.parse(a.appliedAt!) >= week).length} in the last 7 days, ${applied.filter((a) => Date.parse(a.appliedAt!) >= start.getTime()).length} today.\n\n${by}`,
        [{ id: 'apps-summary', source: 'application', label: 'Applications summary' }],
      );
    }
    if (/missing|gap|learn next|what should i learn|skills? (do i|i) need/.test(m)) {
      const counts = new Map<string, number>();
      for (const a of apps) for (const s of a.missingSkills) counts.set(s, (counts.get(s) || 0) + 1);
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
      return reply(top.length ? `Skills most often missing in your applications:\n${top.map(([s, n]) => `- **${s}** — ${n} job${n > 1 ? 's' : ''}`).join('\n')}\n\nSee Skills & Learning for the measured impact and a study plan.` : 'I have no job descriptions with missing skills yet. Apply to a job or run the agent first.', [{ id: 'gaps', source: 'application', label: 'Most frequent missing skills' }]);
    }
    if (/interview/.test(m) && /(upcoming|next|when|scheduled)/.test(m)) {
      const next = apps.filter((a) => a.stage === 'interview').sort((a, b) => Date.parse(a.interviewAt || '9999') - Date.parse(b.interviewAt || '9999'));
      return reply(next.length ? next.map((a) => `- **${a.jobTitle}** at ${a.company}${a.interviewAt ? ` — ${a.interviewAt.slice(0, 16).replace('T', ' ')}` : ' (date not set)'}`).join('\n') : 'No applications are in the Interview stage.');
    }
    if (!hits.length) return reply("I don't have that information in your records.");
    return reply(
      `AI answers are unavailable right now, so here are the most relevant records I found:\n\n${hits
        .slice(0, 5)
        .map((h) => `- **${h.label}**: ${h.text.split('\n')[0].slice(0, 220)}`)
        .join('\n')}`,
      hits.slice(0, 5).map((h) => ({ id: h.id, source: h.source, label: h.label })),
    );
  }

  /** Runs an action you confirmed. The action is re-validated (no intent check: you clicked Confirm). */
  async execute(owner: string, raw: z.infer<typeof ActionInput>): Promise<{ message: string; navigate?: string }> {
    const apps = await this.deps.apps.list(owner);
    const a = this.validate(raw, raw.url || '', apps, false);
    if (!a && raw.type === 'single_apply' && raw.url) {
      const app = await this.deps.apps.createFromLink(owner, { url: raw.url, mode: 'review' });
      return { message: 'Started Single Job Apply. I will prepare the tailored resume for your review.', navigate: `/apply?id=${app.id}` };
    }
    if (!a) throw badRequest('That action is not valid for your data.');
    switch (a.type) {
      case 'single_apply': {
        const app = await this.deps.apps.createFromLink(owner, { url: a.url!, mode: 'review' });
        return { message: 'Started Single Job Apply. I will prepare the tailored resume for your review.', navigate: `/apply?id=${app.id}` };
      }
      case 'agent_start':
        await this.deps.agent.start(owner);
        return { message: 'The job agent is ON.', navigate: '/agent' };
      case 'agent_stop':
        await this.deps.agent.stop(owner);
        return { message: 'The job agent is OFF.', navigate: '/agent' };
      case 'set_stage': {
        const app = await this.deps.apps.setStage(owner, a.applicationId!, { stage: a.stage as TrackerStage, note: 'Updated from the Career Assistant' });
        return { message: `Moved ${app.jobTitle} at ${app.company} to ${STAGE_LABELS[app.stage]}.`, navigate: `/tracker?id=${app.id}` };
      }
      case 'interview_prep': {
        const set = await this.deps.interviews.create(owner, { applicationId: a.applicationId!, count: 15 });
        return { message: `Created ${set.questions.length} practice questions.`, navigate: `/interview?id=${set.id}` };
      }
      case 'learning_plan': {
        const plan = await this.deps.skills.createPlan(owner, { skill: a.skill! });
        return { message: `Created a learning plan for ${plan.skill}.`, navigate: `/skills?plan=${plan.id}` };
      }
      case 'open_resume': {
        const app = apps.find((x) => x.id === a.applicationId)!;
        return { message: 'Opening the resume.', navigate: `/builder/${app.resumeSessionId}` };
      }
    }
  }
}
