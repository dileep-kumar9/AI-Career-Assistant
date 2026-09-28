import { fetchJobPosting, htmlToText, jobFromPageText, jobPostingFromJsonLd } from '../../services/fetchJob.js';
import { sanitizeText } from '../../services/extract.js';
import { badRequest, unprocessable } from '../../errors.js';
import { fetchJson, safeFetch } from '../net.js';
import { ashbyPosting, greenhousePosting, leverPosting, linkedinPosting, workdayDetail, workdaySite } from './apiSources.js';
import { type JobPosting, looksRemote } from './types.js';

/**
 * Reads one job from a link: ATS job boards through their public APIs
 * (complete, structured JD), LinkedIn through its public job page, anything
 * else through schema.org JobPosting data or the page text — and, for pages
 * that need a login or JavaScript (Naukri, Indeed, …), through the automation
 * browser when it is available.
 */

export type BrowserPageReader = (url: string) => Promise<{ url: string; html: string; text: string } | null>;

export function parseJobUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw badRequest('That is not a valid link. Paste the full job URL (starting with https://).');
  }
  if (!/^https?:$/.test(url.protocol)) throw badRequest('Only http(s) job links are supported.');
  return url;
}

/** Which site a link belongs to (used to pick the reader and the applier). */
export function siteOf(url: URL): 'greenhouse' | 'lever' | 'ashby' | 'workday' | 'linkedin' | 'naukri' | 'indeed' | 'other' {
  const h = url.hostname.toLowerCase();
  if (/(^|\.)greenhouse\.io$/.test(h) || url.searchParams.has('gh_jid')) return 'greenhouse';
  if (/(^|\.)lever\.co$/.test(h)) return 'lever';
  if (/(^|\.)ashbyhq\.com$/.test(h)) return 'ashby';
  if (/myworkdayjobs\.com$|myworkdaysite\.com$/.test(h)) return 'workday';
  if (/(^|\.)linkedin\.com$/.test(h)) return 'linkedin';
  if (/(^|\.)naukri\.com$/.test(h)) return 'naukri';
  if (/(^|\.)indeed\.[a-z.]+$/.test(h)) return 'indeed';
  return 'other';
}

export function greenhouseIds(url: URL, html = ''): { board: string; id: string } | null {
  const m = url.pathname.match(/^\/(?:embed\/job_app\?for=)?([^/]+)\/jobs\/(\d+)/);
  if (/greenhouse\.io$/i.test(url.hostname) && m) return { board: m[1].toLowerCase(), id: m[2] };
  const forParam = url.searchParams.get('for');
  const token = url.searchParams.get('token') || url.searchParams.get('gh_jid');
  if (forParam && token) return { board: forParam.toLowerCase(), id: token };
  // Company careers page embedding a Greenhouse board: …?gh_jid=123 + "…greenhouse.io/embed/job_board/js?for=acme"
  const embed = html.match(/greenhouse\.io\/embed\/job_(?:board|app)(?:\/js)?\?for=([A-Za-z0-9_-]+)/) || html.match(/(?:job-)?boards(?:-api)?\.greenhouse\.io\/(?:v1\/boards\/)?([A-Za-z0-9_-]+)\/jobs/);
  if (token && embed) return { board: embed[1].toLowerCase(), id: token };
  return null;
}

async function readGreenhouse(url: URL): Promise<JobPosting | null> {
  let ids = greenhouseIds(url);
  if (!ids && url.searchParams.has('gh_jid')) {
    const page = await safeFetch(url.toString(), {}, { timeoutMs: 15_000 }).catch(() => null);
    ids = greenhouseIds(url, page?.text || '');
    // Most companies use their own name as the board token (stripe.com → "stripe").
    if (!ids) {
      const guess = url.hostname.replace(/^www\./, '').split('.').slice(-2, -1)[0];
      if (guess) ids = { board: guess.toLowerCase(), id: url.searchParams.get('gh_jid')! };
    }
  }
  if (!ids) return null;
  const j = await fetchJson<any>(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(ids.board)}/jobs/${ids.id}`);
  return greenhousePosting(ids.board, j);
}

async function readLever(url: URL): Promise<JobPosting | null> {
  const m = url.pathname.match(/^\/([^/]+)\/([0-9a-f-]{36})/i);
  if (!m) return null;
  const j = await fetchJson<any>(`https://api.lever.co/v0/postings/${encodeURIComponent(m[1])}/${m[2]}`);
  return leverPosting(m[1].toLowerCase(), j);
}

