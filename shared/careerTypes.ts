/**
 * Types shared by the server and the web app for everything beyond the
 * resume engine: Career Profile, applications / tracker, the job agent,
 * interview prep, skills & learning and the career assistant.
 */
import type { JDAnalysis } from './jdAnalyzer.js';

// ------------------------------------------------------------------ career profile

export type WorkMode = 'remote' | 'hybrid' | 'onsite';
export type JobType = 'full-time' | 'part-time' | 'contract' | 'internship';
export type Seniority = 'intern' | 'entry' | 'mid' | 'senior';

export interface ProfileSkill {
  name: string;
  /** resume = found in your resume · user = you added it (search only) · learned = confirmed after a learning plan */
  source: 'resume' | 'user' | 'learned';
}

export interface SavedAnswer {
  id: string;
  question: string;
  answer: string;
  updatedAt: string;
}

export interface CareerProfile {
  basics: { fullName: string; email: string; phone: string; city: string; country: string; linkedin: string; github: string; portfolio: string };
  career: {
    targetRoles: string[];
    yearsExperience: number | null;
    seniority: Seniority;
    currentTitle: string;
    currentCompany: string;
    noticePeriod: string;
    currentSalary: string;
    expectedSalary: string;
    jobTypes: JobType[];
    locations: string[];
    workModes: WorkMode[];
    earliestStart: string;
  };
  skills: ProfileSkill[];
  authorization: { countries: string[]; needsSponsorship: boolean | null; willingToRelocate: boolean | null };
  /** Optional voluntary self-identification; empty = "Decline to self-identify". */
  diversity: { gender: string; ethnicity: string; veteran: string; disability: string };
  savedAnswers: SavedAnswer[];
  /** Statements you confirmed (e.g. after finishing a learning plan) that resumes may use as evidence. */
  confirmedFacts: string[];
  /** Resume used for single-job applies and by the agent unless another is chosen. */
  defaultResumeId: string | null;
  /** When the profile was last auto-filled from a resume. */
  autofilledFrom: { resumeId: string; at: string; method: 'ai' | 'rule-based' } | null;
  updatedAt: string;
}

// ------------------------------------------------------------------ applications / tracker

export type PipelineStage = 'found' | 'matched' | 'tailoring' | 'ready' | 'applying' | 'needs_attention' | 'skipped' | 'failed';
export type TrackerStage = 'applied' | 'interview' | 'offer' | 'rejected' | 'no_response' | 'withdrawn';
export type ApplicationStage = PipelineStage | TrackerStage;

export const PIPELINE_STAGES: PipelineStage[] = ['found', 'matched', 'tailoring', 'ready', 'applying', 'needs_attention', 'skipped', 'failed'];
export const TRACKER_STAGES: TrackerStage[] = ['applied', 'interview', 'offer', 'rejected', 'no_response', 'withdrawn'];

export const STAGE_LABELS: Record<ApplicationStage, string> = {
  found: 'Found',
  matched: 'Matched',
  tailoring: 'Tailoring',
  ready: 'Ready for review',
  applying: 'Applying',
  needs_attention: 'Needs attention',
  skipped: 'Skipped',
  failed: 'Failed',
  applied: 'Applied',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
  no_response: 'No response',
  withdrawn: 'Withdrawn',
};

export type JobSourceId = 'greenhouse' | 'lever' | 'ashby' | 'workday' | 'arbeitnow' | 'remoteok' | 'naukri' | 'indeed' | 'linkedin' | 'link' | 'manual';

export interface ApplicationAnswer {
  question: string;
  answer: string;
  source: 'profile' | 'saved' | 'ai' | 'user' | 'rule';
  /** False when the agent could not answer truthfully (the job then needs your attention). */
  confident: boolean;
}

export interface TimelineEntry {
  at: string;
  stage: ApplicationStage;
  note: string;
}

