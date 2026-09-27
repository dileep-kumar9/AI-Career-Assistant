import type { BrowserContext, Frame, Page } from 'playwright-core';
import type { ApplicationAnswer, JobSourceId } from '../../../../shared/careerTypes.js';
import { assertPublicUrl } from '../../services/fetchJob.js';
import { siteOf } from '../jobs/readers.js';
import type { AnswerEngine, FieldInfo } from './answers.js';
import { humanPause } from './browser.js';
import { type FillFiles, type FillReport, SUCCESS_TEXT, captchaVisible, clickFirst, fillFields, pageSaysSubmitted, scanFields, validationErrors } from './formFill.js';

/**
 * Site-specific application flows. Every flow:
 *  - fills only what it can answer truthfully (FillReport.missingRequired),
 *  - never presses Submit when `submit` is false (review / fill-only / dry run),
 *  - stops at CAPTCHAs and login walls and leaves the tab open for you,
 *  - reports "submitted" only when the site confirms it.
 */

export interface ApplyTask {
  applyUrl: string;
  jobUrl: string;
  source: JobSourceId;
  jobTitle: string;
  company: string;
  /** false = fill the form and leave it open for you to submit */
  submit: boolean;
}

export interface ApplyOutcome {
  status: 'submitted' | 'filled' | 'needs_attention' | 'failed';
  reason: string;
  answers: ApplicationAnswer[];
  /** The job is applied for on another site (LinkedIn/Naukri/Indeed "apply on company site"). */
  redirectUrl?: string;
  /** Leave the tab open for you. */
  keepOpen: boolean;
}

export interface ApplyDeps {
  engine: AnswerEngine;
  files: FillFiles;
  log: (message: string) => void;
  /** Tests only: allow fixture pages on 127.0.0.1. Real apply links must be public addresses. */
  allowPrivateHosts?: boolean;
}

const toAnswers = (r: FillReport): ApplicationAnswer[] =>
  r.fields
    .filter((f) => f.value || f.required)
    .map((f) => ({ question: f.label, answer: f.value, source: f.source === 'prefilled' ? 'rule' : f.source, confident: f.confident && (f.filled || f.source === 'prefilled') }));

const attention = (reason: string, report?: FillReport): ApplyOutcome => ({ status: 'needs_attention', reason, answers: report ? toAnswers(report) : [], keepOpen: true });

async function waitSettled(page: Page, ms = 1500) {
  await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 6_000 }).catch(() => undefined);
  await page.waitForTimeout(ms);
}

/** The frame (page or iframe, e.g. an embedded Greenhouse form) with the most form fields. */
async function formFrame(page: Page, root: string | null): Promise<{ frame: Frame | Page; fields: FieldInfo[] }> {
  let best: { frame: Frame | Page; fields: FieldInfo[] } = { frame: page, fields: await scanFields(page, root).catch(() => []) };
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    const fields = await scanFields(f, null).catch(() => [] as FieldInfo[]);
    if (fields.length > best.fields.length) best = { frame: f, fields };
  }
  return best;
}

async function submitAndConfirm(page: Page, frame: Frame | Page, report: FillReport, submitSelectors: string[], deps: ApplyDeps): Promise<ApplyOutcome> {
  if (!(await clickFirst(frame, submitSelectors, 10_000))) return attention('Filled the form but could not find its Submit button. Please submit it in the open tab.', report);
  deps.log('Pressed Submit.');
  await waitSettled(page, 3000);
  for (let i = 0; i < 6; i++) {
    if (await pageSaysSubmitted(page)) return { status: 'submitted', reason: '', answers: toAnswers(report), keepOpen: false };
    if (frame !== page && (await frame.evaluate(() => document.body?.innerText || '').then((t) => SUCCESS_TEXT.test(t)).catch(() => false))) return { status: 'submitted', reason: '', answers: toAnswers(report), keepOpen: false };
    if (await captchaVisible(page)) return attention('A CAPTCHA appeared after Submit. Solve it in the open tab to finish, then click “Mark as applied”.', report);
    await page.waitForTimeout(1500);
  }
  const errors = await validationErrors(frame);
  return attention(errors.length ? `The site did not accept the form: ${errors.join(' · ').slice(0, 400)}` : 'Submitted, but the site did not show a confirmation. Check the open tab; if it went through, click “Mark as applied”.', report);
}

