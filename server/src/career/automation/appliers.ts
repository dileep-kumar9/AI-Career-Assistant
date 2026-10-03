import path from 'node:path';
import type { BrowserContext, Frame, Locator, Page } from 'playwright-core';
import type { ApplicationAnswer, JobSourceId, PendingQuestion } from '../../../../shared/careerTypes.js';
import { assertPublicUrl } from '../../services/fetchJob.js';
import { siteOf } from '../jobs/readers.js';
import { normQuestion } from '../profile.js';
import { type AnswerEngine, type FieldInfo, bestOption } from './answers.js';
import { humanPause } from './browser.js';
import { type FillFiles, type FillReport, SUCCESS_TEXT, captchaVisible, clickFirst, fillFields, pageSaysSubmitted, scanFields, validationErrors } from './formFill.js';

/**
 * Site-specific application flows. Every flow:
 *  - fills only what it can answer truthfully; required questions it cannot
 *    answer come back to you as `needs_input` (they are shown in the app, your
 *    answers are remembered and the form is filled again with them);
 *  - with review on, pauses before Submit (`needs_review`) when answers came
 *    from memory or AI, so you can confirm or edit them;
 *  - never presses Submit when `submit` is false (review / fill-only / dry run);
 *  - stops at CAPTCHAs and login walls and leaves the tab open for you;
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
  status: 'submitted' | 'filled' | 'needs_input' | 'needs_review' | 'needs_attention' | 'failed';
  reason: string;
  answers: ApplicationAnswer[];
  /** Questions for you (needs_input: unanswerable; needs_review: answers to confirm). */
  questions?: PendingQuestion[];
  /** The job is applied for on another site (LinkedIn/Naukri/Indeed "apply on company site"). */
  redirectUrl?: string;
  /** Leave the tab open for you. */
  keepOpen: boolean;
}

export interface ApplyDeps {
  engine: AnswerEngine;
  files: FillFiles;
  log: (message: string) => void;
  /** Pause before Submit when answers came from memory or AI and you have not confirmed them. */
  reviewAnswers?: boolean;
  /** Questions (normalised) you already answered or confirmed for this application. */
  confirmed?: string[];
  /** Called with every page the applier opens (so a later retry can close it). */
  onPage?: (page: Page) => void;
  /** Called with the company application URL a job portal sent us to (so a retry goes there directly). */
  onRedirect?: (url: string) => void;
  /** Tests only: allow fixture pages on 127.0.0.1. Real apply links must be public addresses. */
  allowPrivateHosts?: boolean;
  /** Tests only: force a flow for a fixture page. */
  forceKind?: ApplierKind;
}

const toAnswers = (r: FillReport): ApplicationAnswer[] =>
  r.fields
    .filter((f) => f.value || f.required)
    .map((f) => ({ question: f.label, answer: f.value, source: f.source === 'prefilled' ? 'rule' : f.source, confident: f.confident && (f.filled || f.source === 'prefilled') }));

const attention = (reason: string, report?: FillReport): ApplyOutcome => ({ status: 'needs_attention', reason, answers: report ? toAnswers(report) : [], keepOpen: true });

/** Required questions it could not answer truthfully → ask you. */
function inputNeeded(report: FillReport, where: string): ApplyOutcome {
  const missing = new Set(report.missingRequired);
  const questions: PendingQuestion[] = report.fields
    .filter((f) => missing.has(f.label))
    .map((f) => ({ question: f.label, kind: f.kind, options: f.options, required: true, suggested: '', source: 'none' as const }));
  return {
    status: 'needs_input',
    reason: `${where} asks ${questions.length === 1 ? 'a question' : `${questions.length} questions`} only you can answer: ${report.missingRequired.slice(0, 4).join(' · ')}. Answer ${questions.length === 1 ? 'it' : 'them'} in the app; your answers are remembered for next time.`,
    answers: toAnswers(report),
    questions,
    keepOpen: true,
  };
}

/** Answers from memory / AI that you have not confirmed for this application. */
function toReview(report: FillReport, deps: ApplyDeps): PendingQuestion[] {
  if (!deps.reviewAnswers) return [];
  const done = new Set((deps.confirmed || []).map(normQuestion));
  return report.fields
    .filter((f) => f.filled && (f.source === 'saved' || f.source === 'ai') && !done.has(normQuestion(f.label)))
    .map((f) => ({ question: f.label, kind: f.kind, options: f.options, required: f.required, suggested: f.value, source: f.source as PendingQuestion['source'] }));
}

function reviewNeeded(questions: PendingQuestion[], report: FillReport): ApplyOutcome {
  return {
    status: 'needs_review',
    reason: `Before submitting, please check ${questions.length === 1 ? 'this answer' : `these ${questions.length} answers`} (from your saved answers or AI). Confirm or edit them in the app and the application continues.`,
    answers: toAnswers(report),
    questions,
    keepOpen: true,
  };
}

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

