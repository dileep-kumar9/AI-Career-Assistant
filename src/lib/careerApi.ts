import type {
  AgentRun,
  AgentSettings,
  AgentStatus,
  AssistantMessage,
  CareerProfile,
  InterviewAttempt,
  InterviewSet,
  JobApplication,
  LearningPlan,
  ProposedAction,
  SkillGapReport,
  TrackerStage,
} from '../../shared/careerTypes';
import { ApiError } from './api';
import { idToken } from './firebase';

/** Client for the career API (/api/profile, /api/applications, /api/agent, …). */

async function headers(json: boolean): Promise<Record<string, string>> {
  const h: Record<string, string> = { 'X-ACA-Client': '1' };
  const token = await idToken().catch(() => null);
  if (token) h['X-Firebase-Auth'] = token;
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, headers: await headers(body !== undefined), body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'Could not reach the app server. Is it running (npm run dev:api)?', 'network');
  }
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    const details = Array.isArray(payload.details) ? ` (${payload.details.join('; ')})` : '';
    throw new ApiError(res.status, `${payload.error || `Request failed (${res.status}).`}${details}`, payload.code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Authenticated file → object URL (PDF preview, CSV download). */
export async function fileUrl(path: string): Promise<string> {
  const res = await fetch(`/api${path}`, { headers: await headers(false) });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new ApiError(res.status, payload.error || `Request failed (${res.status}).`);
  }
  return URL.createObjectURL(await res.blob());
}