/** Fill-and-submit for single-page application forms (Greenhouse, Lever, Ashby, most career sites). */
async function applyForm(page: Page, task: ApplyTask, deps: ApplyDeps, opts: { root?: string | null; open?: string[]; submit: string[] }): Promise<ApplyOutcome> {
  await waitSettled(page);
  let { frame, fields } = await formFrame(page, opts.root ?? null);
  if (fields.length < 2 && opts.open?.length && (await clickFirst(page, opts.open))) {
    deps.log('Opened the application form.');
    await waitSettled(page);
    ({ frame, fields } = await formFrame(page, opts.root ?? null));
  }
  if (await captchaVisible(page)) return attention('The site is showing a CAPTCHA / “verify you are human” check. Solve it in the open tab, then retry.');
  if (fields.length < 2) return attention('Could not find an application form on this page. It is open for you to apply manually.');
  deps.log(`Found ${fields.length} form fields.`);
  const report = await fillFields(frame, fields, deps.engine, deps.files);
  // Forms often reveal follow-up questions after an answer; fill those too.
  const more = (await scanFields(frame, opts.root ?? null).catch(() => [])).filter((f) => !fields.some((x) => x.key === f.key));
  if (more.length) {
    const extra = await fillFields(frame, more, deps.engine, deps.files);
    report.fields.push(...extra.fields);
    report.missingRequired.push(...extra.missingRequired);
  }
  deps.log(`Filled ${report.fields.filter((f) => f.filled).length} fields${report.missingRequired.length ? `; ${report.missingRequired.length} required question(s) need you` : ''}.`);
  if (report.missingRequired.length) return attention(`These required questions need your answer: ${report.missingRequired.slice(0, 6).join(' · ')}`, report);
  if (!task.submit) return { status: 'filled', reason: 'The form is filled in the open tab — check it and press Submit yourself, then click “Mark as applied”.', answers: toAnswers(report), keepOpen: true };
  return submitAndConfirm(page, frame, report, opts.submit, deps);
}

// ------------------------------------------------------------------ ATS boards

export function greenhouseFormUrl(url: string): string {
  const u = new URL(url);
  const m = u.pathname.match(/^\/([^/]+)\/jobs\/(\d+)/);
  if (/greenhouse\.io$/.test(u.hostname) && m) return `https://job-boards.greenhouse.io/${m[1]}/jobs/${m[2]}`;
  return url;
}

const greenhouse = (page: Page, task: ApplyTask, deps: ApplyDeps) =>
  applyForm(page, task, deps, {
    open: ['button:has-text("Apply")', 'a:has-text("Apply for this job")', 'a:has-text("Apply")'],
    submit: ['#submit_app', 'button[type="submit"]:has-text("Submit")', 'button:has-text("Submit application")', 'input[type="submit"]'],
  });

const lever = (page: Page, task: ApplyTask, deps: ApplyDeps) =>
  applyForm(page, task, deps, {
    root: '#application-form, form[action*="apply"]',
    open: ['a:has-text("Apply for this job")', 'a.postings-btn:has-text("Apply")'],
    submit: ['#btn-submit', 'button[type="submit"]:has-text("Submit")', 'button:has-text("Submit application")'],
  });

const ashby = (page: Page, task: ApplyTask, deps: ApplyDeps) =>
  applyForm(page, task, deps, {
    open: ['a:has-text("Application")', 'button:has-text("Apply for this Job")'],
    submit: ['button:has-text("Submit Application")', 'button[type="submit"]'],
  });

