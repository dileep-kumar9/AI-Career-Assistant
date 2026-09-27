import { assertPublicUrl } from '../services/fetchJob.js';

/**
 * Outbound HTTP for job sources and job pages.
 * Every hop (including redirects) must resolve to a public IP address
 * (no localhost / private / link-local / metadata addresses), responses are
 * size- and time-capped, and nothing fetched is ever executed.
 */

export class NetError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

export interface SafeResponse {
  url: string;
  status: number;
  contentType: string;
  text: string;
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

export async function safeFetch(
  raw: string,
  init: { method?: 'GET' | 'POST'; body?: string; headers?: Record<string, string> } = {},
  opts: { maxBytes?: number; timeoutMs?: number } = {},
): Promise<SafeResponse> {
  const maxBytes = opts.maxBytes ?? 5_000_000;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  let current = raw;
  let method = init.method || 'GET';
  let body = init.body;
  for (let hop = 0; hop < 5; hop++) {
    const url = await assertPublicUrl(current).catch((e) => {
      throw new NetError(e?.message || 'Blocked URL.', 400);
    });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        body,
        redirect: 'manual',
        signal: ctrl.signal,
        headers: { 'User-Agent': UA, 'Accept-Language': 'en', Accept: 'text/html,application/json;q=0.9,*/*;q=0.5', ...init.headers },
      });
    } catch (e: any) {
      clearTimeout(timer);
      throw new NetError(e?.name === 'AbortError' ? 'The site did not respond in time.' : 'Could not reach the site.', 504);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      clearTimeout(timer);
      current = new URL(res.headers.get('location')!, url).toString();
      if (res.status === 303) {
        method = 'GET';
        body = undefined;
      }
      continue;
    }
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > maxBytes) {
            ctrl.abort();
            break;
          }
          chunks.push(value);
        }
      }
    } catch {
      // aborted (size or time limit): use what arrived
    } finally {
      clearTimeout(timer);
    }
    return { url: url.toString(), status: res.status, contentType: res.headers.get('content-type') || '', text: Buffer.concat(chunks).toString('utf8') };
  }
  throw new NetError('Too many redirects.', 508);
}

export async function fetchJson<T = any>(url: string, init: Parameters<typeof safeFetch>[1] = {}, opts: Parameters<typeof safeFetch>[2] = {}): Promise<T> {
  const res = await safeFetch(url, { ...init, headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers } }, opts);
  if (res.status === 429) throw new NetError('The job board is rate-limiting requests; try again later.', 429);
  if (res.status >= 400) throw new NetError(`The job board returned HTTP ${res.status}.`, res.status);
  try {
    return JSON.parse(res.text) as T;
  } catch {
    throw new NetError('The job board returned an unexpected response.', 502);
  }
}
