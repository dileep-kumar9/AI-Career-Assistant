import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BrowserManager } from '../src/career/automation/browser.js';
import { AnswerEngine, type AnswerContext } from '../src/career/automation/answers.js';
import { runApplier, type ApplyTask } from '../src/career/automation/appliers.js';
import { blankProfile } from '../src/career/profile.js';

/**
 * Real-browser tests of the form filler and appliers against local fixture
 * pages shaped like Greenhouse / Lever forms. Skipped when Chrome is not
 * installed. Nothing leaves this machine.
 */

const FORMS = path.resolve(__dirname, 'fixtures/forms');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aca-browser-'));
const resumePdf = path.join(tmp, 'resume.pdf');
fs.writeFileSync(resumePdf, '%PDF-1.4\n% fixture\n');

let server: http.Server;
let base = '';
let browser: BrowserManager;
let chromeOk = true;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://x');
    if (url.pathname === '/thanks') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(`<p>Thank you for applying! We received: ${[...url.searchParams.keys()].join(',')}</p>`);
    }
    const file = path.join(FORMS, path.basename(url.pathname));
    if (!fs.existsSync(file)) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = new BrowserManager({ browserProfileDir: path.join(tmp, 'profile'), browserChannel: process.env.TEST_BROWSER_CHANNEL || 'chrome', headless: true, filesDir: tmp, forceDryRun: false });
  try {
    await browser.context();
  } catch {
    chromeOk = false;
  }
}, 60_000);

afterAll(async () => {
  await browser?.close();
  server?.close();
});

function engine(overrides: Partial<AnswerContext['profile']['authorization']> = {}) {
  const profile = blankProfile();
  profile.basics = { fullName: 'Asha Rao', email: 'asha@example.com', phone: '+91 90000 00000', city: 'Hyderabad', country: 'India', linkedin: 'https://linkedin.com/in/asha', github: 'https://github.com/asha', portfolio: '' };
  profile.career.noticePeriod = '30 days';
  profile.career.currentCompany = 'Contoso';
  profile.authorization = { countries: ['India'], needsSponsorship: false, willingToRelocate: true, ...overrides };
  return new AnswerEngine({
    profile,
    resumeText: 'Asha Rao — Security Analyst at Contoso. SIEM, Splunk, incident response.',
    employers: ['Contoso'],
    job: { title: 'Security Analyst', company: 'Acme', description: 'SOC work', source: 'greenhouse' },
    coverLetter: async () => '',
    wantCoverLetter: false,
    ai: null,
  });
}

const task = (file: string, submit: boolean): ApplyTask => ({ applyUrl: `${base}/${file}`, jobUrl: `${base}/${file}`, source: 'link', jobTitle: 'Security Analyst', company: 'Acme', submit });

const run = (file: string, submit: boolean, eng = engine()) =>
  browser.exclusive((ctx) => runApplier(ctx, task(file, submit), { engine: eng, files: { resume: resumePdf, cover: async () => null }, log: () => undefined, allowPrivateHosts: true }));

