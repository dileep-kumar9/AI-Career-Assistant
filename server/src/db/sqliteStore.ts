import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS, type DocBase, type DocCollection, type MessageRow, type SessionRow, type Store, type VersionMeta, type VersionRow } from './store.js';

const SESSION_COLUMNS: Record<string, string> = {
  tokenHash: 'token_hash',
  title: 'title',
  status: 'status',
  originalFileName: 'original_file_name',
  originalFileMime: 'original_file_mime',
  originalFileSize: 'original_file_size',
  originalFilePath: 'original_file_path',
  originalText: 'original_text',
  originalResume: 'original_resume',
  originalLocked: 'original_locked',
  jobDescription: 'job_description',
  jdAnalysis: 'jd_analysis',
  currentVersionId: 'current_version_id',
  undoStack: 'undo_stack',
  redoStack: 'redo_stack',
  userFacts: 'user_facts',
  ownerUid: 'owner_uid',
  origin: 'origin',
  job: 'job_meta',
  updatedAt: 'updated_at',
  expiresAt: 'expires_at',
};
const JSON_FIELDS = new Set(['originalResume', 'jdAnalysis', 'undoStack', 'redoStack', 'userFacts', 'job']);

const parse = <T>(v: unknown, fallback: T): T => {
  if (v === null || v === undefined) return fallback;
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return fallback;
  }
};

