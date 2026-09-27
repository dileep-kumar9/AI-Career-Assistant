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
    expect(out.status).toBe('needs_attention');
    expect(out.reason).toMatch(/security clearance/i);
    const ctx = await browser.context();
    const open = ctx.pages().find((p) => p.url().endsWith('unanswerable.html'));
    expect(await open!.evaluate(() => (window as any).__submitted ?? null)).toBeNull();
    await open!.close();
  }, 90_000);

  it('refuses to open private-network apply links outside tests', async (t) => {
    if (!chromeOk) return t.skip();
    const out = await browser.exclusive((ctx) => runApplier(ctx, { ...task('greenhouse-like.html', true), applyUrl: 'http://192.168.1.1/admin' }, { engine: engine(), files: { resume: resumePdf, cover: async () => null }, log: () => undefined }));
    expect(out.status).toBe('failed');
    expect(out.reason).toMatch(/private/i);
  }, 30_000);
});