describe('form filler + appliers (real Chrome, local fixtures)', () => {
  it('fills a Greenhouse-shaped form truthfully and submits it', async (t) => {
    if (!chromeOk) return t.skip();
    const out = await run('greenhouse-like.html', true);
    expect(out.status).toBe('submitted');
    const byQ = Object.fromEntries(out.answers.map((a) => [a.question, a.answer]));
    expect(byQ['First Name']).toBe('Asha');
    expect(byQ['Last Name']).toBe('Rao');
    expect(byQ['Are you legally authorized to work in India?']).toBe('Yes');
    expect(byQ['Will you now or in the future require visa sponsorship?']).toBe('No');
    expect(byQ['Gender']).toBe('Decline To Self Identify');
    expect(byQ['How did you hear about this job?']).toBe('Company Website');
  }, 90_000);

  it('never presses Submit in fill-only mode and leaves the tab open', async (t) => {
    if (!chromeOk) return t.skip();
    const out = await run('greenhouse-like.html', false);
    expect(out.status).toBe('filled');
    expect(out.keepOpen).toBe(true);
    const ctx = await browser.context();
    const open = ctx.pages().find((p) => p.url().endsWith('greenhouse-like.html'));
    expect(open).toBeTruthy();
    expect(await open!.evaluate(() => (window as any).__submitted ?? null)).toBeNull();
    expect(await open!.inputValue('#email')).toBe('asha@example.com');
    expect(await open!.isChecked('#privacy')).toBe(true);
    expect(await open!.isChecked('#news')).toBe(false); // never opts in to marketing
    await open!.close();
  }, 90_000);

  it('fills a Lever-shaped form (div labels, ✱ required) and follows the /thanks confirmation', async (t) => {
    if (!chromeOk) return t.skip();
    const out = await run('lever-like.html', true);
    expect(out.status).toBe('submitted');
    const byQ = Object.fromEntries(out.answers.map((a) => [a.question, a.answer]));
    expect(byQ['Full name']).toBe('Asha Rao');
    expect(byQ['What is your notice period?']).toBe('30 days');
    expect(byQ['Current company']).toBe('Contoso');
  }, 90_000);

  it('stops with "needs attention" instead of guessing an unanswerable required question', async (t) => {
    if (!chromeOk) return t.skip();
    const out = await run('unanswerable.html', true);
    expect(out.status).toBe('needs_input');
    expect(out.reason).toMatch(/security clearance/i);
    expect(out.questions?.[0]).toMatchObject({ question: expect.stringMatching(/security clearance/i), options: ['Yes', 'No'], required: true });
    const ctx = await browser.context();
    const open = ctx.pages().find((p) => p.url().endsWith('unanswerable.html'));
    expect(await open!.evaluate(() => (window as any).__submitted ?? null)).toBeNull();
    await open!.close();
  }, 90_000);

  it('LinkedIn Easy Apply: uploads and selects the tailored resume, asks you what it cannot answer, then submits with your answers', async (t) => {
    if (!chromeOk) return t.skip();
    const tailored = path.join(tmp, 'Asha_Rao_Resume.pdf');
    fs.copyFileSync(resumePdf, tailored);
    const deps = (eng: AnswerEngine, confirmed: string[] = []) => ({ engine: eng, files: { resume: tailored, cover: async () => null }, log: () => undefined, allowPrivateHosts: true, forceKind: 'linkedin' as const, reviewAnswers: true, confirmed });
    // 1st run: two questions only the candidate can answer → needs_input (no guessing)
    const first = await browser.exclusive((ctx) => runApplier(ctx, task('linkedin-like.html', true), deps(engine())));
    expect(first.status).toBe('needs_input');
    expect(first.questions?.map((q) => q.question)).toEqual(['Do you have 7+ years of experience in Python & FastAPI/REST APIs?', 'Can you join immediately to 15 days after selection?']);
    expect(first.questions?.[0].options).toEqual(['Yes', 'No']);
    for (const p of (await browser.context()).pages()) if (p.url().includes('linkedin-like')) await p.close();
    // 2nd run with the answers you gave → uploaded tailored resume selected, follow unticked, submitted
    const overrides = [
      { question: 'Do you have 7+ years of experience in Python & FastAPI/REST APIs?', answer: 'No' },
      { question: 'Can you join immediately to 15 days after selection?', answer: 'Yes' },
    ];
    const eng = engine();
    (eng as any).ctx.overrides = overrides;
    let submitted: any = null;
    const out = await browser.exclusive(async (ctx) => {
      const o = await runApplier(ctx, { ...task('linkedin-like.html', true) }, { ...deps(eng, overrides.map((x) => x.question)), onPage: (p) => p.on('close', () => undefined) });
      return o;
    });
    expect(out.status).toBe('submitted');
    submitted = out.answers;
    expect(submitted.find((a: any) => /7\+ years/.test(a.question))?.answer).toBe('No');
  }, 120_000);

  it('LinkedIn fixture records the uploaded tailored resume and never follows the company', async (t) => {
    if (!chromeOk) return t.skip();
    const tailored = path.join(tmp, 'Asha_Rao_Resume.pdf');
    fs.copyFileSync(resumePdf, tailored);
    const eng = engine();
    (eng as any).ctx.overrides = [
      { question: 'Do you have 7+ years of experience in Python & FastAPI/REST APIs?', answer: 'No' },
      { question: 'Can you join immediately to 15 days after selection?', answer: 'Yes' },
    ];
    const ctx = await browser.context();
    let page: import('playwright-core').Page | null = null;
    const out = await browser.exclusive((c) => runApplier(c, task('linkedin-like.html', false), { engine: eng, files: { resume: tailored, cover: async () => null }, log: () => undefined, allowPrivateHosts: true, forceKind: 'linkedin', onPage: (p) => (page = p) }));
    expect(out.status).toBe('filled'); // fill-only: stops at Submit
    expect(await page!.evaluate(() => (window as any).__uploaded)).toBe('Asha_Rao_Resume.pdf');
    expect(await page!.isChecked('input[value="new"]')).toBe(true);
    expect(await page!.isChecked('#follow-company-checkbox')).toBe(false);
    await page!.close();
    void ctx;
  }, 120_000);

  it('LinkedIn "apply on company website": ignores other jobs’ Easy Apply, follows Apply to the company form and fills it', async (t) => {
    if (!chromeOk) return t.skip();
    const logs: string[] = [];
    let last: import('playwright-core').Page | null = null;
    const out = await browser.exclusive((c) => runApplier(c, task('linkedin-offsite.html', false), { engine: engine(), files: { resume: resumePdf, cover: async () => null }, log: (m) => logs.push(m), allowPrivateHosts: true, forceKind: 'linkedin', onPage: (p) => (last = p) }));
    expect(logs.join(' ')).toMatch(/applies on the company website/);
    expect(logs.join(' ')).toMatch(/This job applies on another site/);
    expect(out.status).toBe('filled'); // the company form (greenhouse-like) was filled, fill-only
    expect(last!.url()).toMatch(/greenhouse-like\.html$/);
    expect(await last!.inputValue('#email')).toBe('asha@example.com');
    await last!.close();
  }, 120_000);

  for (const site of ['naukri', 'indeed'] as const) {
    it(`${site} "apply on company site": follows the button to the company form and fills it`, async (t) => {
      if (!chromeOk) return t.skip();
      const logs: string[] = [];
      let last: import('playwright-core').Page | null = null;
      let redirect = '';
      const out = await browser.exclusive((c) => runApplier(c, task(`${site}-offsite.html`, false), { engine: engine(), files: { resume: resumePdf, cover: async () => null }, log: (m) => logs.push(m), allowPrivateHosts: true, forceKind: site, onPage: (p) => (last = p), onRedirect: (u) => (redirect = u) }));
      expect(logs.join(' ')).toMatch(/applies on the company website/);
      // Saved so a retry opens the company form, not the portal (which already shows the job as applied).
      expect(redirect).toMatch(/greenhouse-like\.html$/);
      expect(out.status).toBe('filled');
      expect(last!.url()).toMatch(/greenhouse-like\.html$/);
      expect(await last!.inputValue('#email')).toBe('asha@example.com');
      await last!.close();
    }, 120_000);
  }

  it('company career site: uploads the resume through a click-to-upload widget, goes through two pages and submits with a div button', async (t) => {
    if (!chromeOk) return t.skip();
    const logs: string[] = [];
    const out = await browser.exclusive((c) => runApplier(c, task('career-site-multistep.html', true), { engine: engine(), files: { resume: resumePdf, cover: async () => null }, log: (m) => logs.push(m), allowPrivateHosts: true }));
    expect(logs.join(' ')).toMatch(/Uploaded the tailored resume \(resume\.pdf\)/);
    expect(logs.join(' ')).toMatch(/on page 2/);
    expect(out.status).toBe('submitted');
  }, 120_000);

  it('Indeed behind Cloudflare: says so instead of "no Apply button"', async (t) => {
    if (!chromeOk) return t.skip();
    const out = await browser.exclusive((c) => runApplier(c, task('indeed-cloudflare.html', true), { engine: engine(), files: { resume: resumePdf, cover: async () => null }, log: () => undefined, allowPrivateHosts: true, forceKind: 'indeed' }));
    expect(out.status).toBe('needs_attention');
    expect(out.reason).toMatch(/Cloudflare/);
  }, 60_000);

  it('Naukri chatbot: answers a chip question with the matching chip ("Yes" → "Yes, I can relocate") and confirms the application', async (t) => {
    if (!chromeOk) return t.skip();
    const out = await browser.exclusive((c) => runApplier(c, task('naukri-chatbot.html', true), { engine: engine(), files: { resume: resumePdf, cover: async () => null }, log: () => undefined, allowPrivateHosts: true, forceKind: 'naukri' }));
    expect(out.answers.map((a) => a.answer)).toEqual(['Yes, I can relocate']);
    expect(out.status).toBe('submitted');
  }, 120_000);

  it('Google Forms: fills ARIA radios, dropdowns and checkboxes over two pages, and pauses to review a remembered answer', async (t) => {
    if (!chromeOk) return t.skip();
    const eng = engine({ willingToRelocate: null });
    (eng as any).ctx.profile.savedAnswers = [{ id: 's1', question: 'Are you willing to relocate?', answer: 'Yes', updatedAt: new Date().toISOString() }];
    const base = { engine: eng, files: { resume: resumePdf, cover: async () => null }, log: () => undefined, allowPrivateHosts: true, forceKind: 'google_forms' as const, reviewAnswers: true };
    const paused = await browser.exclusive((ctx) => runApplier(ctx, task('google-forms-like.html', true), base));
    expect(paused.status).toBe('needs_review');
    expect(paused.questions).toEqual([expect.objectContaining({ question: 'Are you willing to relocate?', suggested: 'Yes', source: 'saved' })]);
    for (const p of (await browser.context()).pages()) if (p.url().includes('google-forms-like')) await p.close();
    let page: import('playwright-core').Page | null = null;
    const done = await browser.exclusive((ctx) => runApplier(ctx, task('google-forms-like.html', true), { ...base, confirmed: ['Are you willing to relocate?'], onPage: (p) => (page = p) }));
    expect(done.status).toBe('submitted');
    const byQ = Object.fromEntries(done.answers.map((a) => [a.question, a.answer]));
    expect(byQ['Full name']).toBe('Asha Rao');
    expect(byQ['Current city']).toBe('Hyderabad');
    expect(byQ['Are you willing to relocate?']).toBe('Yes');
    void page;
  }, 120_000);

  it('refuses to open private-network apply links outside tests', async (t) => {
    if (!chromeOk) return t.skip();
    const out = await browser.exclusive((ctx) => runApplier(ctx, { ...task('greenhouse-like.html', true), applyUrl: 'http://192.168.1.1/admin' }, { engine: engine(), files: { resume: resumePdf, cover: async () => null }, log: () => undefined }));
    expect(out.status).toBe('failed');
    expect(out.reason).toMatch(/private/i);
  }, 30_000);
});
