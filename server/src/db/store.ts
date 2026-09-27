import type { ResumeData } from '../../../shared/resumeTypes.js';
import type { JDAnalysis } from '../../../shared/jdAnalyzer.js';
import type { AtsResult } from '../../../shared/ats.js';
import type { JobApplication } from '../../../shared/careerTypes.js';
import type { ChatMessageMeta, JobMeta, ResumeListItem, SessionOrigin, SessionStatus, VersionSource } from '../../../shared/apiTypes.js';

export interface SessionRow {
  id: string;
  tokenHash: string;
  title: string;
  status: SessionStatus;
  originalFileName: string | null;
  originalFileMime: string | null;
  originalFileSize: number | null;
  originalFilePath: string | null;
  originalText: string;
  originalResume: ResumeData;
  originalLocked: boolean;
  jobDescription: string;
  jdAnalysis: JDAnalysis | null;
  currentVersionId: string | null;
  undoStack: string[];
  redoStack: string[];
  /** Facts the user explicitly confirmed in chat (e.g. "I have used Tableau"); allowed as evidence. */
  userFacts: string[];
  /** Firebase uid of the signed-in owner; null for guest sessions (token-only). */
  ownerUid: string | null;
  /** 'automation' = created by the Job Apply Agent for one job (listed separately in My resumes). */
  origin: SessionOrigin;
  job: JobMeta | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface VersionRow {
  id: string;
  sessionId: string;
  number: number;
  label: string;
  source: VersionSource;
  instruction: string | null;
  parentId: string | null;
  resume: ResumeData;
  ats: AtsResult | null;
  atsScore: number | null;
  createdAt: string;
}

export type VersionMeta = Omit<VersionRow, 'resume' | 'ats'>;

/**
 * Owner-scoped JSON documents used by everything outside the resume engine
 * (profiles, applications, agent runs, interviews, learning plans, RAG).
 * Firestore: collection "<prefix><name>"; SQL: one aca_docs table.
 */
export const DOC_COLLECTIONS = ['profiles', 'job_applications', 'agent_settings', 'agent_runs', 'jobs_seen', 'interviews', 'learning', 'kb_chunks'] as const;
export type DocCollection = (typeof DOC_COLLECTIONS)[number];

export interface DocBase {
  id: string;
  ownerUid: string;
  updatedAt: string;
}

/** A job_applications document. */
export type ApplicationRow = JobApplication & { ownerUid: string };

export interface MessageRow {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  versionId: string | null;
  meta: ChatMessageMeta;
  createdAt: string;
}

/** Persistence contract implemented by the SQLite and PostgreSQL stores. */
export interface Store {
  readonly kind: 'sqlite' | 'postgres' | 'firestore';
  migrate(): Promise<void>;
  createSession(row: SessionRow): Promise<void>;
  getSession(id: string): Promise<SessionRow | null>;
  updateSession(id: string, patch: Partial<Omit<SessionRow, 'id' | 'createdAt'>>): Promise<void>;
  deleteSession(id: string): Promise<void>;
  /** Sessions owned by a signed-in user, newest first. */
  listSessionsByOwner(uid: string): Promise<Array<ResumeListItem & { currentVersionId: string | null }>>;
  /** Optional blob storage for original uploads (used where there is no persistent disk, e.g. Vercel). */
  putFile?(sessionId: string, data: Buffer): Promise<void>;
  getFile?(sessionId: string): Promise<Buffer | null>;
  listExpiredSessions(nowIso: string): Promise<Array<{ id: string; originalFilePath: string | null }>>;
  insertVersion(row: VersionRow): Promise<void>;
  getVersion(sessionId: string, id: string): Promise<VersionRow | null>;
  listVersions(sessionId: string): Promise<VersionMeta[]>;
  updateVersionAts(id: string, ats: AtsResult, score: number): Promise<void>;
  maxVersionNumber(sessionId: string): Promise<number>;
  insertMessage(row: MessageRow): Promise<void>;
  listMessages(sessionId: string, limit: number): Promise<MessageRow[]>;
  docGet<T extends DocBase>(collection: DocCollection, id: string): Promise<T | null>;
  docPut<T extends DocBase>(collection: DocCollection, doc: T): Promise<void>;
  docDelete(collection: DocCollection, id: string): Promise<void>;
  /** The owner's documents, newest updatedAt first. */
  docList<T extends DocBase>(collection: DocCollection, ownerUid: string, limit?: number): Promise<T[]>;
  close(): Promise<void>;
}

/**
 * Schema migrations. Each entry is applied once, in order, and recorded in
 * schema_migrations. JSON columns are TEXT in SQLite and JSONB in PostgreSQL.
 */
export const MIGRATIONS: Array<{ version: number; name: string; sqlite: string; postgres: string }> = [
  {
    version: 1,
    name: 'initial schema',
    sqlite: `
      CREATE TABLE resume_sessions (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','finalized')),
        original_file_name TEXT,
        original_file_mime TEXT,
        original_file_size INTEGER,
        original_file_path TEXT,
        original_text TEXT NOT NULL,
        original_resume TEXT NOT NULL,
        original_locked INTEGER NOT NULL DEFAULT 0,
        job_description TEXT NOT NULL DEFAULT '',
        jd_analysis TEXT,
        current_version_id TEXT,
        undo_stack TEXT NOT NULL DEFAULT '[]',
        redo_stack TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX idx_sessions_expires ON resume_sessions (expires_at);
      CREATE TABLE resume_versions (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES resume_sessions(id) ON DELETE CASCADE,
        number INTEGER NOT NULL,
        label TEXT NOT NULL,
        source TEXT NOT NULL,
        instruction TEXT,
        parent_id TEXT,
        resume TEXT NOT NULL,
        ats TEXT,
        ats_score INTEGER,
        created_at TEXT NOT NULL,
        UNIQUE (session_id, number)
      );
      CREATE INDEX idx_versions_session ON resume_versions (session_id, number);
      CREATE TABLE chat_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES resume_sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user','assistant')),
        content TEXT NOT NULL,
        version_id TEXT,
        meta TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_messages_session ON chat_messages (session_id, created_at);
    `,
    postgres: `
      CREATE TABLE resume_sessions (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','finalized')),
        original_file_name TEXT,
        original_file_mime TEXT,
        original_file_size INTEGER,
        original_file_path TEXT,
        original_text TEXT NOT NULL,
        original_resume JSONB NOT NULL,
        original_locked BOOLEAN NOT NULL DEFAULT FALSE,
        job_description TEXT NOT NULL DEFAULT '',
        jd_analysis JSONB,
        current_version_id TEXT,
        undo_stack JSONB NOT NULL DEFAULT '[]'::jsonb,
        redo_stack JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX idx_sessions_expires ON resume_sessions (expires_at);
      CREATE TABLE resume_versions (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES resume_sessions(id) ON DELETE CASCADE,
        number INTEGER NOT NULL,
        label TEXT NOT NULL,
        source TEXT NOT NULL,
        instruction TEXT,
        parent_id TEXT,
        resume JSONB NOT NULL,
        ats JSONB,
        ats_score INTEGER,
        created_at TIMESTAMPTZ NOT NULL,
        UNIQUE (session_id, number)
      );
      CREATE INDEX idx_versions_session ON resume_versions (session_id, number);
      CREATE TABLE chat_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES resume_sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user','assistant')),
        content TEXT NOT NULL,
        version_id TEXT,
        meta JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX idx_messages_session ON chat_messages (session_id, created_at);
    `,
  },
  {
    version: 2,
    name: 'user-confirmed facts',
    sqlite: `ALTER TABLE resume_sessions ADD COLUMN user_facts TEXT NOT NULL DEFAULT '[]';`,
    postgres: `ALTER TABLE resume_sessions ADD COLUMN user_facts JSONB NOT NULL DEFAULT '[]'::jsonb;`,
  },
  {
    version: 3,
    name: 'session owners (Firebase uid)',
    sqlite: `ALTER TABLE resume_sessions ADD COLUMN owner_uid TEXT; CREATE INDEX idx_sessions_owner ON resume_sessions (owner_uid);`,
    postgres: `ALTER TABLE resume_sessions ADD COLUMN owner_uid TEXT; CREATE INDEX idx_sessions_owner ON resume_sessions (owner_uid);`,
  },
  {
    version: 4,
    name: 'automation resumes and owner documents',
    sqlite: `
      ALTER TABLE resume_sessions ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual';
      ALTER TABLE resume_sessions ADD COLUMN job_meta TEXT;
      CREATE TABLE aca_docs (
        collection TEXT NOT NULL,
        id TEXT NOT NULL,
        owner_uid TEXT NOT NULL,
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (collection, id)
      );
      CREATE INDEX idx_docs_owner ON aca_docs (collection, owner_uid, updated_at);
    `,
    postgres: `
      ALTER TABLE resume_sessions ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual';
      ALTER TABLE resume_sessions ADD COLUMN job_meta JSONB;
      CREATE TABLE aca_docs (
        collection TEXT NOT NULL,
        id TEXT NOT NULL,
        owner_uid TEXT NOT NULL,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (collection, id)
      );
      CREATE INDEX idx_docs_owner ON aca_docs (collection, owner_uid, updated_at);
    `,
  },
];

export async function createStore(databaseUrl: string, firebase?: { projectId: string; clientEmail: string; privateKey: string }, firestorePrefix = 'aca_'): Promise<Store> {
  if (/^firestore/i.test(databaseUrl)) {
    const { FirestoreStore } = await import('./firestoreStore.js');
    return new FirestoreStore(firebase, firestorePrefix);
  }
  if (/^postgres(ql)?:\/\//i.test(databaseUrl)) {
    const { PostgresStore } = await import('./postgresStore.js');
    return new PostgresStore(databaseUrl);
  }
  const { SqliteStore } = await import('./sqliteStore.js');
  return new SqliteStore(databaseUrl.replace(/^sqlite:/i, ''));
}