export interface LogEntry {
  at: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface JobApplication {
  id: string;
  /** How the job entered the app. */
  origin: 'single' | 'agent' | 'manual';
  source: JobSourceId;
  externalId: string;
  /** source + id (or normalised company + title) used to never apply twice. */
  dedupeKey: string;
  jobUrl: string;
  applyUrl: string;
  jobTitle: string;
  company: string;
  location: string;
  remote: boolean;
  postedAt: string | null;
  /** Full job description text as read from the page (untrusted data). */
  description: string;
  jdAnalysis: JDAnalysis | null;
  /** Prompt-injection phrases found on the job page, shown to you as a warning. */
  injectionSignals: string[];
  /** Base resume vs this JD (0–100). */
  matchScore: number | null;
  atsBefore: number | null;
  atsAfter: number | null;
  matchedSkills: string[];
  missingSkills: string[];
  resumeSessionId: string | null;
  resumeVersionId: string | null;
  /** A PDF of the exact resume version prepared for this job exists. */
  hasResumePdf: boolean;
  coverLetter: string;
  answers: ApplicationAnswer[];
  mode: 'review' | 'auto' | 'manual';
  stage: ApplicationStage;
  /** Why it needs attention / failed / was skipped. */
  reason: string;
  timeline: TimelineEntry[];
  log: LogEntry[];
  appliedAt: string | null;
  interviewAt: string | null;
  followUpAt: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

// ------------------------------------------------------------------ job agent

export interface SourceSettings {
  greenhouse: { enabled: boolean; boards: string[] };
  lever: { enabled: boolean; companies: string[] };
  ashby: { enabled: boolean; orgs: string[] };
  workday: { enabled: boolean; sites: string[] };
  arbeitnow: { enabled: boolean };
  remoteok: { enabled: boolean };
  naukri: { enabled: boolean };
  indeed: { enabled: boolean; domain: string };
  linkedin: { enabled: boolean };
}

export interface AgentSettings {
  enabled: boolean;
  searchBy: 'resume' | 'skills' | 'both';
  resumeId: string | null;
  skills: string[];
  targetRoles: string[];
  locations: string[];
  remoteOk: boolean;
  experienceMax: number | null;
  jobTypes: JobType[];
  postedWithinDays: number;
  sources: SourceSettings;
  excludeCompanies: string[];
  excludeTitleWords: string[];
  mode: 'review' | 'auto';
  /** Prepare (tailor) jobs scoring at least this. */
  minMatch: number;
  /** In auto mode, submit only jobs scoring at least this (after tailoring). */
  autoSubmitMin: number;
  dailyLimit: number;
  linkedinDailyLimit: number;
  runEveryMinutes: number;
  /** Fill forms but never press Submit. */
  dryRun: boolean;
  /** Generate a cover letter when a form asks for one. */
  coverLetters: boolean;
  updatedAt: string;
}

export interface AgentRun {
  id: string;
  trigger: 'schedule' | 'manual';
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'done' | 'stopped' | 'failed';
  counts: { searched: number; found: number; new: number; matched: number; prepared: number; applied: number; needsAttention: number; skipped: number };
  log: LogEntry[];
}

export interface AgentStatus {
  enabled: boolean;
  running: boolean;
  phase: string;
  nextRunAt: string | null;
  lastRun: AgentRun | null;
  today: { applied: number; linkedin: number; limit: number; linkedinLimit: number };
  browser: { available: boolean; open: boolean; channel: string; error: string | null };
}

// ------------------------------------------------------------------ interview prep

export type QuestionCategory = 'technical' | 'resume' | 'behavioral' | 'hr';

export interface InterviewQuestion {
  id: string;
  question: string;
  category: QuestionCategory;
  skill: string;
  why: string;
  idealPoints: string[];
}

export interface InterviewAttempt {
  questionId: string;
  answer: string;
  score: number;
  strengths: string[];
  missing: string[];
  improvedAnswer: string;
  followUp: string;
  method: 'ai' | 'rule-based';
  at: string;
}

export interface InterviewSet {
  id: string;
  applicationId: string | null;
  role: string;
  company: string;
  questions: InterviewQuestion[];
  attempts: InterviewAttempt[];
  method: 'ai' | 'rule-based';
  createdAt: string;
  updatedAt: string;
}

// ------------------------------------------------------------------ live / coached interview sessions

export type AnswerVerdict = 'correct' | 'partially_correct' | 'incorrect' | 'unclear' | 'no_answer';

/** How an answer was delivered (from the browser's speech detection, or typing). */
export interface AnswerMetrics {
  source: 'voice' | 'text';
  /** Seconds from the end of the question until the candidate started answering. */
  secondsToStart: number | null;
  /** Seconds spent answering. */
  durationSec: number | null;
  /** Pauses longer than ~2 s while answering. */
  longPauses: number;
  /** The microphone heard speech at all. */
  speechDetected: boolean;
}

export interface AnswerAnalysis {
  verdict: AnswerVerdict;
  score: number;
  clarity: 'clear' | 'somewhat_clear' | 'unclear';
  confidence: 'confident' | 'hesitant' | 'unsure';
  /** Observable delivery signals: filler words, hedging, long pauses, very short answer. */
  deliverySignals: string[];
  strengths: string[];
  gaps: string[];
  /** Concrete advice on how to answer this better. */
  suggestion: string;
  /** A stronger answer built only from the candidate's resume and what they said. */
  suggestedAnswer: string;
  method: 'ai' | 'rule-based';
}

export type InterviewTurnKind = 'intro' | 'question' | 'followup' | 'hint' | 'model_answer' | 'feedback' | 'clarification' | 'answer' | 'closing';

export interface InterviewTurn {
  id: string;
  at: string;
  speaker: 'ai' | 'user';
  kind: InterviewTurnKind;
  text: string;
  /** Index into the question plan this turn belongs to. */
  questionIndex: number;
  analysis?: AnswerAnalysis;
  metrics?: AnswerMetrics;
}

export interface InterviewSummary {
  overallScore: number;
  readiness: 'ready' | 'almost' | 'needs_practice';
  strengths: string[];
  improve: string[];
  perQuestion: Array<{ question: string; score: number | null; verdict: AnswerVerdict }>;
  method: 'ai' | 'rule-based';
}

export interface InterviewSession {
  id: string;
  /** live = AI speaks and listens with automatic turn-taking; coach = answer at your own pace with suggestions. */
  mode: 'live' | 'coach';
  applicationId: string | null;
  role: string;
  company: string;
  hasJobDescription: boolean;
  questions: InterviewQuestion[];
  /** Question currently being asked (== questions.length when finished). */
  current: number;
  /** State of the current question: follow-ups asked so far, whether a hint was given, the question text now awaiting an answer. */
  pending: { followUps: number; hintGiven: boolean; asking: string };
  turns: InterviewTurn[];
  status: 'active' | 'finished';
  summary: InterviewSummary | null;
  /** Folder on this computer where the transcript and Q&A are saved, e.g. data/interviews/SOC Analyst - Acme - 2026-09-27 22-15. */
  folder: string;
  method: 'ai' | 'rule-based';
  createdAt: string;
  updatedAt: string;
}

// ------------------------------------------------------------------ skills & learning

export interface SkillGapRow {
  skill: string;
  /** Share of matched jobs (last 30 days) that require or prefer it. */
  demandPct: number;
  jobs: number;
  inResume: boolean;
  /** Jobs that would reach the auto-apply score if the resume showed this skill (measured by re-scoring). */
  unlocks: number;
  importance: 'required' | 'preferred';
}

export interface SkillGapReport {
  role: string;
  jobsAnalysed: number;
  windowDays: number;
  rows: SkillGapRow[];
  computedAt: string;
}

export interface LearningPlan {
  id: string;
  skill: string;
  targetRole: string;
  overview: string;
  steps: Array<{ title: string; detail: string; hours: number; done: boolean }>;
  resources: Array<{ type: 'docs' | 'course' | 'video' | 'practice'; title: string; searchQuery: string }>;
  proofProject: { title: string; description: string; deliverables: string[] };
  status: 'planned' | 'learning' | 'done';
  confirmation: { statement: string; projectUrl: string; at: string } | null;
  method: 'ai' | 'rule-based';
  createdAt: string;
  updatedAt: string;
}

// ------------------------------------------------------------------ career assistant

export interface ChatCitation {
  id: string;
  source: string;
  label: string;
}

export interface ProposedAction {
  type: 'single_apply' | 'agent_start' | 'agent_stop' | 'set_stage' | 'interview_prep' | 'learning_plan' | 'open_resume';
  url?: string;
  applicationId?: string;
  stage?: string;
  skill?: string;
  /** Human-readable description shown on the Confirm button. */
  summary: string;
}

export interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
  citations: ChatCitation[];
  action: ProposedAction | null;
  method: 'ai' | 'rule-based';
  at: string;
}