async function readAshby(url: URL): Promise<JobPosting | null> {
  const m = url.pathname.match(/^\/([^/]+)\/([0-9a-f-]{36})/i);
  if (!m) return null;
  const data = await fetchJson<{ jobs: any[] }>(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(m[1])}`, {}, { maxBytes: 15_000_000 });
  const j = (data.jobs || []).find((x) => String(x.id).toLowerCase() === m[2].toLowerCase());
  return j ? ashbyPosting(m[1], j) : null;
}

async function readWorkday(url: URL): Promise<JobPosting | null> {
  const site = workdaySite(url.toString());
  const i = url.pathname.indexOf('/job/');
  if (!site || i < 0) return null;
  return workdayDetail(site.origin, site.tenant, site.site, url.pathname.slice(i).replace(/\/apply.*$/, ''));
}

export function linkedinJobId(url: URL): string | null {
  return url.searchParams.get('currentJobId') || url.pathname.match(/\/jobs\/view\/(?:[^/]*?-)?(\d{6,})/)?.[1] || null;
}

function fromHtml(pageUrl: string, html: string, text?: string): JobPosting | null {
  const structured = jobPostingFromJsonLd(html);
  const body = structured?.text && structured.text.length > 200 ? structured.text : jobFromPageText(html).text || text || htmlToText(html);
  if (!body || body.length < 200) return null;
  const title = structured?.title || jobFromPageText(html).title || '';
  const u = new URL(pageUrl);
  return {
    source: 'link',
    externalId: `${u.hostname}${u.pathname}`.slice(0, 300),
    title: title.replace(/\s*[|–-]\s*(LinkedIn|Indeed|Naukri(\.com)?|Glassdoor).*$/i, '').trim(),
    company: structured?.company || '',
    location: '',
    remote: looksRemote(body.slice(0, 3000)),
    description: sanitizeText(body, 30_000),
    jobUrl: pageUrl,
    applyUrl: pageUrl,
    postedAt: null,
  };
}

// ------------------------------------------------------------------ forms and third-party pages

export const isGoogleForm = (u: URL) => (u.hostname === 'docs.google.com' && u.pathname.startsWith('/forms')) || u.hostname === 'forms.gle';
export const isMicrosoftForm = (u: URL) => /(^|\.)forms\.(office|microsoft)\.com$/.test(u.hostname);

const APPLY_HOSTS: Array<[RegExp, number]> = [
  [/(^|\.)greenhouse\.io$/, 10],
  [/(^|\.)lever\.co$/, 10],
  [/(^|\.)ashbyhq\.com$/, 10],
  [/myworkdayjobs\.com$|myworkdaysite\.com$/, 9],
  [/^docs\.google\.com$|^forms\.gle$/, 9],
  [/forms\.(office|microsoft)\.com$/, 9],
  [/(^|\.)(smartrecruiters|icims|taleo|jobvite|workable|recruitee|breezy|bamboohr|teamtailor|zohorecruit|freshteam|keka|darwinbox|successfactors|oraclecloud|personio|jazzhr|applytojob)\.(com|io|net|hr)$/, 8],
];

/**
 * Where to actually apply from a page that is not itself an application
 * form: links / iframes to known applicant-tracking systems or Google /
 * Microsoft Forms, or an "Apply" link to another site.
 */
export function findApplyTarget(html: string, pageUrl: string): string | null {
  const base = new URL(pageUrl);
  const found: Array<{ url: string; score: number }> = [];
  const push = (href: string, text: string) => {
    let u: URL;
    try {
      u = new URL(href.replace(/&amp;/g, '&'), base);
    } catch {
      return;
    }
    if (!/^https?:$/.test(u.protocol)) return;
    if (isGoogleForm(u) && !/\/(viewform|formResponse)|^\/e\//.test(u.pathname) && u.hostname !== 'forms.gle') return;
    const host = APPLY_HOSTS.find(([re]) => re.test(u.hostname));
    let score = host ? host[1] : 0;
    if (/\bapply\b|application|register|submit your (cv|resume)/i.test(text)) score += host ? 2 : 5;
    if (u.hostname === base.hostname && !host) score -= 3;
    if (score > 4) found.push({ url: u.toString(), score });
  };
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) push(m[1], m[2].replace(/<[^>]+>/g, ' '));
  for (const m of html.matchAll(/<iframe\b[^>]*src=["']([^"']+)["']/gi)) push(m[1], 'apply');
  found.sort((a, b) => b.score - a.score);
  return found[0]?.url || null;
}

/** Google Form → title, description and question titles (the text a form shows before you answer). */
export function parseGoogleForm(html: string, pageUrl: string): JobPosting | null {
  const meta = (p: string) => decodeHtml(html.match(new RegExp(`<meta[^>]+property=["']og:${p}["'][^>]+content=["']([^"']*)`, 'i'))?.[1] || '');
  const title = meta('title') || decodeHtml(html.match(/<title[^>]*>([^<]*)/i)?.[1] || '');
  const description = meta('description');
  const questions: string[] = [];
  const data = html.match(/FB_PUBLIC_LOAD_DATA_\s*=\s*(\[[\s\S]*?\]);\s*<\/script>/);
  if (data) {
    try {
      const parsed = JSON.parse(data[1]);
      const formDescription = typeof parsed?.[1]?.[0] === 'string' ? parsed[1][0] : '';
      for (const item of parsed?.[1]?.[1] || []) if (typeof item?.[1] === 'string' && item[1].trim()) questions.push(item[1].trim());
      if (formDescription && !description.includes(formDescription.slice(0, 40))) questions.unshift(formDescription);
    } catch {
      /* page text only */
    }
  }
  if (!title && !description) return null;
  const text = [title, description, questions.length ? `Questions in the form:\n${questions.map((q) => `- ${q}`).join('\n')}` : ''].filter(Boolean).join('\n\n');
  return { source: 'link', externalId: pageUrl.slice(0, 300), title: title.replace(/\s*-\s*Google Forms?$/i, '').trim(), company: '', location: '', remote: looksRemote(text), description: sanitizeText(text, 30_000), jobUrl: pageUrl, applyUrl: pageUrl, postedAt: null };
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

/** Reads a job link. Throws a friendly 4xx error when no job description can be found. */
export async function readJobLink(raw: string, browserRead?: BrowserPageReader, depth = 0): Promise<JobPosting> {
  const url = parseJobUrl(raw);
  const site = siteOf(url);
  // Google Forms: the form itself is the job (title, description, questions).
  if (isGoogleForm(url)) {
    const res = await safeFetch(url.toString(), {}, { timeoutMs: 20_000 }).catch(() => null);
    const form = res && res.status < 400 ? parseGoogleForm(res.text, res.url) : null;
    if (form) return form;
    throw unprocessable('Could not read that Google Form (it may need a sign-in). Open it in the automation browser or paste the job description.');
  }
  // Microsoft Forms render with JavaScript: read them in the browser.
  if (isMicrosoftForm(url)) {
    const page = browserRead ? await browserRead(url.toString()).catch(() => null) : null;
    if (page && page.text.trim().length > 40) {
      const lines = page.text.split('\n').map((l) => l.trim()).filter(Boolean);
      return { source: 'link', externalId: url.toString().slice(0, 300), title: lines[0]?.slice(0, 200) || 'Application form', company: '', location: '', remote: looksRemote(page.text), description: sanitizeText(page.text, 30_000), jobUrl: url.toString(), applyUrl: url.toString(), postedAt: null };
    }
    throw unprocessable('Could not read that Microsoft Form (it needs the automation browser, and may need a sign-in).');
  }
  let posting: JobPosting | null = null;
  try {
    if (site === 'greenhouse') posting = await readGreenhouse(url);
    else if (site === 'lever') posting = await readLever(url);
    else if (site === 'ashby') posting = await readAshby(url);
    else if (site === 'workday') posting = await readWorkday(url);
    else if (site === 'linkedin') {
      const id = linkedinJobId(url);
      if (id) posting = await linkedinPosting(id);
    }
  } catch {
    posting = null; // fall through to the generic readers
  }
  if (posting && posting.description.length > 100) return posting;

  if (site !== 'naukri' && site !== 'indeed') {
    // Third-party page: where do you actually apply (ATS link, Google/Microsoft Form, "Apply" link)?
    const page = site === 'other' ? await safeFetch(url.toString(), {}, { timeoutMs: 20_000 }).catch(() => null) : null;
    const target = page && page.status < 400 ? findApplyTarget(page.text, page.url) : null;
    try {
      const job = await fetchJobPosting(url.toString());
      return {
        source: 'link',
        externalId: `${url.hostname}${url.pathname}`.slice(0, 300),
        title: job.title.replace(/\s*[|–-]\s*(LinkedIn|Indeed|Naukri(\.com)?|Glassdoor).*$/i, '').trim(),
        company: job.company,
        location: '',
        remote: looksRemote(job.text.slice(0, 3000)),
        description: job.text,
        jobUrl: job.url,
        applyUrl: target || job.url,
        postedAt: null,
      };
    } catch {
      // No job description on this page: follow the apply target once (e.g. a post linking to a Google Form).
      if (target && depth === 0) {
        const inner = await readJobLink(target, browserRead, 1).catch(() => null);
        if (inner) return { ...inner, jobUrl: url.toString() };
      }
    }
  }
  if (browserRead) {
    const page = await browserRead(url.toString()).catch(() => null);
    const fromPage = page ? fromHtml(page.url, page.html, page.text) : null;
    if (fromPage) return { ...fromPage, source: site === 'naukri' || site === 'indeed' ? site : 'link', needsBrowser: site === 'naukri' || site === 'indeed' };
  }
  throw unprocessable(
    site === 'naukri' || site === 'indeed'
      ? `This ${site === 'naukri' ? 'Naukri' : 'Indeed'} page needs the automation browser. Open Settings → Automation browser, log in once, then try again — or paste the job description text.`
      : 'I could not read a job description from that page (it may need a sign-in or load the job with JavaScript). Paste the job description text instead.',
  );
}
