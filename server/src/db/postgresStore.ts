import pg from 'pg';
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
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));

/** PostgreSQL store; JSON documents are stored as JSONB. */
export class PostgresStore implements Store {
  readonly kind = 'postgres' as const;
  private pool: pg.Pool;

  constructor(url: string) {
    this.pool = new pg.Pool({ connectionString: url, max: Number(process.env.PG_POOL_SIZE || 10), ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined });
  }

  async migrate() {
    const client = await this.pool.connect();
    try {
      await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL)');
      // Serialise concurrent migrators (multiple app instances starting at once).
      await client.query('SELECT pg_advisory_lock(727274)');
      const done = new Set((await client.query('SELECT version FROM schema_migrations')).rows.map((r) => Number(r.version)));
      for (const m of MIGRATIONS) {
        if (done.has(m.version)) continue;
        await client.query('BEGIN');
        try {
          await client.query(m.postgres);
          await client.query('INSERT INTO schema_migrations (version, name, applied_at) VALUES ($1, $2, now())', [m.version, m.name]);
          await client.query('COMMIT');
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        }
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock(727274)').catch(() => undefined);
      client.release();
    }
  }

  private encode(field: string, value: unknown) {
    if (JSON_FIELDS.has(field)) return value === null || value === undefined ? null : JSON.stringify(value);
    return value ?? null;
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
      originalResume: r.original_resume,
      originalLocked: Boolean(r.original_locked),
      jobDescription: r.job_description,
      jdAnalysis: r.jd_analysis,
      currentVersionId: r.current_version_id,
      undoStack: r.undo_stack || [],
      redoStack: r.redo_stack || [],
      userFacts: r.user_facts || [],
      ownerUid: r.owner_uid ?? null,
      origin: r.origin === 'automation' ? 'automation' : 'manual',
      job: r.job_meta ?? null,
      createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at),
      expiresAt: iso(r.expires_at),
    };
  }

  async createSession(row: SessionRow) {
    const fields = ['id', 'createdAt', ...Object.keys(SESSION_COLUMNS)];
    const cols = fields.map((f) => (f === 'id' ? 'id' : f === 'createdAt' ? 'created_at' : SESSION_COLUMNS[f]));
    await this.pool.query(
      `INSERT INTO resume_sessions (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})`,
      fields.map((f) => this.encode(f, (row as any)[f])),
    );
  }

  async getSession(id: string) {
    const { rows } = await this.pool.query('SELECT * FROM resume_sessions WHERE id = $1', [id]);
    return rows[0] ? this.toSession(rows[0]) : null;
  }

  async updateSession(id: string, patch: Partial<SessionRow>) {
    const entries = Object.entries(patch).filter(([k]) => SESSION_COLUMNS[k]);
    if (!entries.length) return;
    await this.pool.query(
      `UPDATE resume_sessions SET ${entries.map(([k], i) => `${SESSION_COLUMNS[k]} = $${i + 1}`).join(', ')} WHERE id = $${entries.length + 1}`,
      [...entries.map(([k, v]) => this.encode(k, v)), id],
    );
  }

  async deleteSession(id: string) {
    await this.pool.query('DELETE FROM resume_sessions WHERE id = $1', [id]);
  }

  async listSessionsByOwner(uid: string) {
    const { rows } = await this.pool.query(
      'SELECT s.id, s.title, s.status, s.updated_at, s.current_version_id, s.origin, s.job_meta, v.ats_score FROM resume_sessions s LEFT JOIN resume_versions v ON v.id = s.current_version_id WHERE s.owner_uid = $1 ORDER BY s.updated_at DESC LIMIT 200',
      [uid],
    );
    return rows.map((r: any) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      updatedAt: new Date(r.updated_at).toISOString(),
      currentVersionId: r.current_version_id,
      atsScore: r.ats_score === null ? null : Number(r.ats_score),
      origin: r.origin === 'automation' ? ('automation' as const) : ('manual' as const),
      job: r.job_meta ?? null,
    }));
  }

  async listExpiredSessions(nowIso: string) {
    const { rows } = await this.pool.query('SELECT id, original_file_path FROM resume_sessions WHERE expires_at < $1', [nowIso]);
    return rows.map((r) => ({ id: r.id, originalFilePath: r.original_file_path }));
  }

  async insertVersion(v: VersionRow) {
    await this.pool.query(
      'INSERT INTO resume_versions (id, session_id, number, label, source, instruction, parent_id, resume, ats, ats_score, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [v.id, v.sessionId, v.number, v.label, v.source, v.instruction, v.parentId, JSON.stringify(v.resume), v.ats ? JSON.stringify(v.ats) : null, v.atsScore, v.createdAt],
    );
  }

  private toMeta(r: any): VersionMeta {
    return { id: r.id, sessionId: r.session_id, number: Number(r.number), label: r.label, source: r.source, instruction: r.instruction, parentId: r.parent_id, atsScore: r.ats_score === null ? null : Number(r.ats_score), createdAt: iso(r.created_at) };
  }

  async getVersion(sessionId: string, id: string) {
    const { rows } = await this.pool.query('SELECT * FROM resume_versions WHERE session_id = $1 AND id = $2', [sessionId, id]);
    return rows[0] ? { ...this.toMeta(rows[0]), resume: rows[0].resume, ats: rows[0].ats } : null;
  }

  async listVersions(sessionId: string) {
    const { rows } = await this.pool.query('SELECT id, session_id, number, label, source, instruction, parent_id, ats_score, created_at FROM resume_versions WHERE session_id = $1 ORDER BY number', [sessionId]);
    return rows.map((r) => this.toMeta(r));
  }

  async updateVersionAts(id: string, ats: unknown, score: number) {
    await this.pool.query('UPDATE resume_versions SET ats = $1, ats_score = $2 WHERE id = $3', [JSON.stringify(ats), score, id]);
  }

  async maxVersionNumber(sessionId: string) {
    const { rows } = await this.pool.query('SELECT COALESCE(MAX(number), 0) AS n FROM resume_versions WHERE session_id = $1', [sessionId]);
    return Number(rows[0]?.n || 0);
  }

  async insertMessage(m: MessageRow) {
    await this.pool.query('INSERT INTO chat_messages (id, session_id, role, content, version_id, meta, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [m.id, m.sessionId, m.role, m.content, m.versionId, JSON.stringify(m.meta || {}), m.createdAt]);
  }

  async listMessages(sessionId: string, limit: number) {
    const { rows } = await this.pool.query('SELECT * FROM (SELECT * FROM chat_messages WHERE session_id = $1 ORDER BY created_at DESC LIMIT $2) t ORDER BY created_at ASC', [sessionId, limit]);
    return rows.map((r) => ({ id: r.id, sessionId: r.session_id, role: r.role, content: r.content, versionId: r.version_id, meta: r.meta || {}, createdAt: iso(r.created_at) }));
  }

  async docGet<T extends DocBase>(collection: DocCollection, id: string) {
    const { rows } = await this.pool.query('SELECT data FROM aca_docs WHERE collection = $1 AND id = $2', [collection, id]);
    return (rows[0]?.data as T | undefined) ?? null;
  }

  async docPut<T extends DocBase>(collection: DocCollection, doc: T) {
    await this.pool.query(
      'INSERT INTO aca_docs (collection, id, owner_uid, data, updated_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (collection, id) DO UPDATE SET owner_uid = EXCLUDED.owner_uid, data = EXCLUDED.data, updated_at = EXCLUDED.updated_at',
      [collection, doc.id, doc.ownerUid, JSON.stringify(doc), doc.updatedAt],
    );
  }

  async docDelete(collection: DocCollection, id: string) {
    await this.pool.query('DELETE FROM aca_docs WHERE collection = $1 AND id = $2', [collection, id]);
  }

  async docList<T extends DocBase>(collection: DocCollection, ownerUid: string, limit = 2000) {
    const { rows } = await this.pool.query('SELECT data FROM aca_docs WHERE collection = $1 AND owner_uid = $2 ORDER BY updated_at DESC LIMIT $3', [collection, ownerUid, limit]);
    return rows.map((r: any) => r.data as T);
  }

  async close() {
    await this.pool.end();
  }
}
