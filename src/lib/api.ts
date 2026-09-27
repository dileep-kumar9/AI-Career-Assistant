import type { CreateSessionResponse, EditResponse, ReviewData, SessionView, VersionDetail, VersionSummary } from '../../shared/apiTypes';
import type { AtsResult } from '../../shared/ats';
import type { JDAnalysis } from '../../shared/jdAnalyzer';
import type { ResumeChange } from '../../shared/diff';
import type { ResumeData } from '../../shared/resumeTypes';
import { sessionStore } from './sessions';
import { idToken } from './firebase';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

const BASE = '/api/resumes';

async function call<T>(method: string, path: string, opts: { id?: string; body?: unknown; form?: FormData; raw?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  // Signed-in users are identified by their Firebase ID token (works on any device);
  // guests by the session token stored in this browser.
  const user = await idToken().catch(() => null);
  if (user) headers['X-Firebase-Auth'] = user;
  if (opts.id) {
    const token = sessionStore.token(opts.id);
    if (token) headers.Authorization = `Bearer ${token}`;
    else if (!user) throw new ApiError(401, 'This browser does not have access to that resume session. Sign in to open resumes from your account.', 'no_token');
  }
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { method, headers, body });
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection and try again.', 'network');
  }
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new ApiError(res.status, payload.error || `Request failed (${res.status}).`, payload.code);
  }
  if (opts.raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function remember(r: CreateSessionResponse) {
  sessionStore.upsert({ id: r.session.id, token: r.token, title: r.session.title, status: r.session.status, updatedAt: r.session.updatedAt });
  sessionStore.setLast(r.session.id);
  return r;
}

export function track(view: SessionView) {
  sessionStore.upsert({ id: view.id, title: view.title, status: view.status, updatedAt: view.updatedAt, score: view.ats?.total ?? null });
  return view;
}

async function download(id: string, format: 'pdf' | 'docx', versionId?: string) {
  const res = await call<Response>('POST', `/${id}/export/${format}`, { id, body: versionId ? { versionId } : {}, raw: true });
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || `resume.${format}`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { pageCount: Number(res.headers.get('X-Page-Count') || 0), name };
}

export const api = {
  upload(file: File) {
    const form = new FormData();
    form.append('file', file);
    return call<CreateSessionResponse>('POST', '/upload', { form }).then(remember);
  },
  paste(text: string) {
    return call<CreateSessionResponse>('POST', '/paste', { body: { text } }).then(remember);
  },
  get: (id: string) => call<SessionView>('GET', `/${id}`, { id }).then(track),
  rename: (id: string, title: string) => call<SessionView>('PATCH', `/${id}`, { id, body: { title } }).then(track),
  remove: (id: string) => call<void>('DELETE', `/${id}`, { id }).then(() => sessionStore.remove(id)),
  correctOriginal: (id: string, input: { text?: string; resume?: ResumeData }) => call<SessionView>('PUT', `/${id}/original`, { id, body: input }).then(track),
  async originalFileUrl(id: string) {
    const res = await call<Response>('GET', `/${id}/original/file`, { id, raw: true });
    return URL.createObjectURL(await res.blob());
  },
  /** Resumes in the signed-in account (any device). */
  listMine: () => call<{ resumes: Array<{ id: string; title: string; status: 'draft' | 'finalized'; updatedAt: string; atsScore: number | null }> }>('GET', ''),
  /** Moves a resume created in this browser as a guest into the signed-in account. */
  claim: (id: string) => call<{ id: string; claimed: boolean }>('POST', `/${id}/claim`, { id }),
  setJobDescriptionFromUrl: (id: string, url: string) => call<SessionView>('POST', `/${id}/job-description/url`, { id, body: { url } }).then(track),
  setJobDescription: (id: string, jobDescription: string) => call<SessionView>('POST', `/${id}/job-description`, { id, body: { jobDescription } }).then(track),
  updateJdAnalysis: (id: string, patch: Partial<JDAnalysis>) => call<SessionView>('PATCH', `/${id}/job-description/analysis`, { id, body: patch }).then(track),
  generate: (id: string) => call<SessionView>('POST', `/${id}/generate`, { id }).then(track),
  edit: (id: string, instruction: string) =>
    call<EditResponse>('POST', `/${id}/edit`, { id, body: { instruction } }).then((r) => {
      track(r.session);
      return r;
    }),
  /** Attach a project report / README / internship letter; the server adds it as a resume entry. */
  attach: (id: string, file: File, message: string) => {
    const form = new FormData();
    form.append('file', file);
    form.append('message', message);
    return call<EditResponse>('POST', `/${id}/attachment`, { id, form }).then((r) => {
      track(r.session);
      return r;
    });
  },
  saveCurrent: (id: string, resume: ResumeData, label?: string) => call<SessionView>('PUT', `/${id}/current`, { id, body: { resume, label } }).then(track),
  design: (id: string, patch: { template?: string; fontSize?: string; margins?: string; pageTarget?: 1 | 2; pageFormat?: string; sections?: Array<{ id: string; visible: boolean; title?: string }>; style?: Record<string, unknown> | null }) =>
    call<SessionView>('PATCH', `/${id}/design`, { id, body: patch }).then(track),
  versions: (id: string) => call<{ versions: VersionSummary[] }>('GET', `/${id}/versions`, { id }).then((r) => r.versions),
  version: (id: string, versionId: string) => call<VersionDetail & { ats: AtsResult | null }>('GET', `/${id}/versions/${versionId}`, { id }),
  compare: (id: string, from: string, to: string) => call<{ from: VersionSummary; to: VersionSummary; changes: ResumeChange[] }>('GET', `/${id}/compare?from=${from}&to=${to}`, { id }),
  restore: (id: string, versionId: string) => call<SessionView>('POST', `/${id}/restore/${versionId}`, { id }).then(track),
  undo: (id: string) => call<SessionView>('POST', `/${id}/undo`, { id }).then(track),
  redo: (id: string) => call<SessionView>('POST', `/${id}/redo`, { id }).then(track),
  recalculate: (id: string) => call<SessionView>('POST', `/${id}/ats-score/recalculate`, { id }).then(track),
  review: (id: string) => call<ReviewData>('GET', `/${id}/review`, { id }),
  finish: (id: string) => call<SessionView>('POST', `/${id}/finish`, { id }).then(track),
  reopen: (id: string) => call<SessionView>('POST', `/${id}/reopen`, { id }).then(track),
  download,
};
