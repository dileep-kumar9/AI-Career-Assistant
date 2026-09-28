import { htmlToText } from '../../services/fetchJob.js';
import { sanitizeText } from '../../services/extract.js';
import { fetchJson, safeFetch } from '../net.js';
import { linkedinLevels } from '../../../../shared/experience.js';
import { type JobPosting, type JobSource, type SearchQuery, looksRemote, matchesKeywords, matchesLocation, withinDays } from './types.js';

/**
 * Job sources with public, no-login APIs. Each returns postings that match
 * the query keywords (title first, then description) and location.
 */

const decodeEntities = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

export const htmlDescription = (html: string) => sanitizeText(htmlToText(decodeEntities(html || '')), 30_000);

/** "palantir" / "ramp-network" → "Palantir" / "Ramp Network" (board slugs used as company names). */
export const prettyCompany = (s: string) => (/[A-Z]/.test(s) ? s : s.replace(/[-_]+/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase()));

const slug = (s: string) => s.trim().replace(/^https?:\/\/[^/]+\//, '').replace(/[/?#].*$/, '').replace(/[^A-Za-z0-9_.-]/g, '');

function keep(p: JobPosting, q: SearchQuery): boolean {
  const hay = `${p.title}\n${p.description.slice(0, 4000)}`;
  const byTitle = matchesKeywords(p.title, q.keywords);
  const bySkills = q.skills.length > 0 && matchesKeywords(p.title, q.skills.slice(0, 15));
  return (byTitle || bySkills || (q.keywords.length === 0 && matchesKeywords(hay, q.skills))) && matchesLocation(p, q.locations, q.remoteOk) && withinDays(p.postedAt, q.postedWithinDays);
}

// ------------------------------------------------------------------ Greenhouse

export function greenhousePosting(board: string, j: any): JobPosting {
  const location = String(j.location?.name || '');
  const description = htmlDescription(String(j.content || ''));
  return {
    source: 'greenhouse',
    externalId: `${board}/${j.id}`,
    title: String(j.title || '').trim(),
    company: String(j.company_name || prettyCompany(board)),
    location,
    remote: looksRemote(location, String(j.title || '')),
    description,
    jobUrl: String(j.absolute_url || `https://job-boards.greenhouse.io/${board}/jobs/${j.id}`),
    // The hosted board form works for every Greenhouse company, even when absolute_url is a custom careers site.
    applyUrl: `https://job-boards.greenhouse.io/${board}/jobs/${j.id}`,
    postedAt: j.first_published || j.updated_at || null,
  };
}

export const greenhouse: JobSource = {
  id: 'greenhouse',
  browser: false,
  async search(q, cfg: { boards: string[] }, signal) {
    const out: JobPosting[] = [];
    for (const raw of cfg.boards.slice(0, 40)) {
      if (signal.stopped()) break;
      const board = slug(raw).toLowerCase();
      if (!board) continue;
      const data = await fetchJson<{ jobs: any[] }>(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`, {}, { maxBytes: 15_000_000, timeoutMs: 25_000 });
      for (const j of data.jobs || []) {
        const p = greenhousePosting(board, j);
        if (keep(p, q)) out.push(p);
      }
    }
    return out;
  },
};

// ------------------------------------------------------------------ Lever

export function leverPosting(company: string, j: any): JobPosting {
  const lists = (j.lists || []).map((l: any) => `${l.text}\n${htmlToText(String(l.content || ''))}`).join('\n');
  const location = String(j.categories?.location || (j.categories?.allLocations || []).join(', ') || '');
  return {
    source: 'lever',
    externalId: `${company}/${j.id}`,
    title: String(j.text || '').trim(),
    company: prettyCompany(company),
    location,
    remote: j.workplaceType === 'remote' || looksRemote(location),
    description: sanitizeText([j.openingPlain, j.descriptionPlain || j.descriptionBodyPlain, lists, j.additionalPlain].filter(Boolean).join('\n\n'), 30_000),
    jobUrl: String(j.hostedUrl || `https://jobs.lever.co/${company}/${j.id}`),
    applyUrl: String(j.applyUrl || `https://jobs.lever.co/${company}/${j.id}/apply`),
    postedAt: j.createdAt ? new Date(Number(j.createdAt)).toISOString() : null,
  };
}

export const lever: JobSource = {
  id: 'lever',
  browser: false,
  async search(q, cfg: { companies: string[] }, signal) {
    const out: JobPosting[] = [];
    for (const raw of cfg.companies.slice(0, 40)) {
      if (signal.stopped()) break;
      const company = slug(raw).toLowerCase();
      if (!company) continue;
      const data = await fetchJson<any[]>(`https://api.lever.co/v0/postings/${encodeURIComponent(company)}?mode=json`, {}, { maxBytes: 15_000_000, timeoutMs: 25_000 });
      for (const j of Array.isArray(data) ? data : []) {
        const p = leverPosting(company, j);
        if (keep(p, q)) out.push(p);
      }
    }
    return out;
  },
};

// ------------------------------------------------------------------ Ashby

export function ashbyPosting(org: string, j: any): JobPosting {
  const location = [j.location, ...(j.secondaryLocations || []).map((l: any) => l.location)].filter(Boolean).join('; ');
  return {
    source: 'ashby',
    externalId: `${org}/${j.id}`,
    title: String(j.title || '').trim(),
    company: prettyCompany(org),
    location,
    remote: !!j.isRemote || j.workplaceType === 'Remote' || looksRemote(location),
    description: sanitizeText(String(j.descriptionPlain || htmlToText(String(j.descriptionHtml || ''))), 30_000),
    jobUrl: String(j.jobUrl || `https://jobs.ashbyhq.com/${org}/${j.id}`),
    applyUrl: String(j.applyUrl || `https://jobs.ashbyhq.com/${org}/${j.id}/application`),
    postedAt: j.publishedAt || null,
  };
}

export const ashby: JobSource = {
  id: 'ashby',
  browser: false,
  async search(q, cfg: { orgs: string[] }, signal) {
    const out: JobPosting[] = [];
    for (const raw of cfg.orgs.slice(0, 40)) {
      if (signal.stopped()) break;
      const org = slug(raw);
      if (!org) continue;
      const data = await fetchJson<{ jobs: any[] }>(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(org)}`, {}, { maxBytes: 15_000_000, timeoutMs: 25_000 });
      for (const j of data.jobs || []) {
        if (j.isListed === false) continue;
        const p = ashbyPosting(org, j);
        if (keep(p, q)) out.push(p);
      }
    }
    return out;
  },
};

// ------------------------------------------------------------------ Workday (search only; applying is assisted)

/** "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite" → parts for the CXS API. */
export function workdaySite(raw: string): { origin: string; tenant: string; site: string } | null {
  try {
    const u = new URL(/^https?:/i.test(raw) ? raw : `https://${raw}`);
    if (!/\.myworkdayjobs\.com$|\.myworkdaysite\.com$/i.test(u.hostname)) return null;
    const tenant = u.hostname.split('.')[0];
    const parts = u.pathname.split('/').filter(Boolean).filter((p) => !/^[a-z]{2}-[A-Z]{2}$/.test(p));
    const site = parts[0] === 'recruiting' ? parts[2] : parts[0];
    return site ? { origin: u.origin, tenant, site } : null;
  } catch {
    return null;
  }
}

export async function workdayDetail(origin: string, tenant: string, site: string, externalPath: string): Promise<JobPosting | null> {
  const data = await fetchJson<any>(`${origin}/wday/cxs/${tenant}/${site}${externalPath}`, {}, { timeoutMs: 20_000 });
  const p = data?.jobPostingInfo;
  if (!p) return null;
  const url = String(p.externalUrl || `${origin}/${site}${externalPath}`);
  return {
    source: 'workday',
    externalId: `${tenant}/${p.jobReqId || p.id || externalPath}`,
    title: String(p.title || '').trim(),
    // Workday legal-entity names carry codes: "2100 NVIDIA USA", "CA01 NVIDIA Canada Dev. Inc."
    company: String(data.hiringOrganization?.name || prettyCompany(tenant)).replace(/^[A-Z]{0,3}\d{2,5}\s+/, ''),
    location: String(p.location || ''),
    remote: looksRemote(String(p.location || ''), String(p.remoteType || '')),
    description: htmlDescription(String(p.jobDescription || '')),
    jobUrl: url,
    applyUrl: `${url.replace(/\/$/, '')}/apply`,
    postedAt: p.startDate ? new Date(p.startDate).toISOString() : null,
  };
}

export const workday: JobSource = {
  id: 'workday',
  browser: false,
  async search(q, cfg: { sites: string[] }, signal) {
    const out: JobPosting[] = [];
    const terms = (q.keywords.length ? q.keywords : q.skills).slice(0, 3);
    for (const raw of cfg.sites.slice(0, 15)) {
      const site = workdaySite(raw);
      if (!site) continue;
      for (const term of terms.length ? terms : ['']) {
        if (signal.stopped()) return out;
        const list = await fetchJson<{ jobPostings?: any[] }>(`${site.origin}/wday/cxs/${site.tenant}/${site.site}/jobs`, { method: 'POST', body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: term }) }, { timeoutMs: 20_000 });
        for (const j of (list.jobPostings || []).slice(0, 10)) {
          if (signal.stopped()) return out;
          if (!j.externalPath || out.some((x) => x.jobUrl.endsWith(j.externalPath))) continue;
          const days = /(\d+)\+? days? ago/i.exec(String(j.postedOn || ''));
          if (days && q.postedWithinDays && Number(days[1]) > q.postedWithinDays) continue;
          const detail = await workdayDetail(site.origin, site.tenant, site.site, j.externalPath).catch(() => null);
          if (detail && matchesLocation(detail, q.locations, q.remoteOk)) out.push(detail);
        }
      }
    }
    return out;
  },
};

// ------------------------------------------------------------------ Arbeitnow

export function arbeitnowPosting(j: any): JobPosting {
  return {
    source: 'arbeitnow',
    externalId: String(j.slug),
    title: String(j.title || '').trim(),
    company: String(j.company_name || ''),
    location: String(j.location || ''),
    remote: !!j.remote,
    description: htmlDescription(String(j.description || '')),
    jobUrl: String(j.url),
    applyUrl: String(j.url),
    postedAt: j.created_at ? new Date(Number(j.created_at) * 1000).toISOString() : null,
  };
}

export const arbeitnow: JobSource = {
  id: 'arbeitnow',
  browser: false,
  async search(q, _cfg, signal) {
    const out: JobPosting[] = [];
    let url: string | null = 'https://www.arbeitnow.com/api/job-board-api';
    for (let page = 0; url && page < 5 && !signal.stopped(); page++) {
      const data: { data: any[]; links?: { next?: string | null } } = await fetchJson(url, {}, { maxBytes: 10_000_000, timeoutMs: 25_000 });
      for (const j of data.data || []) {
        const p = arbeitnowPosting(j);
        if (keep(p, q)) out.push(p);
      }
      url = data.links?.next || null;
    }
    return out;
  },
};

// ------------------------------------------------------------------ Remote OK (attribution: jobs link back to remoteok.com)

export function remoteokPosting(j: any): JobPosting {
  return {
    source: 'remoteok',
    externalId: String(j.id),
    title: String(j.position || '').trim(),
    company: String(j.company || ''),
    location: String(j.location || 'Remote'),
    remote: true,
    description: htmlDescription(String(j.description || '')),
    jobUrl: String(j.url || `https://remoteok.com/remote-jobs/${j.id}`),
    applyUrl: String(j.apply_url || j.url || ''),
    postedAt: j.date || null,
  };
}

export const remoteok: JobSource = {
  id: 'remoteok',
  browser: false,
  async search(q) {
    const data = await fetchJson<any[]>('https://remoteok.com/api', {}, { maxBytes: 15_000_000, timeoutMs: 25_000 });
    return (Array.isArray(data) ? data : [])
      .filter((j) => j && j.id && j.position)
      .map(remoteokPosting)
      .filter((p) => keep({ ...p, location: p.location }, { ...q, locations: q.remoteOk ? [] : q.locations }));
  },
};

// ------------------------------------------------------------------ LinkedIn (public, logged-out job search — never touches your account)

const LI_CARD = /data-entity-urn="urn:li:jobPosting:(\d+)"[\s\S]*?<h3[^>]*base-search-card__title[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<h4[^>]*base-search-card__subtitle[^>]*>([\s\S]*?)<\/h4>[\s\S]*?job-search-card__location[^>]*>([\s\S]*?)<\/span>(?:[\s\S]*?<time[^>]*datetime="([^"]+)")?/g;

export function parseLinkedInSearch(html: string): JobPosting[] {
  const out: JobPosting[] = [];
  for (const m of html.matchAll(LI_CARD)) {
    const text = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    const id = m[1];
    const location = text(m[4]);
    out.push({
      source: 'linkedin',
      externalId: id,
      title: text(m[2]),
      company: text(m[3]),
      location,
      remote: looksRemote(location),
      description: '',
      jobUrl: `https://www.linkedin.com/jobs/view/${id}/`,
      applyUrl: `https://www.linkedin.com/jobs/view/${id}/`,
      postedAt: m[5] ? new Date(m[5]).toISOString() : null,
      needsBrowser: true,
    });
  }
  return out;
}

/** Reads one LinkedIn job from the public job page (no login). */
export async function linkedinPosting(id: string): Promise<JobPosting | null> {
  const res = await safeFetch(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${encodeURIComponent(id)}`, {}, { timeoutMs: 20_000 });
  if (res.status >= 400 || !res.text) return null;
  return parseLinkedInPosting(id, res.text);
}

export function parseLinkedInPosting(id: string, html: string): JobPosting | null {
  const text = (s: string | undefined) => (s ? decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() : '');
  const title = text(html.match(/topcard__title[^>]*>([\s\S]*?)<\/h[12]>/)?.[1]);
  if (!title) return null;
  const company = text(html.match(/topcard__org-name-link[^>]*>([\s\S]*?)<\/a>/)?.[1]);
  const location = text(html.match(/topcard__flavor topcard__flavor--bullet[^>]*>([\s\S]*?)<\/span>/)?.[1]);
  const body = html.match(/show-more-less-html__markup[^>]*>([\s\S]*?)<\/div>/)?.[1] || '';
  const criteria = [...html.matchAll(/description__job-criteria-subheader[^>]*>([\s\S]*?)<\/h3>[\s\S]*?description__job-criteria-text[^>]*>([\s\S]*?)<\/span>/g)].map((c) => `${text(c[1])}: ${text(c[2])}`);
  return {
    source: 'linkedin',
    externalId: id,
    title,
    company,
    location,
    remote: looksRemote(location, title),
    description: sanitizeText(`${htmlToText(decodeEntities(body))}\n${criteria.join('\n')}`, 30_000),
    jobUrl: `https://www.linkedin.com/jobs/view/${id}/`,
    applyUrl: `https://www.linkedin.com/jobs/view/${id}/`,
    postedAt: null,
    needsBrowser: true,
    // Logged out, LinkedIn marks "apply on company site" jobs with an off-site icon; the rest are Easy Apply.
    easyApply: !/offsite-apply-icon/.test(html),
  };
}

export const linkedin: JobSource = {
  id: 'linkedin',
  browser: false,
  async search(q, _cfg, signal) {
    const out: JobPosting[] = [];
    const tpr = q.postedWithinDays ? `&f_TPR=r${q.postedWithinDays * 86400}` : '';
    const levels = linkedinLevels(q.experience ?? null);
    const locs = q.locations.length ? q.locations.slice(0, 2) : [''];
    for (const kw of q.keywords.slice(0, 3)) {
      for (const loc of locs) {
        if (signal.stopped()) return out;
        const url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(kw)}&location=${encodeURIComponent(loc)}&f_AL=true${tpr}${levels ? `&f_E=${encodeURIComponent(levels)}` : ''}&start=0`;
        const res = await safeFetch(url, {}, { timeoutMs: 20_000 });
        if (res.status === 429) throw new Error('LinkedIn is rate-limiting job searches; try again later.');
        if (res.status < 400) for (const p of parseLinkedInSearch(res.text)) if (!out.some((x) => x.externalId === p.externalId) && matchesLocation(p, q.locations, q.remoteOk)) out.push(p);
        await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1500));
      }
    }
    return out;
  },
};

export const API_SOURCES = { greenhouse, lever, ashby, workday, arbeitnow, remoteok, linkedin };