async function fillAll(frame: Frame | Page, fields: FieldInfo[], root: string | null, deps: ApplyDeps): Promise<FillReport> {
  const report = await fillFields(frame, fields, deps.engine, deps.files);
  // Forms often reveal follow-up questions after an answer; fill those too.
  const sig = (f: FieldInfo) => `${f.kind}|${f.label}|${f.name}`;
  const known = new Set(fields.map(sig));
  const more = (await scanFields(frame, root).catch(() => [])).filter((f) => !known.has(sig(f)));
  if (more.length) {
    const extra = await fillFields(frame, more, deps.engine, deps.files);
    report.fields.push(...extra.fields);
    report.missingRequired.push(...extra.missingRequired);
  }
  return report;
}

// Plain JavaScript run in the page: marks the form's own Submit / Next control (data-aca-btn) when the
// site's selectors are unusual (a styled <div role=button>, "Send application", "Apply" at the bottom…).
const FIND_BUTTON = String.raw`(want) => {
  document.querySelectorAll('[data-aca-btn]').forEach((n) => n.removeAttribute('data-aca-btn'));
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.disabled; };
  const text = (el) => ((el.innerText || el.value || '') + ' ' + (el.getAttribute('aria-label') || '')).replace(/\s+/g, ' ').trim();
  const re = want === 'submit'
    ? /^(submit|send|apply|finish|complete)( (my |your )?(application|now|for this (job|position|role)))?\b/i
    : /^(next|continue|save (and|&) (continue|next)|proceed)\b/i;
  const skip = /linkedin|indeed|google|facebook|sign in|log ?in|register|save for later|search|filter|subscribe|newsletter|cookie|accept all/i;
  const els = [...document.querySelectorAll('button, input[type=submit], input[type=button], a[role=button], [role=button]')].filter((el) => visible(el) && re.test(text(el)) && !skip.test(text(el)));
  if (!els.length) return false;
  // Prefer one inside a form, then the last on the page (form footers sit below the "Apply" header buttons).
  const inForm = els.filter((el) => el.closest('form'));
  const list = inForm.length ? inForm : els;
  list[list.length - 1].setAttribute('data-aca-btn', want);
  return true;
}`;

async function findButton(frame: Frame | Page, selectors: string[], want: 'submit' | 'next'): Promise<Locator | null> {
  for (const s of selectors) {
    const loc = frame.locator(s).filter({ visible: true }).first();
    if (await loc.isVisible().catch(() => false)) return loc;
  }
  const found = await frame.evaluate(`(${FIND_BUTTON})(${JSON.stringify(want)})`).catch(() => false);
  return found ? frame.locator(`[data-aca-btn="${want}"]`).first() : null;
}

/** Upload widgets with no file input until clicked ("Upload resume", "Attach CV", drop zones): answer the file chooser. */
async function uploadViaChooser(page: Page, frame: Frame | Page, deps: ApplyDeps): Promise<boolean> {
  const trigger = frame
    .locator('button, a, label, [role=button], div[class*="upload" i], div[class*="drop" i]')
    .filter({ hasText: /(upload|attach|choose|select|browse|drop|add).{0,25}(resume|résumé|\bcv\b|file)|(resume|\bcv\b).{0,25}(upload|attach|browse)/i })
    .filter({ visible: true })
    .last();
  if (!(await trigger.isVisible().catch(() => false))) return false;
  try {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 6000 }), trigger.click({ timeout: 5000 })]);
    await chooser.setFiles(deps.files.resume);
    deps.log(`Uploaded the tailored resume (${path.basename(deps.files.resume)}).`);
    await page.waitForTimeout(2000);
    return true;
  } catch {
    return false;
  }
}

