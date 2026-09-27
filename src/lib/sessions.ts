/**
 * Browser-side registry of resume sessions. Only the session id, its secret
 * token and a little display metadata are stored locally; the resume itself
 * lives on the server. This is what lets a refresh (or a later visit) restore
 * the session without uploading the resume again.
 */
export interface StoredSession {
  id: string;
  token: string;
  title: string;
  status: 'draft' | 'finalized';
  updatedAt: string;
  score?: number | null;
}

const KEY = 'ats-builder-sessions';
const LAST = 'ats-builder-last-session';

function read(): StoredSession[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as StoredSession[]) : [];
    return Array.isArray(list) ? list.filter((s) => s && typeof s.id === 'string' && typeof s.token === 'string') : [];
  } catch {
    return [];
  }
}

function write(list: StoredSession[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 50)));
  } catch {
    /* storage unavailable (private mode) — the session still works for this tab */
  }
}

export const sessionStore = {
  list(): StoredSession[] {
    return read().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  get(id: string): StoredSession | undefined {
    return read().find((s) => s.id === id);
  },
  token(id: string): string | undefined {
    return this.get(id)?.token;
  },
  upsert(entry: Partial<StoredSession> & { id: string }) {
    const list = read();
    const i = list.findIndex((s) => s.id === entry.id);
    if (i >= 0) list[i] = { ...list[i], ...entry };
    else if (entry.token) list.unshift({ title: 'Untitled resume', status: 'draft', updatedAt: new Date().toISOString(), ...entry } as StoredSession);
    write(list);
  },
  remove(id: string) {
    write(read().filter((s) => s.id !== id));
    try {
      if (localStorage.getItem(LAST) === id) localStorage.removeItem(LAST);
    } catch {
      /* ignore */
    }
  },
  setLast(id: string) {
    try {
      localStorage.setItem(LAST, id);
    } catch {
      /* ignore */
    }
  },
  last(): StoredSession | undefined {
    try {
      const id = localStorage.getItem(LAST);
      return id ? this.get(id) : undefined;
    } catch {
      return undefined;
    }
  },
};
