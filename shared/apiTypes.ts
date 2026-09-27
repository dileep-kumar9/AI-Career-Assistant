import type { ResumeData } from './resumeTypes.js';
import type { JDAnalysis } from './jdAnalyzer.js';
import type { AtsResult, AtsWeights } from './ats.js';
import type { ResumeChange } from './diff.js';

export type SessionStatus = 'draft' | 'finalized';

export type VersionSource = 'original' | 'generate' | 'edit' | 'manual' | 'restore' | 'template' | 'correction';

export interface VersionSummary {
  id: string;
  number: number;
  label: string;
  source: VersionSource;
  instruction: string | null;
  parentId: string | null;
  atsScore: number | null;
  createdAt: string;
}

export interface VersionDetail extends VersionSummary {
  resume: ResumeData;
}

export type ChatKind = 'edit' | 'undo' | 'redo' | 'restore' | 'diff' | 'info' | 'error' | 'generate' | 'template' | 'question';

export interface ChatMessageMeta {
  kind?: ChatKind;
  changes?: string[];
  warnings?: string[];
  skillGaps?: string[];
  questions?: string[];
  diff?: ResumeChange[];
  /** Items the assistant offered to add; the user can accept with "yes", "add all", names or numbers. */
  offer?: ChatOffer;
  scoreBefore?: number | null;
  scoreAfter?: number | null;
  provider?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  versionId: string | null;
  meta: ChatMessageMeta;
  createdAt: string;
}

export interface OriginalFileInfo {
  name: string;
  mimeType: string;
  size: number;
}

export interface SessionView {
  id: string;
  title: string;
  origin: SessionOrigin;
  job: JobMeta | null;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  originalFile: OriginalFileInfo | null;
  originalText: string;
  /** Once a tailored resume has been generated the original becomes immutable. */
  originalLocked: boolean;
  original: ResumeData;
  current: ResumeData;
  currentVersion: VersionSummary;
  jobDescription: string;
  jdAnalysis: JDAnalysis | null;
  ats: AtsResult | null;
  previousScore: number | null;
  versions: VersionSummary[];
  canUndo: boolean;
  canRedo: boolean;
  messages: ChatMessage[];
  ai: { available: boolean; providers: string[] };
  weights: AtsWeights;
}

export interface CreateSessionResponse {
  session: SessionView;
  /** Secret bearer token for this session. Only returned once, at creation. */
  token: string;
  extraction: { method: 'ai' | 'heuristic'; warnings: string[] };
}

export interface EditResponse {
  session: SessionView;
  message: ChatMessage;
  changed: boolean;
}

export interface ReviewData {
  resume: ResumeData;
  ats: AtsResult | null;
  pageCount: number;
  template: string;
  warnings: string[];
  missingKeywords: string[];
}

export interface ApiErrorBody {
  error: string;
  code?: string;
  details?: unknown;
}

export interface OfferedProject {
  title: string;
  description: string;
  technologies: string[];
}

export interface ChatOffer {
  skills?: string[];
  projects?: OfferedProject[];
}

// ------------------------------------------------------------------ automation (Job Apply Agent)

/** Who created a resume session: the user in the builder, or the Job Apply Agent. */
export type SessionOrigin = 'manual' | 'automation';

/** The job an automation resume was tailored for. */
export interface JobMeta {
  title: string;
  company: string;
  url: string;
  /** The job_applications record this resume was made for. */
  applicationId: string | null;
  /** The resume it was copied from. */
  baseResumeId: string | null;
}

/** Row in “My resumes”. */
export interface ResumeListItem {
  id: string;
  title: string;
  status: SessionStatus;
  updatedAt: string;
  atsScore: number | null;
  origin: SessionOrigin;
  job: JobMeta | null;
}

export type ApplicationStatus = 'found' | 'tailoring' | 'ready' | 'applying' | 'applied' | 'needs_attention' | 'skipped' | 'failed';

export interface ApplicationAnswer {
  question: string;
  answer: string;
  source: 'profile' | 'saved' | 'ai' | 'user';
}

/** A job the agent found, prepared or applied to (job_applications). */
export interface JobApplication {
  id: string;
  jobTitle: string;
  company: string;
  location: string;
  jobUrl: string;
  applyUrl: string;
  /** greenhouse | lever | ashby | workday | linkedin | naukri | indeed | pasted | … */
  source: string;
  status: ApplicationStatus;
  matchScore: number | null;
  atsBefore: number | null;
  atsAfter: number | null;
  resumeSessionId: string | null;
  resumeVersionId: string | null;
  answers: ApplicationAnswer[];
  mode: 'review' | 'auto' | 'manual';
  appliedAt: string | null;
  /** Why it needs attention / failed / was skipped. */
  note: string;
  createdAt: string;
  updatedAt: string;
}
