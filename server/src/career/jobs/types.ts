import type { JobSourceId } from '../../../../shared/careerTypes.js';
import { hashOf } from '../context.js';

/** A job as found by a source or read from a link, before it becomes an application. */
export interface JobPosting {
  source: JobSourceId;
  externalId: string;
  title: string;
  company: string;
  location: string;
  remote: boolean;
  /** Plain-text description (may be empty for search results; read later). */
  description: string;
  jobUrl: string;
  applyUrl: string;
  postedAt: string | null;
  /** Portal jobs that must be read/applied through the logged-in browser. */
  needsBrowser?: boolean;
  /** LinkedIn only: Easy Apply (true) or apply on the company's site (false). */
  easyApply?: boolean;
}

export interface SearchQuery {
  /** Role / keyword phrases, e.g. ["SOC Analyst", "Security Analyst"]. */
  keywords: string[];
  /** Skills used to widen matching on boards that return every job. */
  skills: string[];
  locations: string[];
  remoteOk: boolean;
  postedWithinDays: number;
}

export interface JobSource {
  id: JobSourceId;
  /** Browser-based sources need the automation browser (and usually a login). */
  browser: boolean;
  search(q: SearchQuery, config: unknown, signal: { stopped: () => boolean }): Promise<JobPosting[]>;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|limited|pvt|private|corp|corporation|gmbh|co)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Same job = same source id; also the same company + title (cross-posted jobs). */
export function dedupeKeys(p: Pick<JobPosting, 'source' | 'externalId' | 'company' | 'title'>): { primary: string; fuzzy: string } {
  return {
    primary: `${p.source}:${hashOf(p.externalId || '')}`,
    fuzzy: `ct:${hashOf(`${norm(p.company)}|${norm(p.title)}`)}`,
  };
}

/** Does the posting text mention one of the keyword phrases (all words, any order)? */
export function matchesKeywords(text: string, keywords: string[]): boolean {
  if (!keywords.length) return true;
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9+#.]+/g, ' ')} `;
  return keywords.some((k) => {
    const words = k.toLowerCase().split(/[^a-z0-9+#.]+/).filter((w) => w.length > 1);
    return words.length > 0 && words.every((w) => t.includes(` ${w} `) || t.includes(` ${w}s `));
  });
}

export function matchesLocation(p: Pick<JobPosting, 'location' | 'remote'>, locations: string[], remoteOk: boolean): boolean {
  if (p.remote && remoteOk) return true;
  if (!locations.length) return true;
  const loc = p.location.toLowerCase();
  if (!loc) return remoteOk;
  return locations.some((l) => {
    const want = l.toLowerCase().trim();
    if (want === 'remote') return p.remote || /remote|anywhere/.test(loc);
    return want.length > 1 && loc.includes(want);
  });
}

export function withinDays(postedAt: string | null, days: number): boolean {
  if (!postedAt || !days) return true;
  const t = Date.parse(postedAt);
  return Number.isNaN(t) ? true : Date.now() - t <= days * 86_400_000;
}

export const looksRemote = (...parts: string[]) => /\bremote\b|\bwork from home\b|\bwfh\b|\banywhere\b/i.test(parts.join(' '));
