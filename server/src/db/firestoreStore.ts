import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { AtsResult } from '../../../shared/ats.js';
import type { DocBase, DocCollection, MessageRow, SessionRow, Store, VersionMeta, VersionRow } from './store.js';

/**
 * Cloud Firestore store (production on Vercel).
 *
 * Collections (top level, so no composite indexes are needed):
 *   resume_sessions/{id}        session row, incl. ownerUid
 *   resume_versions/{id}        version rows with sessionId
 *   chat_messages/{id}          chat rows with sessionId
 *   resume_files/{sessionId_n}  original upload, in ≤ 900 KB chunks
 *   <name>/{id}                 owner documents (profiles, job_applications, …), incl. ownerUid
 * Every collection name starts with the configured prefix ("aca_" by default),
 * so this app can share a Firebase project with resume-creator-ai without
 * either app seeing the other's data.
 * Queries use a single equality filter and sort in memory — sessions hold
 * tens of versions/messages, so this stays cheap and index-free.
 */

const CHUNK = 900_000;

export function firebaseApp(creds?: { projectId: string; clientEmail: string; privateKey: string }): App {
  const existing = getApps()[0];
  if (existing) return existing;
  if (creds?.projectId && creds.clientEmail && creds.privateKey) {
    return initializeApp({ credential: cert({ projectId: creds.projectId, clientEmail: creds.clientEmail, privateKey: creds.privateKey }), projectId: creds.projectId });
  }
  // Application default credentials (e.g. GOOGLE_APPLICATION_CREDENTIALS or running on Google Cloud).
  return initializeApp(creds?.projectId ? { projectId: creds.projectId } : undefined);
}

export class FirestoreStore implements Store {
  readonly kind = 'firestore' as const;
  private db: Firestore;

  constructor(
    creds?: { projectId: string; clientEmail: string; privateKey: string },
    private prefix = 'aca_',
  ) {
    this.db = getFirestore(firebaseApp(creds));
    try {
      this.db.settings({ ignoreUndefinedProperties: true });
    } catch {
      // settings() may only be called once per instance (warm serverless reuse).
    }
  }

  private sessions() {
    return this.db.collection(`${this.prefix}resume_sessions`);
  }
  private versions() {
    return this.db.collection(`${this.prefix}resume_versions`);
  }
  private messages() {
    return this.db.collection(`${this.prefix}chat_messages`);
  }
  private files() {
    return this.db.collection(`${this.prefix}resume_files`);
  }
  private docs(collection: DocCollection) {
    return this.db.collection(`${this.prefix}${collection}`);
  }

  async migrate() {
    // Schemaless; nothing to migrate.
  }

  async createSession(row: SessionRow) {
    await this.sessions().doc(row.id).set(row);
  }

  async getSession(id: string) {
    const snap = await this.sessions().doc(id).get();
    if (!snap.exists) return null;
    const d = snap.data() as SessionRow;
    return { ...d, ownerUid: d.ownerUid ?? null, origin: d.origin === 'automation' ? ('automation' as const) : ('manual' as const), job: d.job ?? null, userFacts: d.userFacts || [], undoStack: d.undoStack || [], redoStack: d.redoStack || [] };
  }

  async updateSession(id: string, patch: Partial<Omit<SessionRow, 'id' | 'createdAt'>>) {
    if (Object.keys(patch).length) await this.sessions().doc(id).update(patch as Record<string, unknown>);
  }