async function workday(page: Page): Promise<ApplyOutcome> {
  await waitSettled(page);
  await clickFirst(page, ['a[data-automation-id="adventureButton"]', 'button:has-text("Apply")', 'a:has-text("Apply")']);
  return attention('Workday needs a separate account for each company, so this one is assisted: the application is open in the browser — sign in or create the account, finish it there, then click “Mark as applied”.');
}

const generic = (page: Page, task: ApplyTask, deps: ApplyDeps) =>
  applyForm(page, task, deps, {
    open: ['a:has-text("Apply now")', 'button:has-text("Apply now")', 'a:has-text("Apply for this")', 'button:has-text("Apply for this")', 'a:has-text("Apply")', 'button:has-text("Apply")'],
    submit: ['button[type="submit"]:has-text("Submit")', 'button:has-text("Submit application")', 'button:has-text("Submit")', 'input[type="submit"]', 'button:has-text("Apply")'],
  });

// ------------------------------------------------------------------ LinkedIn Easy Apply

async function linkedin(page: Page, task: ApplyTask, deps: ApplyDeps, ctx: BrowserContext): Promise<ApplyOutcome> {
  await waitSettled(page, 2500);
  if (/\/(login|authwall|checkpoint|uas\/login)/.test(page.url()) || (await page.locator('a:has-text("Sign in"), button:has-text("Sign in")').first().isVisible().catch(() => false) && !(await page.locator('.global-nav__me, [data-control-name="nav.settings"]').first().isVisible().catch(() => false)))) {
    return attention('You are not logged in to LinkedIn in the automation browser. Settings → Automation browser → Open LinkedIn, log in once, then retry.');
  }
  const easy = page.locator('button.jobs-apply-button:has-text("Easy Apply"), button[aria-label*="Easy Apply"]').first();
  if (!(await easy.isVisible().catch(() => false))) {
    const applied = await page.locator('text=/Applied \\d|Application submitted|You applied/i').first().isVisible().catch(() => false);
    if (applied) return { status: 'submitted', reason: 'LinkedIn shows this job as already applied.', answers: [], keepOpen: false };
    const external = page.locator('button.jobs-apply-button, a.jobs-apply-button, button:has-text("Apply")').first();
    if (await external.isVisible().catch(() => false)) {
      const popup = ctx.waitForEvent('page', { timeout: 10_000 }).catch(() => null);
      await external.click().catch(() => undefined);
      const p2 = await popup;
      const url = p2 ? p2.url() : page.url();
      if (p2) await p2.close().catch(() => undefined);
      if (url && !/linkedin\.com/.test(url)) return { status: 'needs_attention', reason: 'Applies on the company site.', answers: [], redirectUrl: url, keepOpen: false };
    }
    return attention('This LinkedIn job has no Easy Apply button (it may be closed). It is open for you to check.');
  }
  await easy.click();
  deps.log('Opened LinkedIn Easy Apply.');
  const dialog = 'div[role="dialog"]';
  await page.waitForSelector(dialog, { timeout: 15_000 }).catch(() => undefined);
  const all: FillReport = { fields: [], missingRequired: [] };
  for (let step = 0; step < 15; step++) {
    await page.waitForTimeout(1200);
    const fields = await scanFields(page, dialog).catch(() => []);
    const report = await fillFields(page, fields, deps.engine, deps.files);
    all.fields.push(...report.fields);
    if (report.missingRequired.length) return attention(`LinkedIn asks questions that need your answer: ${report.missingRequired.slice(0, 6).join(' · ')}`, all);
    const submitBtn = page.locator(`${dialog} button[aria-label*="Submit application"], ${dialog} button:has-text("Submit application")`).first();
    if (await submitBtn.isVisible().catch(() => false)) {
      if (!task.submit) return { status: 'filled', reason: 'Easy Apply is filled up to the last step — review it in the open tab and press Submit yourself, then click “Mark as applied”.', answers: toAnswers(all), keepOpen: true };
      const follow = page.locator(`${dialog} label:has-text("Follow")`).first();
      if (await follow.isVisible().catch(() => false)) await follow.click().catch(() => undefined); // don't auto-follow the company
      await submitBtn.click();
      deps.log('Pressed Submit application.');
      await page.waitForTimeout(3000);
      const sent = await page.locator('text=/application was sent|Application sent|Your application was submitted/i').first().isVisible().catch(() => false);
      await clickFirst(page, [`${dialog} button:has-text("Done")`, `${dialog} button[aria-label="Dismiss"]`]);
      return sent ? { status: 'submitted', reason: '', answers: toAnswers(all), keepOpen: false } : attention('Pressed Submit but LinkedIn did not confirm. Check the open tab.', all);
    }
    const next = page.locator(`${dialog} button[aria-label*="Review"], ${dialog} button[aria-label*="Continue to next step"], ${dialog} button:has-text("Review"), ${dialog} button:has-text("Next")`).first();
    if (!(await next.isVisible().catch(() => false))) break;
    await next.click();
    await page.waitForTimeout(1200);
    const errs = await page.locator(`${dialog} .artdeco-inline-feedback--error, ${dialog} [role="alert"]`).allInnerTexts().catch(() => []);
    if (errs.filter((e) => e.trim()).length) return attention(`LinkedIn did not accept a step: ${errs.join(' · ').slice(0, 300)}`, all);
    await humanPause(400, 900);
  }
  return attention('Easy Apply has more steps than expected. It is open for you to finish.', all);
}