async function submitAndConfirm(page: Page, frame: Frame | Page, report: FillReport, submitSelectors: string[], deps: ApplyDeps): Promise<ApplyOutcome> {
  const button = await findButton(frame, submitSelectors, 'submit');
  if (!button) return attention('Filled the form but could not find its Submit button. Please submit it in the open tab.', report);
  await button.scrollIntoViewIfNeeded().catch(() => undefined);
  await button.click({ timeout: 10_000 }).catch(() => undefined);
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

const NEXT_SELECTORS = ['button:has-text("Save and continue")', 'button:has-text("Save & continue")', 'button:has-text("Next")', 'button:has-text("Continue")'];

/** Fill-and-submit for application forms (Greenhouse, Lever, Ashby, most career sites), including multi-page ones. */
async function applyForm(page: Page, task: ApplyTask, deps: ApplyDeps, opts: { root?: string | null; open?: string[]; submit: string[]; where: string }): Promise<ApplyOutcome> {
  await waitSettled(page);
  let { frame, fields } = await formFrame(page, opts.root ?? null);
  for (let attempt = 0; fields.length < 2 && attempt < 2; attempt++) {
    if (opts.open?.length && (await clickFirst(page, opts.open))) {
      deps.log('Opened the application form.');
      await waitSettled(page);
    } else {
      // Single-page apps (Keka, Darwinbox, …) render the job and its form late.
      await page.waitForTimeout(4000);
    }
    ({ frame, fields } = await formFrame(page, opts.root ?? null));
  }
  if (await captchaVisible(page)) return attention('The site is showing a CAPTCHA / “verify you are human” check. Solve it in the open tab, then retry.');
  if (fields.length < 2) return attention('Could not find an application form on this page. It is open for you to apply manually.');
  const all: FillReport = { fields: [], missingRequired: [] };
  let uploaded = false;
  for (let step = 0; step < 8; step++) {
    deps.log(`Found ${fields.length} form fields${step ? ` on page ${step + 1}` : ''}.`);
    const report = await fillAll(frame, fields, opts.root ?? null, deps);
    all.fields.push(...report.fields);
    all.missingRequired.push(...report.missingRequired);
    uploaded ||= report.fields.some((f) => f.kind === 'file' && f.filled && !!f.value);
    if (!uploaded && (await uploadViaChooser(page, frame, deps))) {
      uploaded = true;
      // The upload may have answered a required "Resume" question.
      const left = (await scanFields(frame, opts.root ?? null).catch(() => [] as FieldInfo[])).filter((f) => f.kind === 'file' && f.required && !f.value).map((f) => f.label);
      all.missingRequired = all.missingRequired.filter((q) => !/resume|\bcv\b/i.test(q) || left.includes(q));
    }
    deps.log(`Filled ${report.fields.filter((f) => f.filled).length} fields${all.missingRequired.length ? `; ${all.missingRequired.length} required question(s) need you` : ''}.`);
    if (all.missingRequired.length) return inputNeeded(all, opts.where);
    const submit = await findButton(frame, opts.submit, 'submit');
    const next = submit ? null : await findButton(frame, NEXT_SELECTORS, 'next');
    if (next) {
      const pageText = () => frame.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 3000)).catch(() => '');
      const before = await pageText();
      await next.click({ timeout: 8000 }).catch(() => undefined);
      await waitSettled(page, 1200);
      const after = await scanFields(frame, opts.root ?? null).catch(() => [] as FieldInfo[]);
      // Same content after Next = the page did not change (usually a validation error).
      if ((await pageText()) === before) {
        const errs = await validationErrors(frame);
        return attention(errs.length ? `The form did not move to the next page: ${errs.join(' · ').slice(0, 300)}` : 'The form did not move to the next page. It is open for you to finish.', all);
      }
      fields = after;
      continue;
    }
    const review = toReview(all, deps);
    if (review.length) return reviewNeeded(review, all);
    if (!task.submit) return { status: 'filled', reason: 'The form is filled in the open tab — check it and press Submit yourself, then click “Mark as applied”.', answers: toAnswers(all), keepOpen: true };
    return submitAndConfirm(page, frame, all, opts.submit, deps);
  }
  return attention('The form has more pages than expected. It is open for you to finish.', all);
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
    where: 'The Greenhouse form',
    open: ['button:has-text("Apply")', 'a:has-text("Apply for this job")', 'a:has-text("Apply")'],
    submit: ['#submit_app', 'button[type="submit"]:has-text("Submit")', 'button:has-text("Submit application")', 'input[type="submit"]'],
  });

const lever = (page: Page, task: ApplyTask, deps: ApplyDeps) =>
  applyForm(page, task, deps, {
    where: 'The Lever form',
    root: '#application-form, form[action*="apply"]',
    open: ['a:has-text("Apply for this job")', 'a.postings-btn:has-text("Apply")'],
    submit: ['#btn-submit', 'button[type="submit"]:has-text("Submit")', 'button:has-text("Submit application")'],
  });

const ashby = (page: Page, task: ApplyTask, deps: ApplyDeps) =>
  applyForm(page, task, deps, {
    where: 'The Ashby form',
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
    where: 'The application form',
    open: ['a:has-text("Apply now")', 'button:has-text("Apply now")', 'a:has-text("Apply for this")', 'button:has-text("Apply for this")', 'a:has-text("Apply")', 'button:has-text("Apply")'],
    submit: ['button[type="submit"]:has-text("Submit")', 'button:has-text("Submit application")', 'button:has-text("Submit")', 'input[type="submit"]', 'button:has-text("Apply")'],
  });

// ------------------------------------------------------------------ Google Forms / Microsoft Forms

const FORM_DONE = /your response has been recorded|your response was submitted|thanks!? your response|thank you for (your )?(response|submission)|response (was )?recorded/i;

/** Google Forms file questions open Google's picker (needs your Google login); upload through its "Browse" file chooser. */
async function googleFormsUpload(page: Page, deps: ApplyDeps): Promise<'none' | 'uploaded' | 'failed'> {
  const buttons = page.locator('[role="listitem"] [role="button"]:has-text("Add file")');
  const count = await buttons.count().catch(() => 0);
  if (!count) return 'none';
  for (let i = 0; i < count; i++) {
    const item = buttons.nth(i).locator('xpath=ancestor::*[@role="listitem"][1]');
    const title = ((await item.locator('[role="heading"]').first().innerText().catch(() => '')) || '').toLowerCase();
    const file = /cover/.test(title) ? await deps.files.cover() : deps.files.resume;
    if (!file) continue;
    try {
      await buttons.nth(i).click({ timeout: 8000 });
      const picker = page.frameLocator('iframe[src*="docs.google.com/picker"], iframe[src*="/picker/"]');
      const browse = picker.getByRole('button', { name: /browse/i });
      await browse.waitFor({ timeout: 20_000 });
      const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 20_000 }), browse.click()]);
      await chooser.setFiles(file);
      await picker.getByRole('button', { name: /^(upload|insert|select)$/i }).first().click({ timeout: 8000 }).catch(() => undefined);
      await item.getByText(path.basename(file), { exact: false }).waitFor({ timeout: 60_000 });
      deps.log(`Uploaded ${path.basename(file)} to “${title.slice(0, 60)}”.`);
    } catch {
      return 'failed';
    }
  }
  return 'uploaded';
}