  private async deleteWhere(col: FirebaseFirestore.CollectionReference, field: string, value: string) {
    for (;;) {
      const snap = await col.where(field, '==', value).limit(400).get();
      if (snap.empty) return;
      const batch = this.db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  }

  async deleteSession(id: string) {
    await this.deleteWhere(this.versions(), 'sessionId', id);
    await this.deleteWhere(this.messages(), 'sessionId', id);
    await this.deleteWhere(this.files(), 'sessionId', id);
    await this.sessions().doc(id).delete();
  }

  async listSessionsByOwner(uid: string) {
    const snap = await this.sessions().where('ownerUid', '==', uid).limit(300).get();
    const rows = snap.docs.map((d) => d.data() as SessionRow).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const scores = await Promise.all(
      rows.map((r) => (r.currentVersionId ? this.versions().doc(r.currentVersionId).get().then((v) => (v.exists ? ((v.data() as VersionRow).atsScore ?? null) : null)) : Promise.resolve(null))),
    );
    return rows.map((r, i) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      updatedAt: r.updatedAt,
      currentVersionId: r.currentVersionId,
      atsScore: scores[i],
      origin: r.origin === 'automation' ? ('automation' as const) : ('manual' as const),
      job: r.job ?? null,
    }));
  }

  async listExpiredSessions(nowIso: string) {
    const snap = await this.sessions().where('expiresAt', '<', nowIso).limit(200).get();
    return snap.docs.map((d) => ({ id: d.id, originalFilePath: (d.data() as SessionRow).originalFilePath ?? null }));
  }

  async insertVersion(row: VersionRow) {
    await this.versions().doc(row.id).set(row);
  }

  async getVersion(sessionId: string, id: string) {
    const snap = await this.versions().doc(id).get();
    if (!snap.exists) return null;
    const v = snap.data() as VersionRow;
    return v.sessionId === sessionId ? v : null;
  }

  async listVersions(sessionId: string): Promise<VersionMeta[]> {
    const snap = await this.versions().where('sessionId', '==', sessionId).select('id', 'sessionId', 'number', 'label', 'source', 'instruction', 'parentId', 'atsScore', 'createdAt').get();
    return snap.docs.map((d) => d.data() as VersionMeta).sort((a, b) => a.number - b.number);
  }

  async updateVersionAts(id: string, ats: AtsResult, score: number) {
    await this.versions().doc(id).update({ ats, atsScore: score });
  }

  async maxVersionNumber(sessionId: string) {
    const list = await this.listVersions(sessionId);
    return list.length ? list[list.length - 1].number : 0;
  }

  async insertMessage(row: MessageRow) {
    await this.messages().doc(row.id).set({ ...row, seq: Date.now() + Math.random() });
  }

  async listMessages(sessionId: string, limit: number) {
    const snap = await this.messages().where('sessionId', '==', sessionId).get();
    const rows = snap.docs.map((d) => d.data() as MessageRow & { seq?: number }).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || (a.seq || 0) - (b.seq || 0));
    return rows.slice(-limit).map(({ seq: _seq, ...m }) => m);
  }

  async putFile(sessionId: string, data: Buffer) {
    const batch = this.db.batch();
    for (let i = 0, n = 0; i < data.length; i += CHUNK, n++) {
      batch.set(this.files().doc(`${sessionId}_${n}`), { sessionId, n, data: data.subarray(i, i + CHUNK) });
    }
    await batch.commit();
  }

  async getFile(sessionId: string) {
    const snap = await this.files().where('sessionId', '==', sessionId).get();
    if (snap.empty) return null;
    const parts = snap.docs.map((d) => d.data() as { n: number; data: Buffer }).sort((a, b) => a.n - b.n);
    return Buffer.concat(parts.map((p) => Buffer.from(p.data)));
  }

  async docGet<T extends DocBase>(collection: DocCollection, id: string) {
    const snap = await this.docs(collection).doc(id).get();
    return snap.exists ? (snap.data() as T) : null;
  }

  async docPut<T extends DocBase>(collection: DocCollection, doc: T) {
    // Round-trip through JSON: Firestore rejects undefined values and class instances.
    await this.docs(collection).doc(doc.id).set(JSON.parse(JSON.stringify(doc)));
  }

  async docDelete(collection: DocCollection, id: string) {
    await this.docs(collection).doc(id).delete();
  }

  async docList<T extends DocBase>(collection: DocCollection, ownerUid: string, limit = 2000) {
    // Single equality filter (no composite index needed); sorted in memory.
    const snap = await this.docs(collection).where('ownerUid', '==', ownerUid).get();
    return snap.docs
      .map((d) => d.data() as T)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }

  async close() {
    // Connections are managed by the SDK.
  }
}