export async function download(path: string, filename: string) {
  const url = await fileUrl(path);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export interface TrackerOverview {
  stats: {
    total: number;
    byStage: Record<string, number>;
    appliedPerWeek: Array<{ week: string; applied: number }>;
    bySource: Array<{ source: string; applied: number; responses: number; interviews: number; responseRate: number }>;
    byMatch: Array<{ band: string; applied: number; responses: number; interviews: number; responseRate: number }>;
    responseRate: number;
    interviewRate: number;
  };
  reminders: {
    followUps: Array<{ id: string; jobTitle: string; company: string; appliedAt: string | null; followUpAt: string | null }>;
    interviews: Array<{ id: string; jobTitle: string; company: string; interviewAt: string | null }>;
    needsAttention: number;
    readyForReview: number;
  };
}

export interface AppConfigInfo {
  appName: string;
  requireAuth: boolean;
  authEnabled: boolean;
  localMode: boolean;
  ai: { available: boolean; providers: string[] };
}

export type BrowserStatus = AgentStatus['browser'];

export const career = {
  config: () => req<AppConfigInfo>('GET', '/config'),

  // profile
  profile: () => req<CareerProfile>('GET', '/profile'),
  saveProfile: (p: Partial<Pick<CareerProfile, 'basics' | 'career' | 'skills' | 'authorization' | 'diversity' | 'defaultResumeId'>>) => req<CareerProfile>('PUT', '/profile', p),
  autofill: (resumeId: string) => req<{ profile: CareerProfile; method: 'ai' | 'rule-based' }>('POST', '/profile/autofill', { resumeId }),
  saveAnswer: (a: { id?: string; question: string; answer: string }) => req<CareerProfile>('POST', '/profile/answers', a),
  deleteAnswer: (id: string) => req<CareerProfile>('DELETE', `/profile/answers/${id}`),

  // applications
  applications: () => req<{ applications: JobApplication[] }>('GET', '/applications').then((r) => r.applications),
  application: (id: string) => req<JobApplication>('GET', `/applications/${id}`),
  applyLink: (url: string, mode: 'review' | 'auto', resumeId?: string | null) => req<JobApplication>('POST', '/applications/link', { url, mode, resumeId: resumeId || null }),
  addManual: (a: { jobTitle: string; company: string; jobUrl?: string; location?: string; stage?: TrackerStage; appliedAt?: string | null; notes?: string }) => req<JobApplication>('POST', '/applications/manual', a),
  approve: (id: string, submit: boolean) => req<JobApplication>('POST', `/applications/${id}/approve`, { submit }),
  retry: (id: string) => req<JobApplication>('POST', `/applications/${id}/retry`),
  setStage: (id: string, stage: TrackerStage | 'skipped', extra: { note?: string; interviewAt?: string | null } = {}) => req<JobApplication>('POST', `/applications/${id}/stage`, { stage, ...extra }),
  updateApplication: (id: string, patch: { notes?: string; followUpAt?: string | null; interviewAt?: string | null; jobTitle?: string; company?: string }) => req<JobApplication>('PATCH', `/applications/${id}`, patch),
  removeApplication: (id: string) => req<void>('DELETE', `/applications/${id}`),
  emailDraft: (id: string, kind: 'follow_up' | 'thank_you' | 'withdraw') => req<{ subject: string; body: string; method: string }>('POST', `/applications/${id}/email`, { kind }),
  tracker: () => req<TrackerOverview>('GET', '/tracker/overview'),

  // agent
  agentSettings: () => req<AgentSettings>('GET', '/agent/settings'),
  saveAgentSettings: (s: Partial<AgentSettings>) => req<AgentSettings>('PUT', '/agent/settings', s),
  agentStatus: () => req<AgentStatus>('GET', '/agent/status'),
  agentStart: () => req<AgentStatus>('POST', '/agent/start'),
  agentStop: () => req<AgentStatus>('POST', '/agent/stop'),
  agentRun: () => req<AgentStatus>('POST', '/agent/run'),
  agentRuns: () => req<{ runs: AgentRun[] }>('GET', '/agent/runs').then((r) => r.runs),

  // browser
  browserStatus: () => req<BrowserStatus>('GET', '/browser/status'),
  browserOpen: (site: 'linkedin' | 'naukri' | 'indeed' | 'google') => req<BrowserStatus>('POST', '/browser/open', { site }),
  browserClose: () => req<BrowserStatus>('POST', '/browser/close'),

  // interview
  interviews: () => req<{ sets: InterviewSet[] }>('GET', '/interviews').then((r) => r.sets),
  interview: (id: string) => req<InterviewSet>('GET', `/interviews/${id}`),
  createInterview: (b: { applicationId?: string; role?: string; company?: string; jobDescription?: string; count?: number }) => req<InterviewSet>('POST', '/interviews', b),
  answerQuestion: (id: string, questionId: string, answer: string) => req<{ set: InterviewSet; attempt: InterviewAttempt }>('POST', `/interviews/${id}/answer`, { questionId, answer }),
  removeInterview: (id: string) => req<void>('DELETE', `/interviews/${id}`),

  // skills
  gaps: (role = '', days = 30) => req<SkillGapReport>('GET', `/skills/gaps?role=${encodeURIComponent(role)}&days=${days}`),
  plans: () => req<{ plans: LearningPlan[] }>('GET', '/learning').then((r) => r.plans),
  createPlan: (skill: string, targetRole?: string) => req<LearningPlan>('POST', '/learning', { skill, targetRole }),
  updatePlan: (id: string, patch: { stepsDone?: boolean[]; status?: LearningPlan['status'] }) => req<LearningPlan>('PATCH', `/learning/${id}`, patch),
  confirmPlan: (id: string, statement: string, projectUrl: string) => req<LearningPlan>('POST', `/learning/${id}/confirm`, { statement, projectUrl }),
  removePlan: (id: string) => req<void>('DELETE', `/learning/${id}`),

  // assistant
  chat: (message: string, history: Array<{ role: 'user' | 'assistant'; content: string }>) => req<AssistantMessage>('POST', '/assistant/chat', { message, history }),
  runAction: (a: ProposedAction) => req<{ message: string; navigate?: string }>('POST', '/assistant/actions', { type: a.type, url: a.url, applicationId: a.applicationId, stage: a.stage, skill: a.skill }),

  prompts: () => req<{ prompts: Array<{ id: string; version: number; purpose: string }>; providers: string[] }>('GET', '/ai/prompts'),
};