/** SQLite store using Node's built-in node:sqlite driver (no native build step). */
export class SqliteStore implements Store {
  readonly kind = 'sqlite' as const;
  private db: DatabaseSync;

  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  }

  async migrate() {
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
    const done = new Set((this.db.prepare('SELECT version FROM schema_migrations').all() as any[]).map((r) => Number(r.version)));
    for (const m of MIGRATIONS) {
      if (done.has(m.version)) continue;
      this.db.exec('BEGIN');
      try {
        this.db.exec(m.sqlite);
        this.db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(m.version, m.name, new Date().toISOString());
        this.db.exec('COMMIT');
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
      }
    }
  }

  private toSession(r: any): SessionRow {
    return {
      id: r.id,
      tokenHash: r.token_hash,
      title: r.title,
      status: r.status,
      originalFileName: r.original_file_name,
      originalFileMime: r.original_file_mime,
      originalFileSize: r.original_file_size === null ? null : Number(r.original_file_size),
      originalFilePath: r.original_file_path,
      originalText: r.original_text,
      originalResume: parse(r.original_resume, null as any),
      originalLocked: Boolean(r.original_locked),
      jobDescription: r.job_description,
      jdAnalysis: parse(r.jd_analysis, null),
      currentVersionId: r.current_version_id,
      undoStack: parse(r.undo_stack, []),
      redoStack: parse(r.redo_stack, []),
      userFacts: parse(r.user_facts, []),
      ownerUid: r.owner_uid ?? null,
      origin: r.origin === 'automation' ? 'automation' : 'manual',
      job: parse(r.job_meta, null),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      expiresAt: r.expires_at,
    };
  }

  private encode(field: string, value: unknown): any {
    if (JSON_FIELDS.has(field)) return value === null || value === undefined ? null : JSON.stringify(value);
    if (field === 'originalLocked') return value ? 1 : 0;
    return value ?? null;
  }

  async createSession(row: SessionRow) {
    const fields = ['id', 'createdAt', ...Object.keys(SESSION_COLUMNS)];
    const cols = fields.map((f) => (f === 'id' ? 'id' : f === 'createdAt' ? 'created_at' : SESSION_COLUMNS[f]));
    this.db
      .prepare(`INSERT INTO resume_sessions (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
      .run(...fields.map((f) => this.encode(f, (row as any)[f])));
  }

  async getSession(id: string) {
    const r = this.db.prepare('SELECT * FROM resume_sessions WHERE id = ?').get(id);
    return r ? this.toSession(r) : null;
  }

  async updateSession(id: string, patch: Partial<SessionRow>) {
    const entries = Object.entries(patch).filter(([k]) => SESSION_COLUMNS[k]);
    if (!entries.length) return;
    this.db
      .prepare(`UPDATE resume_sessions SET ${entries.map(([k]) => `${SESSION_COLUMNS[k]} = ?`).join(', ')} WHERE id = ?`)
      .run(...entries.map(([k, v]) => this.encode(k, v)), id);
  }

  async deleteSession(id: string) {
    this.db.prepare('DELETE FROM resume_sessions WHERE id = ?').run(id);
  }

  async listSessionsByOwner(uid: string) {
    const rows = this.db
      .prepare('SELECT s.id, s.title, s.status, s.updated_at, s.current_version_id, s.origin, s.job_meta, v.ats_score FROM resume_sessions s LEFT JOIN resume_versions v ON v.id = s.current_version_id WHERE s.owner_uid = ? ORDER BY s.updated_at DESC LIMIT 200')
      .all(uid) as any[];
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      updatedAt: r.updated_at,
      currentVersionId: r.current_version_id,
      atsScore: r.ats_score === null ? null : Number(r.ats_score),
      origin: r.origin === 'automation' ? ('automation' as const) : ('manual' as const),
      job: parse(r.job_meta, null),
    }));
  }

  async listExpiredSessions(nowIso: string) {
    return (this.db.prepare('SELECT id, original_file_path FROM resume_sessions WHERE expires_at < ?').all(nowIso) as any[]).map((r) => ({ id: r.id, originalFilePath: r.original_file_path }));
  }

  async insertVersion(v: VersionRow) {
    this.db
      .prepare('INSERT INTO resume_versions (id, session_id, number, label, source, instruction, parent_id, resume, ats, ats_score, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(v.id, v.sessionId, v.number, v.label, v.source, v.instruction, v.parentId, JSON.stringify(v.resume), v.ats ? JSON.stringify(v.ats) : null, v.atsScore, v.createdAt);
  }

  private toVersionMeta(r: any): VersionMeta {
    return { id: r.id, sessionId: r.session_id, number: Number(r.number), label: r.label, source: r.source, instruction: r.instruction, parentId: r.parent_id, atsScore: r.ats_score === null ? null : Number(r.ats_score), createdAt: r.created_at };
  }

  async getVersion(sessionId: string, id: string) {
    const r: any = this.db.prepare('SELECT * FROM resume_versions WHERE session_id = ? AND id = ?').get(sessionId, id);
    return r ? { ...this.toVersionMeta(r), resume: parse(r.resume, null as any), ats: parse(r.ats, null) } : null;
  }

  async listVersions(sessionId: string) {
    return (this.db.prepare('SELECT id, session_id, number, label, source, instruction, parent_id, ats_score, created_at FROM resume_versions WHERE session_id = ? ORDER BY number').all(sessionId) as any[]).map((r) => this.toVersionMeta(r));
  }

  async updateVersionAts(id: string, ats: unknown, score: number) {
    this.db.prepare('UPDATE resume_versions SET ats = ?, ats_score = ? WHERE id = ?').run(JSON.stringify(ats), score, id);
  }

  async maxVersionNumber(sessionId: string) {
    const r: any = this.db.prepare('SELECT MAX(number) AS n FROM resume_versions WHERE session_id = ?').get(sessionId);
    return Number(r?.n || 0);
  }

  async insertMessage(m: MessageRow) {
    this.db.prepare('INSERT INTO chat_messages (id, session_id, role, content, version_id, meta, created_at) VALUES (?,?,?,?,?,?,?)').run(m.id, m.sessionId, m.role, m.content, m.versionId, JSON.stringify(m.meta || {}), m.createdAt);
  }

  async listMessages(sessionId: string, limit: number) {
    const rows = this.db.prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?').all(sessionId, limit) as any[];
    return rows.reverse().map((r) => ({ id: r.id, sessionId: r.session_id, role: r.role, content: r.content, versionId: r.version_id, meta: parse(r.meta, {}), createdAt: r.created_at }));
  }

  async docGet<T extends DocBase>(collection: DocCollection, id: string) {
    const r: any = this.db.prepare('SELECT data FROM aca_docs WHERE collection = ? AND id = ?').get(collection, id);
    return r ? parse<T | null>(r.data, null) : null;
  }

  async docPut<T extends DocBase>(collection: DocCollection, doc: T) {
    this.db
      .prepare('INSERT INTO aca_docs (collection, id, owner_uid, data, updated_at) VALUES (?,?,?,?,?) ON CONFLICT(collection, id) DO UPDATE SET owner_uid = excluded.owner_uid, data = excluded.data, updated_at = excluded.updated_at')
      .run(collection, doc.id, doc.ownerUid, JSON.stringify(doc), doc.updatedAt);
  }

  async docDelete(collection: DocCollection, id: string) {
    this.db.prepare('DELETE FROM aca_docs WHERE collection = ? AND id = ?').run(collection, id);
  }

  async docList<T extends DocBase>(collection: DocCollection, ownerUid: string, limit = 2000) {
    const rows = this.db.prepare('SELECT data FROM aca_docs WHERE collection = ? AND owner_uid = ? ORDER BY updated_at DESC LIMIT ?').all(collection, ownerUid, limit) as any[];
    return rows.map((r) => parse<T | null>(r.data, null)).filter((r): r is T => !!r);
  }

  async close() {
    this.db.close();
  }
}