async function formsApp(page: Page, task: ApplyTask, deps: ApplyDeps, kind: 'google' | 'microsoft'): Promise<ApplyOutcome> {
  await waitSettled(page, 2000);
  const where = kind === 'google' ? 'The Google Form' : 'The Microsoft Form';
  if (/accounts\.google\.com|login\.microsoftonline\.com|login\.live\.com/.test(page.url())) {
    return attention(`${where} requires signing in. Settings → Automation browser → Open ${kind === 'google' ? 'Google' : 'the link'} and sign in once, then retry.`);
  }
  const all: FillReport = { fields: [], missingRequired: [] };
  const next = kind === 'google' ? ['[role="button"]:has-text("Next")'] : ['button[data-automation-id="nextButton"]', 'button:has-text("Next")'];
  const submit = kind === 'google' ? ['[role="button"]:has-text("Submit")'] : ['button[data-automation-id="submitButton"]', 'button:has-text("Submit")'];
  for (let pageNo = 0; pageNo < 12; pageNo++) {
    const fields = await scanFields(page, null).catch(() => []);
    const report = await fillFields(page, fields, deps.engine, deps.files);
    all.fields.push(...report.fields);
    all.missingRequired.push(...report.missingRequired);
    if (kind === 'google') {
      const up = await googleFormsUpload(page, deps);
      if (up === 'failed') return attention(`${where} has a file-upload question. Google needs you to sign in and pick the file: upload your tailored resume (Download PDF in the app) in the open tab, then submit.`, all);
    } else if (await page.locator('button:has-text("Upload file")').first().isVisible().catch(() => false)) {
      return attention(`${where} has a file-upload question that needs your Microsoft login: upload your tailored resume (Download PDF in the app) in the open tab, then submit.`, all);
    }
    if (report.missingRequired.length) return inputNeeded(all, where);
    const submitBtn = page.locator(submit.join(', ')).first();
    if (await submitBtn.isVisible().catch(() => false)) {
      const review = toReview(all, deps);
      if (review.length) return reviewNeeded(review, all);
      if (!task.submit) return { status: 'filled', reason: `${where} is filled — check it in the open tab and press Submit yourself.`, answers: toAnswers(all), keepOpen: true };
      await submitBtn.click();
      deps.log('Pressed Submit.');
      await waitSettled(page, 2500);
      const text = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
      if (FORM_DONE.test(text)) return { status: 'submitted', reason: '', answers: toAnswers(all), keepOpen: false };
      const errs = await validationErrors(page);
      return attention(errs.length ? `${where} did not accept the answers: ${errs.join(' · ').slice(0, 300)}` : `${where} did not confirm the submission. Check the open tab.`, all);
    }
    if (!(await clickFirst(page, next))) return attention(`${where} has no Next or Submit button that I could find. It is open for you.`, all);
    await waitSettled(page, 1200);
    const errs = await validationErrors(page);
    if (errs.some((e) => /required|this is a required question/i.test(e))) return attention(`${where} did not accept a page: ${errs.join(' · ').slice(0, 300)}`, all);
  }
  return attention(`${where} has more pages than expected. It is open for you to finish.`, all);
}

// ------------------------------------------------------------------ LinkedIn Easy Apply

const LI_DIALOG = 'div[role="dialog"]';

/** Resume step: upload this job's tailored PDF and select it (LinkedIn lists previously uploaded resumes as a radio list). */
async function linkedinResumeStep(page: Page, deps: ApplyDeps, uploaded: { done: boolean }): Promise<void> {
  const dialog = page.locator(LI_DIALOG).last();
  // Only on the step that shows the resume picker.
  if (!(await dialog.getByText(/upload resume|select or upload a resume/i).first().isVisible().catch(() => false))) return;
  const fileInput = dialog.locator('input[type="file"]').first();
  if (!(await fileInput.count().catch(() => 0))) return;
  const name = path.basename(deps.files.resume);
  if (!uploaded.done) {
    await fileInput.setInputFiles(deps.files.resume, { timeout: 15_000 });
    uploaded.done = true;
    deps.log(`Uploaded the tailored resume (${name}).`);
    await dialog.getByText(name.slice(0, 20), { exact: false }).first().waitFor({ timeout: 20_000 }).catch(() => undefined);
    await page.waitForTimeout(800);
  }
  // Select the uploaded file if LinkedIn did not do it automatically.
  const card = dialog.locator(`:is(label, div, li):has-text("${name.slice(0, 20).replace(/"/g, '')}")`).last();
  const radio = card.locator('input[type="radio"]').first();
  if ((await radio.count().catch(() => 0)) && !(await radio.isChecked().catch(() => true))) await radio.check({ force: true }).catch(() => card.click().catch(() => undefined));
}

/** Resume pickers (radio lists of file names) are handled by linkedinResumeStep, not by the question filler. */
const isResumePicker = (f: FieldInfo) => (f.kind === 'radio' || f.kind === 'file') && (/\bresume|\bcv\b/i.test(f.label) || f.options.some((o) => /\.(pdf|docx?)\b/i.test(o)));

