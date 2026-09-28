import type { BrowserManager } from '../automation/browser.js';
import { type JobPosting, type SearchQuery, looksRemote, matchesLocation } from './types.js';

/**
 * Portal searches that only work in a real, logged-in browser (Naukri, Indeed).
 * They read the search-result cards; each job's description is read later
 * from its own page. Selectors are best-effort: portals change their markup,
 * and when nothing can be read the source reports it instead of failing silently.
 */

const kebab = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

interface Card {
  href: string;
  title: string;
  company: string;
  location: string;
  experience?: string;
}

// Plain JavaScript run in the page (string so build tools never rewrite it).
const NAUKRI_CARDS = `(() => {
  const out = [];
  const links = document.querySelectorAll('a[href*="job-listings-"]');
  for (const a of links) {
    const card = a.closest('.srp-jobtuple-wrapper, article, .jobTuple, .cust-job-tuple, li, div[class*="tuple"]') || a.parentElement;
    const pick = (sel) => { const n = card && card.querySelector(sel); return n ? (n.innerText || n.textContent || '').trim() : ''; };
    out.push({ href: a.href, title: (a.getAttribute('title') || a.innerText || '').trim(), company: pick('a.comp-name, .comp-name, .subTitle, [class*="comp-name"]'), location: pick('.locWdth, .loc, [class*="location"], .ni-job-tuple-icon-srp-location'), experience: pick('.expwdth, .exp-wrap, [class*="exp-wrap"], .exp, .experience') });
  }
  return out;
})()`;

const INDEED_CARDS = `(() => {
  const out = [];
  for (const a of document.querySelectorAll('a[data-jk], a.jcs-JobTitle')) {
    const jk = a.getAttribute('data-jk') || (a.href.match(/jk=([a-z0-9]+)/i) || [])[1];
    if (!jk) continue;
    const card = a.closest('.job_seen_beacon, .result, li, td') || a.parentElement;
    const pick = (sel) => { const n = card && card.querySelector(sel); return n ? (n.innerText || n.textContent || '').trim() : ''; };
    out.push({ href: jk, title: (a.innerText || a.getAttribute('aria-label') || '').trim(), company: pick('[data-testid="company-name"], .companyName'), location: pick('[data-testid="text-location"], .companyLocation') });
  }
  return out;
})()`;

async function readCards(browser: BrowserManager, url: string, script: string): Promise<{ cards: Card[]; loginWall: boolean; blocked: boolean }> {
  return browser.exclusive(async (ctx) => {
    const page = await browser.newPage(ctx, url);
    try {
      await page.waitForTimeout(2500);
      await page.mouse.wheel(0, 2500).catch(() => undefined);
      await page.waitForTimeout(1200);
      const text = await page.evaluate(() => document.body?.innerText?.slice(0, 3000) || '').catch(() => '');
      const cards = ((await page.evaluate(script).catch(() => [])) as Card[]).filter((c) => c.href && c.title);
      return { cards, loginWall: /login|sign in/i.test(page.url()) && cards.length === 0, blocked: /verify you are human|are you a robot|access denied/i.test(text) };
    } finally {
      await page.close().catch(() => undefined);
    }
  });
}

export async function searchNaukri(browser: BrowserManager, q: SearchQuery, stopped: () => boolean): Promise<JobPosting[]> {
  const out: JobPosting[] = [];
  const locs = q.locations.filter((l) => l.toLowerCase() !== 'remote').slice(0, 2);
  for (const kw of q.keywords.slice(0, 3)) {
    for (const loc of locs.length ? locs : ['']) {
      if (stopped()) return out;
      const params = new URLSearchParams();
      if (q.postedWithinDays) params.set('jobAge', String(Math.min(q.postedWithinDays, 30)));
      // Naukri's experience filter: jobs suitable for this many years.
      if (q.experience) params.set('experience', String(q.experience.max));
      const url = `https://www.naukri.com/${kebab(kw)}-jobs${loc ? `-in-${kebab(loc)}` : ''}${params.size ? `?${params}` : ''}`;
      const { cards, blocked } = await readCards(browser, url, NAUKRI_CARDS);
      if (blocked) throw new Error('Naukri is showing a human-verification check. Open Naukri in the automation browser (Settings) and solve it once.');
      for (const c of cards) {
        const id = c.href.match(/-(\d{6,})(?:\?|$)/)?.[1] || c.href;
        if (out.some((x) => x.externalId === id)) continue;
        const p: JobPosting = { source: 'naukri', externalId: id, title: c.title, company: c.company, location: c.location, remote: looksRemote(c.location, c.title), description: '', jobUrl: c.href.split('?')[0], applyUrl: c.href.split('?')[0], postedAt: null, needsBrowser: true, experienceText: c.experience || undefined };
        if (matchesLocation(p, q.locations, q.remoteOk)) out.push(p);
      }
    }
  }
  return out;
}

export async function searchIndeed(browser: BrowserManager, q: SearchQuery, domain: string, stopped: () => boolean): Promise<JobPosting[]> {
  const out: JobPosting[] = [];
  const locs = q.locations.slice(0, 2);
  for (const kw of q.keywords.slice(0, 3)) {
    for (const loc of locs.length ? locs : ['']) {
      if (stopped()) return out;
      const url = `https://${domain}/jobs?q=${encodeURIComponent(kw)}&l=${encodeURIComponent(loc)}${q.postedWithinDays ? `&fromage=${Math.min(q.postedWithinDays, 14)}` : ''}`;
      const { cards, blocked } = await readCards(browser, url, INDEED_CARDS);
      if (blocked) throw new Error('Indeed is showing a human-verification check. Open Indeed in the automation browser (Settings) and solve it once.');
      for (const c of cards) {
        if (out.some((x) => x.externalId === c.href)) continue;
        const jobUrl = `https://${domain}/viewjob?jk=${c.href}`;
        out.push({ source: 'indeed', externalId: c.href, title: c.title, company: c.company, location: c.location, remote: looksRemote(c.location, c.title), description: '', jobUrl, applyUrl: jobUrl, postedAt: null, needsBrowser: true });
      }
    }
  }
  return out;
}
