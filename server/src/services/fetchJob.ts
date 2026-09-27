import dns from 'node:dns/promises';
import net from 'node:net';
import { badRequest, unprocessable } from '../errors.js';
import { sanitizeText } from './extract.js';

/**
 * Reads a job posting from a link the user pasted (LinkedIn, Naukri, Indeed,
 * company career pages, …).
 *
 * Safety: only http(s) on standard ports; every hostname — including each
 * redirect — must resolve to a public IP address (no localhost, private,
 * link-local or cloud-metadata addresses), responses are capped in size and
 * time, and only HTML/text is read. Nothing from the page is executed.
 *
 * Extraction: the schema.org JobPosting data most job boards embed for Google
 * Jobs is used when present; otherwise the visible page text around
 * "responsibilities / requirements / qualifications" is taken.
 */

export interface FetchedJob {
  url: string;
  title: string;
  company: string;
  text: string;
  method: 'structured' | 'page-text';
}

const MAX_BYTES = 2_500_000;
const TIMEOUT_MS = 12_000;

export function findUrls(text: string): string[] {
  return [...new Set((text.match(/https?:\/\/[^\s<>"'`)\]]+/gi) || []).map((u) => u.replace(/[.,;:!?]+$/, '')))];
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateIp(v6.slice(7));
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw badRequest('That link is not a valid web address.');
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw badRequest('Only normal http(s) job links are supported.');
  if (url.port && !['80', '443'].includes(url.port)) throw badRequest('Only job links on standard web ports are supported.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) throw badRequest('That link points to a private address.');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw badRequest('Could not find that website. Check the link.');
  if (addrs.some((a) => isPrivateIp(a.address))) throw badRequest('That link points to a private address.');
  return url;
}

async function download(raw: string): Promise<{ url: string; html: string }> {
  let current = raw;
  for (let hop = 0; hop < 4; hop++) {
    const url = await assertPublicUrl(current);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: 'manual',
        signal: ctrl.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ResumeCreatorAI/1.0; +job-description-import)',
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
          'Accept-Language': 'en',
        },
      });
    } catch {
      clearTimeout(timer);
      throw unprocessable('The job page did not respond. Please paste the job description text instead.');
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      clearTimeout(timer);
      current = new URL(res.headers.get('location')!, url).toString();
      continue;
    }
    if (!res.ok) {
      clearTimeout(timer);
      throw unprocessable(`The job page returned an error (${res.status}). Some sites (e.g. LinkedIn when signed out) block automatic reading — please paste the job description text instead.`);
    }
    const type = res.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml|text\/plain|application\/ld\+json|application\/json/i.test(type)) {
      clearTimeout(timer);
      throw unprocessable('That link is not a web page (it may be a PDF or image). Please paste the job description text instead.');
    }
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_BYTES) {
          ctrl.abort();
          break;
        }
        chunks.push(value);
      }
    }
    clearTimeout(timer);
    return { url: url.toString(), html: Buffer.concat(chunks).toString('utf8') };
  }
  throw unprocessable('The job link redirected too many times.');
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', bull: '•', hellip: '…' };
function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

export function htmlToText(html: string): string {
  return decode(
    html
      .replace(/<(script|style|noscript|svg|iframe|template)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article|\/ul|\/ol)[^>]*>/gi, '\n')
      .replace(/<li[^>]*>/gi, '\n- ')
      .replace(/<[^>]+>/g, ' '),
  )
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l && !/^[-•*|]+$/.test(l))
    .join('\n');
}

export function jobPostingFromJsonLd(html: string): { title: string; company: string; text: string } | null {
  const blocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of blocks) {
    const json = block.replace(/^<script[^>]*>|<\/script>$/gi, '');
    let data: any;
    try {
      data = JSON.parse(decode(json.trim()));
    } catch {
      continue;
    }
    const items: any[] = Array.isArray(data) ? data : data['@graph'] ? data['@graph'] : [data];
    const job = items.find((x) => x && (x['@type'] === 'JobPosting' || (Array.isArray(x['@type']) && x['@type'].includes('JobPosting'))));
    if (!job?.description) continue;
    const extra = [
      job.qualifications && `Qualifications: ${htmlToText(String(job.qualifications))}`,
      job.responsibilities && `Responsibilities: ${htmlToText(String(job.responsibilities))}`,
      job.skills && `Skills: ${Array.isArray(job.skills) ? job.skills.join(', ') : htmlToText(String(job.skills))}`,
      job.experienceRequirements && `Experience: ${typeof job.experienceRequirements === 'string' ? job.experienceRequirements : JSON.stringify(job.experienceRequirements)}`,
      job.educationRequirements && `Education: ${typeof job.educationRequirements === 'string' ? job.educationRequirements : job.educationRequirements?.credentialCategory || ''}`,
    ].filter(Boolean);
    const company = typeof job.hiringOrganization === 'string' ? job.hiringOrganization : job.hiringOrganization?.name || '';
    return { title: String(job.title || ''), company: String(company), text: [job.title, company && `Company: ${company}`, htmlToText(String(job.description)), ...extra].filter(Boolean).join('\n') };
  }
  return null;
}

const JD_MARKERS = /\b(job description|responsibilit|requirements?|qualifications?|what you('|’)ll do|about the role|role overview|key skills|skills required|must have|experience required|who you are|preferred)\b/i;

export function jobFromPageText(html: string): { title: string; text: string } {
  const title = decode((html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i) || html.match(/<title[^>]*>([^<]+)/i) || [])[1] || '').trim();
  const lines = htmlToText(html).split('\n');
  const first = lines.findIndex((l) => JD_MARKERS.test(l));
  const start = first < 0 ? 0 : Math.max(0, first - 12);
  // Stop where the application form / site footer begins.
  const stopAt = lines.findIndex((l, i) => i > start + 5 && /^(apply for this job|submit (your )?application|first name\b|create a job alert|similar jobs|share this job|©)/i.test(l));
  const text = lines.slice(start, stopAt > start ? Math.min(stopAt, start + 220) : start + 220).join('\n');
  return { title, text };
}

export async function fetchJobPosting(rawUrl: string): Promise<FetchedJob> {
  const { url, html } = await download(rawUrl);
  const structured = jobPostingFromJsonLd(html);
  if (structured && structured.text.length > 200) {
    return { url, title: structured.title, company: structured.company, text: sanitizeText(structured.text, 30_000), method: 'structured' };
  }
  const page = jobFromPageText(html);
  const markers = (page.text.match(new RegExp(JD_MARKERS.source, 'gi')) || []).length;
  if (page.text.length < 300 || markers === 0 || /\b(sign in|log in|join now) to (view|see|apply)\b/i.test(page.text.slice(0, 600))) {
    throw unprocessable('I could not read a job description from that page (the site may need a sign-in or loads the job with JavaScript). Please copy the job description text and paste it here.');
  }
  return { url, title: page.title, company: '', text: sanitizeText(`${page.title}\n${page.text}`, 30_000), method: 'page-text' };
}