// ------------------------------------------------------------------ Naukri

async function naukri(page: Page, task: ApplyTask, deps: ApplyDeps, ctx: BrowserContext): Promise<ApplyOutcome> {
  await waitSettled(page, 2000);
  if (/nlogin|login\.naukri/.test(page.url())) return attention('You are not logged in to Naukri in the automation browser. Settings → Automation browser → Open Naukri, log in once, then retry.');
  const already = await page.locator('button:has-text("Applied"), span:has-text("Applied")').first().isVisible().catch(() => false);
  if (already) return { status: 'submitted', reason: 'Naukri shows this job as already applied.', answers: [], keepOpen: false };
  const companySite = page.locator('#company-site-button, button:has-text("Apply on company site")').first();
  if (await companySite.isVisible().catch(() => false)) {
    const popup = ctx.waitForEvent('page', { timeout: 10_000 }).catch(() => null);
    await companySite.click().catch(() => undefined);
    const p2 = await popup;
    const url = p2?.url() || '';
    if (p2) await p2.close().catch(() => undefined);
    return url && !/naukri\.com/.test(url) ? { status: 'needs_attention', reason: 'Applies on the company site.', answers: [], redirectUrl: url, keepOpen: false } : attention('This job applies on the company site. It is open for you.');
  }
  const loginToApply = await page.locator('button:has-text("Login to apply"), a:has-text("Login to apply")').first().isVisible().catch(() => false);
  if (loginToApply) return attention('Naukri says “Login to apply”. Log in to Naukri in the automation browser (Settings), then retry.');
  if (!task.submit) return { status: 'filled', reason: 'Naukri applies in one click with your Naukri profile resume. Press “Apply” in the open tab yourself, then click “Mark as applied”.', answers: [], keepOpen: true };
  if (!(await clickFirst(page, ['#apply-button', 'button.apply-button', 'button:has-text("Apply")']))) return attention('Could not find Naukri’s Apply button. The job is open for you.');
  deps.log('Pressed Apply on Naukri (Naukri sends your profile resume).');
  const answers: ApplicationAnswer[] = [];
  for (let turn = 0; turn < 15; turn++) {
    await page.waitForTimeout(1800);
    const body = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
    if (/you have successfully applied|successfully applied|applied to/i.test(body)) return { status: 'submitted', reason: '', answers, keepOpen: false };
    const drawer = page.locator('[class*="chatbot_Drawer"], [class*="chatbot_MessageContainer"], .chatbot_DrawerContentWrapper').first();
    if (!(await drawer.isVisible().catch(() => false))) {
      if (turn > 2) break;
      continue;
    }
    const question = ((await page.locator('[class*="botMsg"], .botItem').last().innerText().catch(() => '')) || '').trim();
    if (!question) continue;
    const chips = page.locator('[class*="chatbot_Chip"], .chatbot_Chip, [class*="ssrc__radio-btn-container"] label');
    const options = (await chips.allInnerTexts().catch(() => [])).map((t) => t.trim()).filter(Boolean);
    const field: FieldInfo = { key: 'chat', kind: options.length ? 'radio' : 'text', label: question, name: '', required: true, options, value: '', autocomplete: '', placeholder: '', accept: '' };
    const a = await deps.engine.answer(field);
    if (!a || !a.confident || !a.value) return attention(`Naukri’s application chatbot asks: “${question.slice(0, 200)}” — answer it in the open tab.`, { fields: [], missingRequired: [question] });
    answers.push({ question, answer: a.value, source: a.source, confident: true });
    if (options.length) await chips.nth(options.indexOf(a.value)).click().catch(() => undefined);
    else {
      const input = page.locator('[class*="chatbot"] [contenteditable="true"], [class*="chatbot"] textarea, [class*="chatbot"] input[type="text"]').last();
      await input.fill(a.value).catch(() => input.pressSequentially(a.value, { delay: 20 }));
    }
    await clickFirst(page, ['[class*="sendMsg"]', '[class*="chatbot"] button:has-text("Save")', '[class*="chatbot"] button:has-text("Submit")']);
  }
  const done = await page.evaluate(() => document.body?.innerText || '').then((t) => /you have successfully applied|successfully applied/i.test(t)).catch(() => false);
  return done ? { status: 'submitted', reason: '', answers, keepOpen: false } : attention('Naukri did not confirm the application. Check the open tab.', { fields: [], missingRequired: [] });
}