/**
 * The job's own apply control (not the ones on other jobs in a list): "Easy Apply",
 * or "Apply" / "Apply on company website" (offsite). LinkedIn renders duplicates
 * (sticky header, hidden copies), so only visible ones count. The chosen element is
 * marked data-aca-apply="1".
 */
// Plain JavaScript executed in the page (a string, so tsx/esbuild never inject helpers such as __name into it).
const LI_APPLY_BUTTON = String.raw`() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const label = (el) => ((el.innerText || '') + ' ' + (el.getAttribute('aria-label') || '')).replace(/\s+/g, ' ').trim();
  // Controls inside the job list / similar-jobs cards belong to other jobs.
  const inOtherJob = (el) => !!el.closest('.jobs-search-results-list, .scaffold-layout__list, .job-card-container, .jobs-similar-jobs') || /JOB_DETAILS_SIMILAR_JOBS|\/jobs\/search/.test(el.getAttribute('href') || '');
  const all = [...document.querySelectorAll('button, a')].filter((el) => visible(el) && !inOtherJob(el));
  const easy = all.find((el) => /easy apply/i.test(label(el)));
  if (easy) { easy.setAttribute('data-aca-apply', '1'); return { kind: 'easy', href: null }; }
  const offsite = all.find((el) => {
    if (/save|share|alert|similar|premium/i.test(label(el))) return false;
    return el.classList.contains('jobs-apply-button') || /^apply\b/i.test((el.innerText || '').trim()) || /apply.*(company|website)|^apply to /i.test(el.getAttribute('aria-label') || '') || /externalApply|\/safety\/go/.test(el.getAttribute('href') || '');
  });
  if (offsite) {
    offsite.setAttribute('data-aca-apply', '1');
    const href = offsite.href || offsite.getAttribute('href');
    return { kind: 'offsite', href: href && /^https?:/.test(href) ? href : null };
  }
  return { kind: 'none', href: null };
}`;

async function linkedinApplyButton(page: Page): Promise<{ kind: 'easy' | 'offsite' | 'none'; href: string | null }> {
  // The job view can render a moment after load.
  await page.locator('.jobs-apply-button, button[aria-label*="Apply" i], a[aria-label*="Apply" i]').first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => undefined);
  return page.evaluate(`(${LI_APPLY_BUTTON})()`) as Promise<{ kind: 'easy' | 'offsite' | 'none'; href: string | null }>;
}

/** Job-site hosts: an "apply on company site" link that still points here has not left the portal yet. */
const PORTAL_HOSTS = { linkedin: /(^|\.)linkedin\.com$/i, naukri: /(^|\.)naukri\.com$/i, indeed: /(^|\.)indeed\.[a-z.]+$/i };

/**
 * Presses a portal's "Apply on company site" button and returns the company
 * application URL. The company page opens in a new tab (starting at
 * about:blank and passing through the portal's redirect), in the same tab, or
 * after a "Continue" dialog. Returns null when it never left the portal.
 */
async function followOffsite(page: Page, ctx: BrowserContext, button: Locator, portal: RegExp, href: string | null = null): Promise<string | null> {
  const off = (u: string) => {
    try {
      return /^https?:/.test(u) && !portal.test(new URL(u).hostname);
    } catch {
      return false;
    }
  };
  // The link already names the company page (e.g. LinkedIn's /safety/go/?url=…): no need to click.
  const direct = (h: string | null) => {
    if (!h) return null;
    try {
      const abs = new URL(h, page.url());
      if (off(abs.toString())) return abs.toString();
      const target = abs.searchParams.get('url') || abs.searchParams.get('redirect');
      return target && off(target) ? target : null;
    } catch {
      return null;
    }
  };
  const known = direct(href) || direct(await button.getAttribute('href').catch(() => null));
  if (known) return known;
  const popup = ctx.waitForEvent('page', { timeout: 12_000 }).catch(() => null);
  await button.click().catch(() => undefined);
  const dialog = page.locator('[role="dialog"] button:has-text("Continue"), [role="dialog"] a:has-text("Continue"), [role="dialog"] button:has-text("Apply"), [role="dialog"] a:has-text("Apply")').filter({ visible: true }).first();
  if (await dialog.isVisible({ timeout: 2500 }).catch(() => false)) await dialog.click().catch(() => undefined);
  const p2 = await popup;
  let url = '';
  if (p2) {
    await p2.waitForURL((u) => off(u.toString()), { timeout: 20_000 }).catch(() => undefined);
    url = p2.url();
    await p2.close().catch(() => undefined);
  } else {
    await page.waitForURL((u) => off(u.toString()), { timeout: 8000 }).catch(() => undefined);
    url = page.url();
  }
  return off(url) ? url : null;
}

async function linkedin(page: Page, task: ApplyTask, deps: ApplyDeps, ctx: BrowserContext): Promise<ApplyOutcome> {
  await waitSettled(page, 2500);
  const signedIn = await page.locator('.global-nav__me, [data-control-name="nav.settings"], img.global-nav__me-photo').first().isVisible().catch(() => false);
  if (/\/(login|authwall|checkpoint|uas\/login)/.test(page.url()) || (!signedIn && (await page.locator('a:has-text("Sign in"), button:has-text("Sign in")').first().isVisible().catch(() => false)))) {
    return attention('You are not logged in to LinkedIn in the automation browser. Settings → Automation browser → Open LinkedIn, log in once, then retry.');
  }
  const button = await linkedinApplyButton(page);
  if (button.kind !== 'easy') {
    const applied = await page.locator('text=/Applied \\d|Application submitted|You applied/i').first().isVisible().catch(() => false);
    if (applied) return { status: 'submitted', reason: 'LinkedIn shows this job as already applied.', answers: [], keepOpen: false };
    if (button.kind === 'offsite') {
      deps.log('This LinkedIn job applies on the company website: following its Apply button.');
      const url = await followOffsite(page, ctx, page.locator('[data-aca-apply="1"]'), PORTAL_HOSTS.linkedin, button.href);
      if (url) return { status: 'needs_attention', reason: 'Applies on the company site.', answers: [], redirectUrl: url, keepOpen: false };
      return attention('LinkedIn’s Apply button did not open the company’s application page. It is open for you to check.');
    }
    const closed = await page.locator('text=/No longer accepting applications/i').first().isVisible().catch(() => false);
    return attention(closed ? 'This LinkedIn job is no longer accepting applications.' : 'No Apply button was found on this LinkedIn job. It is open for you to check.');
  }
  const easy = page.locator('[data-aca-apply="1"]');
  await easy.click();
  deps.log('Opened LinkedIn Easy Apply.');
  await page.waitForSelector(LI_DIALOG, { timeout: 15_000 }).catch(() => undefined);
  const all: FillReport = { fields: [], missingRequired: [] };
  const uploaded = { done: false };
  let lastProgress = '';
  let sameStep = 0;
  for (let step = 0; step < 20; step++) {
    await page.waitForTimeout(1200);
    const dialog = page.locator(LI_DIALOG).last();
    await linkedinResumeStep(page, deps, uploaded);
    const fields = (await scanFields(page, LI_DIALOG).catch(() => [])).filter((f) => !isResumePicker(f));
    const report = await fillFields(page, fields, deps.engine, deps.files);
    all.fields.push(...report.fields);
    if (report.missingRequired.length) {
      all.missingRequired.push(...report.missingRequired);
      return inputNeeded(all, 'LinkedIn Easy Apply');
    }
    const submitBtn = dialog.locator('button[aria-label*="Submit application"], button:has-text("Submit application")').first();
    if (await submitBtn.isVisible().catch(() => false)) {
      // Do not follow the company on your behalf.
      const follow = dialog.locator('input[type="checkbox"][id*="follow"], input[type="checkbox"]:near(:text("Follow"))').first();
      if (await follow.isChecked().catch(() => false)) await follow.uncheck({ force: true }).catch(() => dialog.locator('label:has-text("Follow")').first().click().catch(() => undefined));
      const review = toReview(all, deps);
      if (review.length) return reviewNeeded(review, all);
      if (!task.submit) return { status: 'filled', reason: 'Easy Apply is filled up to the last step — review it in the open tab and press Submit yourself, then click “Mark as applied”.', answers: toAnswers(all), keepOpen: true };
      await submitBtn.click();
      deps.log('Pressed Submit application.');
      await page.waitForTimeout(3000);
      const sent = await page.locator('text=/application was sent|Application sent|Your application was submitted/i').first().isVisible().catch(() => false);
      await clickFirst(page, [`${LI_DIALOG} button:has-text("Done")`, `${LI_DIALOG} button[aria-label="Dismiss"]`]);
      return sent ? { status: 'submitted', reason: '', answers: toAnswers(all), keepOpen: false } : attention('Pressed Submit but LinkedIn did not confirm. Check the open tab.', all);
    }
    const next = dialog.locator('button[aria-label*="Continue to next step"], button[aria-label*="Review your application"], button:has-text("Review"), button:has-text("Next")').first();
    if (!(await next.isVisible().catch(() => false))) return attention('Easy Apply shows no Next / Review / Submit button. It is open for you to finish.', all);
    await next.click();
    await page.waitForTimeout(1300);
    const errs = (await dialog.locator('.artdeco-inline-feedback--error, [role="alert"]').allInnerTexts().catch(() => [])).map((e) => e.trim()).filter(Boolean);
    // Same visible content after pressing Next = the step did not change.
    const progress = (await dialog.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 600);
    if (progress === lastProgress) sameStep++;
    else sameStep = 0;
    lastProgress = progress;
    if (errs.length && sameStep >= 1) return attention(`LinkedIn did not accept a step: ${errs.join(' · ').slice(0, 300)}`, all);
    if (sameStep >= 2) return attention('Easy Apply did not move to the next step. It is open for you to check.', all);
    await humanPause(400, 900);
  }
  return attention('Easy Apply has more steps than expected. It is open for you to finish.', all);
}

// ------------------------------------------------------------------ Naukri