// ------------------------------------------------------------------ Indeed

async function indeed(page: Page, task: ApplyTask, deps: ApplyDeps, ctx: BrowserContext): Promise<ApplyOutcome> {
  await waitSettled(page, 2000);
  if (await captchaVisible(page)) return attention('Indeed is showing a “verify you are human” check. Solve it in the open tab, then retry.');
  const applyBtn = page.locator('#indeedApplyButton, button:has-text("Apply now"), button[aria-label*="Apply now"]').first();
  if (!(await applyBtn.isVisible().catch(() => false))) {
    const ext = page.locator('button:has-text("Apply on company site"), a:has-text("Apply on company site")').first();
    if (await ext.isVisible().catch(() => false)) {
      const popup = ctx.waitForEvent('page', { timeout: 10_000 }).catch(() => null);
      await ext.click().catch(() => undefined);
      const p2 = await popup;
      const url = p2?.url() || '';
      if (p2) await p2.close().catch(() => undefined);
      if (url && !/indeed\./.test(url)) return { status: 'needs_attention', reason: 'Applies on the company site.', answers: [], redirectUrl: url, keepOpen: false };
    }
    return attention('No “Apply now” button found on Indeed. The job is open for you.');
  }
  const popup = ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null);
  await applyBtn.click();
  const p2 = (await popup) || page;
  await waitSettled(p2, 2000);
  if (/secure\.indeed\.com\/auth|\/account\/login/.test(p2.url())) return attention('You are not logged in to Indeed in the automation browser. Settings → Automation browser → Open Indeed, log in once, then retry.');
  const all: FillReport = { fields: [], missingRequired: [] };
  for (let step = 0; step < 12; step++) {
    if (await captchaVisible(p2)) return attention('Indeed is showing a “verify you are human” check in the application. Solve it in the open tab.', all);
    const fields = await scanFields(p2, 'main').catch(() => []);
    const report = await fillFields(p2, fields, deps.engine, deps.files);
    all.fields.push(...report.fields);
    if (report.missingRequired.length) return attention(`Indeed asks questions that need your answer: ${report.missingRequired.slice(0, 6).join(' · ')}`, all);
    const submitBtn = p2.locator('button:has-text("Submit your application"), button:has-text("Submit application")').first();
    if (await submitBtn.isVisible().catch(() => false)) {
      if (!task.submit) return { status: 'filled', reason: 'Indeed Apply is filled up to the last step — review and press Submit yourself, then click “Mark as applied”.', answers: toAnswers(all), keepOpen: true };
      await submitBtn.click();
      await waitSettled(p2, 3000);
      return (await pageSaysSubmitted(p2)) ? { status: 'submitted', reason: '', answers: toAnswers(all), keepOpen: false } : attention('Pressed Submit but Indeed did not confirm. Check the open tab.', all);
    }
    if (!(await clickFirst(p2, ['button:has-text("Continue")', 'button:has-text("Review your application")', 'button[type="submit"]']))) break;
    await waitSettled(p2, 1200);
    const errs = await validationErrors(p2);
    if (errs.length && step > 0) return attention(`Indeed did not accept a step: ${errs.join(' · ').slice(0, 300)}`, all);
  }
  return attention('Indeed Apply has more steps than expected. It is open for you to finish.', all);
}