async function naukri(page: Page, task: ApplyTask, deps: ApplyDeps, ctx: BrowserContext): Promise<ApplyOutcome> {
  await waitSettled(page, 2000);
  if (/nlogin|login\.naukri/.test(page.url())) return attention('You are not logged in to Naukri in the automation browser. Settings → Automation browser → Open Naukri, log in once, then retry.');
  const already = await page.locator('button:text-is("Applied"), span:text-is("Applied"), #already-applied').first().isVisible().catch(() => false);
  if (already) return { status: 'submitted', reason: 'Naukri shows this job as already applied.', answers: [], keepOpen: false };
  const companySite = page.locator('#company-site-button, button:has-text("Apply on company site"), a:has-text("Apply on company site"), button:has-text("Apply on company website"), a:has-text("Apply on company website")').filter({ visible: true }).first();
  if (await companySite.isVisible().catch(() => false)) {
    deps.log('This Naukri job applies on the company website: following its button.');
    const url = await followOffsite(page, ctx, companySite, PORTAL_HOSTS.naukri);
    return url ? { status: 'needs_attention', reason: 'Applies on the company site.', answers: [], redirectUrl: url, keepOpen: false } : attention('Naukri’s “Apply on company site” did not open the company’s application page. It is open for you.');
  }
  const loginToApply = await page.locator('button:has-text("Login to apply"), a:has-text("Login to apply")').first().isVisible().catch(() => false);
  if (loginToApply) return attention('Naukri says “Login to apply”. Log in to Naukri in the automation browser (Settings), then retry.');
  if (!task.submit) return { status: 'filled', reason: 'Naukri applies in one click with your Naukri profile resume. Press “Apply” in the open tab yourself, then click “Mark as applied”.', answers: [], keepOpen: true };
  if (!(await clickFirst(page, ['#apply-button', 'button.apply-button', 'button:has-text("Apply")']))) {
    const walkIn = await page.evaluate(() => document.body?.innerText?.slice(0, 5000) || '').then((t) => /walk[- ]?in/i.test(t)).catch(() => false);
    return attention(walkIn ? 'This Naukri job is a walk-in interview: there is no online application. The details (date, venue) are in the open tab.' : 'Could not find Naukri’s Apply button. The job is open for you.');
  }
  deps.log('Pressed Apply on Naukri (Naukri sends your profile resume).');
  const answers: ApplicationAnswer[] = [];
  let lastQuestion = '';
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
    // Still the question just answered: wait for the chatbot's next message instead of answering twice.
    if (!question || question === lastQuestion) continue;
    const chips = page.locator('[class*="chatbot_Chip"], .chatbot_Chip, [class*="ssrc__radio-btn-container"] label');
    const options = (await chips.allInnerTexts().catch(() => [])).map((t) => t.trim()).filter(Boolean);
    const field: FieldInfo = { key: 'chat', kind: options.length ? 'radio' : 'text', label: question, name: '', required: true, options, value: '', autocomplete: '', placeholder: '', accept: '' };
    const a = await deps.engine.answer(field);
    if (!a || !a.confident || !a.value) {
      return { status: 'needs_input', reason: `Naukri’s application chatbot asks: “${question.slice(0, 200)}”. Answer it in the app (it is remembered), or in the open tab.`, answers, questions: [{ question, kind: field.kind, options, required: true, suggested: '', source: 'none' }], keepOpen: true };
    }
    // The answer must be one of the chips ("Yes" → "Yes, I can"); never click a guess.
    const chip = options.length ? bestOption(a.value, options) : null;
    if (options.length && !chip) {
      return { status: 'needs_input', reason: `Naukri’s application chatbot asks: “${question.slice(0, 200)}” and none of its choices matches your answer. Pick one in the app (it is remembered), or in the open tab.`, answers, questions: [{ question, kind: 'radio', options, required: true, suggested: '', source: 'none' }], keepOpen: true };
    }
    answers.push({ question, answer: chip || a.value, source: a.source, confident: true });
    lastQuestion = question;
    if (chip) await chips.nth(options.indexOf(chip)).click().catch(() => undefined);
    else {
      const input = page.locator('[class*="chatbot"] [contenteditable="true"], [class*="chatbot"] textarea, [class*="chatbot"] input[type="text"]').last();
      await input.fill(a.value, { timeout: 8000 }).catch(() => input.pressSequentially(a.value, { delay: 20, timeout: 15_000 }).catch(() => undefined));
    }
    await clickFirst(page, ['[class*="sendMsg"]', '[class*="chatbot"] button:has-text("Save")', '[class*="chatbot"] button:has-text("Submit")']);
  }
  const done = await page.evaluate(() => document.body?.innerText || '').then((t) => /you have successfully applied|successfully applied/i.test(t)).catch(() => false);
  return done ? { status: 'submitted', reason: '', answers, keepOpen: false } : attention('Naukri did not confirm the application. Check the open tab.', { fields: [], missingRequired: [] });
}

// ------------------------------------------------------------------ Indeed