// ------------------------------------------------------------------ router

export function applierFor(url: string): 'greenhouse' | 'lever' | 'ashby' | 'workday' | 'linkedin' | 'naukri' | 'indeed' | 'generic' {
  const site = siteOf(new URL(url));
  return site === 'other' ? 'generic' : site;
}

/** Runs the right flow for the job's apply link; follows one "apply on company site" redirect to a known form. */
export async function runApplier(ctx: BrowserContext, task: ApplyTask, deps: ApplyDeps): Promise<ApplyOutcome> {
  let url = task.applyUrl || task.jobUrl;
  for (let hop = 0; hop < 2; hop++) {
    const kind = applierFor(url);
    const target = kind === 'greenhouse' ? greenhouseFormUrl(url) : kind === 'lever' && !/\/apply\b/.test(url) ? `${url.replace(/\/$/, '')}/apply` : kind === 'ashby' && !/\/application\b/.test(url) ? `${url.replace(/\/$/, '')}/application` : url;
    // Apply links come from job pages (untrusted): never point the logged-in browser at private/internal addresses.
    if (!deps.allowPrivateHosts) {
      try {
        await assertPublicUrl(target);
      } catch {
        return { status: 'failed', reason: 'The apply link points to a private or invalid address, so it was not opened.', answers: [], keepOpen: false };
      }
    }
    deps.log(`Opening ${new URL(target).hostname} (${kind}).`);
    const page = await ctx.newPage();
    let outcome: ApplyOutcome;
    try {
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      outcome =
        kind === 'greenhouse'
          ? await greenhouse(page, task, deps)
          : kind === 'lever'
            ? await lever(page, task, deps)
            : kind === 'ashby'
              ? await ashby(page, task, deps)
              : kind === 'workday'
                ? await workday(page)
                : kind === 'linkedin'
                  ? await linkedin(page, task, deps, ctx)
                  : kind === 'naukri'
                    ? await naukri(page, task, deps, ctx)
                    : kind === 'indeed'
                      ? await indeed(page, task, deps, ctx)
                      : await generic(page, task, deps);
    } catch (e) {
      outcome = attention(`The automation hit an error on this site: ${String((e as Error).message).split('\n')[0].slice(0, 200)}. The tab is open for you.`);
    }
    if (!outcome.keepOpen) await page.close().catch(() => undefined);
    else await page.bringToFront().catch(() => undefined);
    if (outcome.redirectUrl && hop === 0) {
      deps.log(`This job applies on another site: ${new URL(outcome.redirectUrl).hostname}.`);
      url = outcome.redirectUrl;
      continue;
    }
    return outcome;
  }
  return attention('The job redirected more than once. Please apply manually.');
}