async function indeed(page: Page, task: ApplyTask, deps: ApplyDeps, ctx: BrowserContext): Promise<ApplyOutcome> {
  await waitSettled(page, 2000);
  if (await captchaVisible(page)) return attention('Indeed is showing a Cloudflare “verify you are human” / “Additional verification required” check. Solve it in the open tab, then retry.');
  const gone = await page.evaluate(() => document.body?.innerText?.slice(0, 2000) || '').then((t) => /we can.t find this page|this job has expired|job has been removed|no longer available/i.test(t)).catch(() => false);
  if (gone) return { status: 'failed', reason: 'This Indeed job is no longer available (the posting was removed or expired).', answers: [], keepOpen: false };
  const applyBtn = page.locator('#indeedApplyButton, button:has-text("Apply now"), button[aria-label*="Apply now"]').filter({ visible: true }).first();
  if (!(await applyBtn.isVisible().catch(() => false))) {
    const ext = page
      .locator('button:has-text("Apply on company site"), a:has-text("Apply on company site"), button:has-text("Apply on company website"), a:has-text("Apply on company website"), [aria-label*="company site" i], #applyButtonLinkContainer a, #applyButtonLinkContainer button')
      .filter({ visible: true })
      .first();
    if (await ext.isVisible().catch(() => false)) {
      deps.log('This Indeed job applies on the company website: following its button.');
      const url = await followOffsite(page, ctx, ext, PORTAL_HOSTS.indeed);
      if (url) return { status: 'needs_attention', reason: 'Applies on the company site.', answers: [], redirectUrl: url, keepOpen: false };
      return attention('Indeed’s “Apply on company site” did not open the company’s application page. It is open for you.');
    }
    return attention('No “Apply now” button found on Indeed. The job is open for you.');
  }
  const popup = ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null);
  await applyBtn.click();
  const p2 = (await popup) || page;
  deps.onPage?.(p2);
  await waitSettled(p2, 2000);
  if (/secure\.indeed\.com\/auth|\/account\/login/.test(p2.url())) return attention('You are not logged in to Indeed in the automation browser. Settings → Automation browser → Open Indeed, log in once, then retry.');
  const all: FillReport = { fields: [], missingRequired: [] };
  for (let step = 0; step < 12; step++) {
    if (await captchaVisible(p2)) return attention('Indeed is showing a “verify you are human” check in the application. Solve it in the open tab.', all);
    const fields = await scanFields(p2, 'main').catch(() => []);
    const report = await fillFields(p2, fields, deps.engine, deps.files);
    all.fields.push(...report.fields);
    if (report.missingRequired.length) {
      all.missingRequired.push(...report.missingRequired);
      return inputNeeded(all, 'Indeed Apply');
    }
    const submitBtn = p2.locator('button:has-text("Submit your application"), button:has-text("Submit application")').first();
    if (await submitBtn.isVisible().catch(() => false)) {
      const review = toReview(all, deps);
      if (review.length) return reviewNeeded(review, all);
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

export type ApplierKind = 'greenhouse' | 'lever' | 'ashby' | 'workday' | 'linkedin' | 'naukri' | 'indeed' | 'google_forms' | 'microsoft_forms' | 'generic';

export function applierFor(url: string): ApplierKind {
  const u = new URL(url);
  if ((u.hostname === 'docs.google.com' && u.pathname.startsWith('/forms')) || u.hostname === 'forms.gle') return 'google_forms';
  if (/^forms\.(office|microsoft)\.com$/.test(u.hostname) || (u.hostname.endsWith('forms.office.com'))) return 'microsoft_forms';
  const site = siteOf(u);
  return site === 'other' ? 'generic' : site;
}

/** Runs the right flow for the job's apply link; follows one "apply on company site" redirect to a known form. */
export async function runApplier(ctx: BrowserContext, task: ApplyTask, deps: ApplyDeps): Promise<ApplyOutcome> {
  let url = task.applyUrl || task.jobUrl;
  for (let hop = 0; hop < 2; hop++) {
    const kind = deps.forceKind && hop === 0 ? deps.forceKind : applierFor(url);
    const target = kind === 'greenhouse' ? greenhouseFormUrl(url) : kind === 'lever' && !/\/apply\b/.test(url) ? `${url.replace(/\/$/, '')}/apply` : kind === 'ashby' && !/\/application\b/.test(url) ? `${url.replace(/\/$/, '')}/application` : url;
    // Apply links come from job pages (untrusted): never point the logged-in browser at private/internal addresses.
    if (!deps.allowPrivateHosts) {
      try {
        await assertPublicUrl(target);
      } catch {
        return { status: 'failed', reason: 'The apply link points to a private or invalid address, so it was not opened.', answers: [], keepOpen: false };
      }
    }
    deps.log(`Opening ${new URL(target).hostname} (${kind.replace('_', ' ')}).`);
    const page = await ctx.newPage();
    deps.onPage?.(page);
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
                      : kind === 'google_forms'
                        ? await formsApp(page, task, deps, 'google')
                        : kind === 'microsoft_forms'
                          ? await formsApp(page, task, deps, 'microsoft')
                          : await generic(page, task, deps);
    } catch (e) {
      outcome = attention(`The automation hit an error on this site: ${String((e as Error).message).split('\n')[0].slice(0, 200)}. The tab is open for you.`);
    }
    if (!outcome.keepOpen) await page.close().catch(() => undefined);
    else await page.bringToFront().catch(() => undefined);
    if (outcome.redirectUrl && hop === 0) {
      deps.log(`This job applies on another site: ${new URL(outcome.redirectUrl).hostname}.`);
      deps.onRedirect?.(outcome.redirectUrl);
      url = outcome.redirectUrl;
      continue;
    }
    return outcome;
  }
  return attention('The job redirected more than once. Please apply manually.');
}
