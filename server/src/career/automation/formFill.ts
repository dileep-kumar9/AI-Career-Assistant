import type { Frame, Page } from 'playwright-core';
import type { ApplicationAnswer } from '../../../../shared/careerTypes.js';
import { type AnswerEngine, type FieldInfo, bestOption } from './answers.js';
import { humanPause } from './browser.js';

/**
 * Generic application-form filler used by every applier.
 *
 * scanFields() runs inside the page and lists every visible field with the
 * question text a person would read next to it (label, legend, aria-label,
 * surrounding question container), whether it is required and its options.
 * fillFields() asks the AnswerEngine for each one and fills it with real
 * browser input events. Required fields without a truthful answer are
 * reported back instead of being guessed.
 */

// Plain JavaScript executed in the page (kept as a string so build tooling never rewrites it).
const SCAN = String.raw`(root) => {
  const scope = (root && document.querySelector(root)) || document;
  const txt = (n) => (n ? (n.innerText || n.textContent || '') : '').replace(/\s+/g, ' ').trim();
  const shown = (el) => {
    if (el.type === 'file') return !el.disabled;
    if (el.disabled || el.readOnly && el.type !== 'radio' && el.type !== 'checkbox' && el.getAttribute('role') !== 'combobox') return false;
    if (el.closest('[aria-hidden="true"],[hidden]')) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return true;
    // Custom-styled radios/checkboxes are often 0x0; their label is what people see.
    if (el.type === 'radio' || el.type === 'checkbox') { const l = el.closest('label') || (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')); return !!(l && l.getBoundingClientRect().width > 0); }
    return false;
  };
  const byIds = (ids) => ids.split(/\s+/).filter(Boolean).map((i) => txt(document.getElementById(i))).join(' ').trim();
  const ownLabel = (el) => {
    const lb = el.getAttribute('aria-labelledby'); if (lb) { const t = byIds(lb); if (t) return t; }
    if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l && txt(l)) return txt(l); }
    const wrap = el.closest('label');
    if (wrap) { const c = wrap.cloneNode(true); c.querySelectorAll('input,select,textarea,option,[role=listbox]').forEach((n) => n.remove()); const t = txt(c); if (t) return t; }
    return el.getAttribute('aria-label') || '';
  };
  const questionLabel = (el) => {
    const fs = el.closest('fieldset'); if (fs) { const lg = fs.querySelector('legend'); if (lg && txt(lg)) return txt(lg); }
    const g = el.closest('[role=radiogroup],[role=group]');
    if (g) { const lb = g.getAttribute('aria-labelledby'); if (lb) { const t = byIds(lb); if (t) return t; } if (g.getAttribute('aria-label')) return g.getAttribute('aria-label'); }
    // Google Forms (role=listitem + role=heading) and Microsoft Forms (questionItem + questionTitle).
    const item = el.closest('[role=listitem], [data-automation-id=questionItem]');
    if (item) { const h = item.querySelector('[role=heading], [data-automation-id=questionTitle]'); if (h && !h.contains(el)) { const c = h.cloneNode(true); c.querySelectorAll('[aria-label*="Required" i], [data-automation-id=requiredStar]').forEach((x) => x.remove()); if (txt(c)) return txt(c); } }
    let n = el.parentElement;
    for (let i = 0; i < 7 && n && n !== document.body; i++, n = n.parentElement) {
      const cands = n.querySelectorAll(':scope > label, :scope > legend, :scope > [class*=label], :scope > [class*=Label], :scope > [class*=question], :scope > [class*=title], :scope > h2, :scope > h3, :scope > h4, :scope > p, :scope > span, :scope > div > label');
      for (const c of cands) { if (c.contains(el)) continue; const t = txt(c); if (t && t.length < 500) return t; }
    }
    return '';
  };
  const requiredMark = (el) => { const item = el.closest('[role=listitem], [data-automation-id=questionItem]'); return !!(item && item.querySelector('[aria-label="Required question"], [aria-label*="Required" i], [data-automation-id=requiredStar]')); };
  const reqOf = (el, label) => !!(el.required || el.getAttribute('aria-required') === 'true' || /[*✱]\s*$/.test(label) || /\(required\)/i.test(label) || requiredMark(el));
  const out = [];
  // Keys are unique per scan: multi-page forms keep earlier (hidden) pages in the DOM.
  window.__acaScan = (window.__acaScan || 0) + 1;
  const prefix = 's' + window.__acaScan + 'f';
  let n = 0;
  const mark = (el, key, opt) => { el.setAttribute('data-aca-key', key); if (opt !== undefined) el.setAttribute('data-aca-opt', String(opt)); };
  const groups = new Map();
  const nodes = scope.querySelectorAll('input, select, textarea');
  for (const el of nodes) {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || (tag === 'input' ? 'text' : tag)).toLowerCase();
    if (['hidden', 'submit', 'button', 'image', 'reset', 'password', 'search'].includes(type)) continue;
    if (!shown(el)) continue;
    if (type === 'radio' || (type === 'checkbox' && el.name && scope.querySelectorAll('input[type=checkbox][name="' + CSS.escape(el.name) + '"]').length > 1)) {
      const gkey = type + ':' + (el.name || questionLabel(el));
      if (!groups.has(gkey)) { const key = prefix + (n++); const g = { key, kind: type === 'radio' ? 'radio' : 'checkboxGroup', label: questionLabel(el), name: el.name || '', required: false, options: [], value: '', autocomplete: '', placeholder: '', accept: '', els: [] }; groups.set(gkey, g); out.push(g); }
      const g = groups.get(gkey);
      const opt = ownLabel(el) || el.value;
      mark(el, g.key, g.options.length);
      g.options.push(opt);
      if (el.required || el.getAttribute('aria-required') === 'true') g.required = true;
      if (el.checked) g.value = g.value ? g.value + ', ' + opt : opt;
      continue;
    }
    const key = prefix + (n++);
    mark(el, key);
    const role = el.getAttribute('role');
    let kind = tag === 'select' ? 'select' : tag === 'textarea' ? 'textarea' : type === 'file' ? 'file' : type === 'checkbox' ? 'checkbox' : ['email', 'tel', 'url', 'number', 'date'].includes(type) ? type : 'text';
    if (role === 'combobox' || el.getAttribute('aria-autocomplete') === 'list') kind = 'combobox';
    let label = kind === 'checkbox' ? ownLabel(el) || questionLabel(el) : ownLabel(el) || questionLabel(el) || el.getAttribute('placeholder') || '';
    if (kind === 'checkbox' && label.length < 3) label = questionLabel(el) + ' ' + label;
    const options = tag === 'select' ? [...el.options].map((o) => o.text.trim()).filter((t) => t && !/^(select|choose|please select|--)/i.test(t)) : [];
    const value = tag === 'select' ? (el.selectedIndex > 0 ? (el.options[el.selectedIndex]?.text || '') : '') : kind === 'checkbox' ? (el.checked ? 'yes' : '') : kind === 'file' ? (el.files && el.files.length ? el.files[0].name : '') : el.value || '';
    out.push({ key, kind, label, name: el.name || el.id || '', required: reqOf(el, label), options, value, autocomplete: el.getAttribute('autocomplete') || '', placeholder: el.getAttribute('placeholder') || '', accept: el.getAttribute('accept') || '' });
  }
  // ARIA widgets that are not real inputs (Google Forms radios / checkboxes / dropdowns).
  const visible = (el) => { if (el.closest('[aria-hidden="true"]')) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  let gid = 0;
  const containerIds = new Map();
  for (const el of scope.querySelectorAll('[role=radio]:not(input), [role=checkbox]:not(input)')) {
    if (!visible(el)) continue;
    const isRadio = el.getAttribute('role') === 'radio';
    const container = el.closest(isRadio ? '[role=radiogroup]' : '[role=list], [role=group]') || el.closest('[role=listitem], [data-automation-id=questionItem]') || el.parentElement;
    if (!containerIds.has(container)) containerIds.set(container, 'g' + (gid++));
    const gkey = 'aria:' + (isRadio ? 'r:' : 'c:') + containerIds.get(container);
    if (!groups.has(gkey)) { const key = prefix + (n++); const g = { key, kind: isRadio ? 'radio' : 'checkboxGroup', label: questionLabel(el), name: '', required: requiredMark(el), options: [], value: '', autocomplete: '', placeholder: '', accept: '', els: [] }; groups.set(gkey, g); out.push(g); }
    const g = groups.get(gkey);
    const opt = (el.getAttribute('aria-label') || el.getAttribute('data-value') || el.getAttribute('data-answer-value') || txt(el)).trim();
    mark(el, g.key, g.options.length);
    g.options.push(opt);
    if (el.getAttribute('aria-checked') === 'true') g.value = g.value ? g.value + ', ' + opt : opt;
  }
  for (const el of scope.querySelectorAll('[role=listbox]')) {
    if (!visible(el) || el.closest('select')) continue;
    const opts = [...el.querySelectorAll('[role=option]')].map((o) => (o.getAttribute('data-value') ?? txt(o)).trim()).filter((t) => t && !/^(choose|select)\b/i.test(t));
    if (!opts.length) continue;
    const key = prefix + (n++);
    mark(el, key);
    const sel = el.querySelector('[role=option][aria-selected=true]');
    const value = sel ? (sel.getAttribute('data-value') ?? txt(sel)).trim() : '';
    const label = questionLabel(el);
    out.push({ key, kind: 'listbox', label, name: '', required: reqOf(el, label), options: [...new Set(opts)], value: /^(choose|select)\b/i.test(value) ? '' : value, autocomplete: '', placeholder: '', accept: '' });
  }
  for (const g of groups.values()) {
    if (/[*✱]\s*$/.test(g.label) || /\(required\)/i.test(g.label)) g.required = true;
    // A single custom checkbox is a yes/no question.
    if (g.kind === 'checkboxGroup' && g.options.length === 1) { g.kind = 'checkbox'; g.label = (g.label + ' ' + g.options[0]).trim(); g.value = g.value ? 'yes' : ''; }
    delete g.els;
  }
  return out.map((f) => ({ ...f, label: f.label.replace(/\s*[*✱]\s*$/, '').replace(/\s*\(required\)\s*/i, ' ').trim().slice(0, 600) }));
}`;

export async function scanFields(frame: Frame | Page, root: string | null = null): Promise<FieldInfo[]> {
  return frame.evaluate(`(${SCAN})(${JSON.stringify(root)})`) as Promise<FieldInfo[]>;
}

export interface FilledField {
  label: string;
  kind: FieldInfo['kind'];
  options: string[];
  required: boolean;
  value: string;
  source: ApplicationAnswer['source'] | 'prefilled';
  confident: boolean;
  filled: boolean;
  error?: string;
}

export interface FillReport {
  fields: FilledField[];
  /** Required questions the agent could not answer truthfully. */
  missingRequired: string[];
}

export interface FillFiles {
  resume: string;
  cover: () => Promise<string | null>;
}

/** Ticks a real checkbox, or clicks an ARIA checkbox (div role=checkbox) that is not checked yet. */
async function tick(loc: ReturnType<Page['locator']>) {
  const isInput = await loc.evaluate((el) => el.tagName === 'INPUT').catch(() => false);
  if (isInput) return loc.check({ force: true, timeout: 8000 });
  if ((await loc.getAttribute('aria-checked').catch(() => null)) !== 'true') await loc.click({ timeout: 8000 });
}

const sel = (key: string, opt?: number) => `[data-aca-key="${key}"]${opt === undefined ? '' : `[data-aca-opt="${opt}"]`}`;

async function pickComboboxOption(frame: Frame | Page, key: string, value: string): Promise<boolean> {
  const input = frame.locator(sel(key)).first();
  await input.click({ timeout: 5000 }).catch(() => undefined);
  await input.fill('').catch(() => undefined);
  await input.pressSequentially(value.slice(0, 60), { delay: 25 }).catch(() => undefined);
  await frame.waitForTimeout(700);
  const options = frame.locator('[role="option"]:visible');
  const texts = (await options.allInnerTexts().catch(() => [])).map((t) => t.trim());
  const best = bestOption(value, texts);
  if (best) {
    await options.nth(texts.indexOf(best)).click({ timeout: 5000 }).catch(() => undefined);
    return true;
  }
  await input.press('Escape').catch(() => undefined);
  return false;
}

/** Fills every field it can answer truthfully; returns what it did and what it could not answer. */
export async function fillFields(frame: Frame | Page, fields: FieldInfo[], engine: AnswerEngine, files: FillFiles): Promise<FillReport> {
  const report: FillReport = { fields: [], missingRequired: [] };
  for (const f of fields) {
    const entry: FilledField = { label: f.label || f.name || '(unlabelled field)', kind: f.kind, options: f.options, required: f.required, value: '', source: 'rule', confident: false, filled: false };
    const prefilled = f.value && f.kind !== 'file' && f.kind !== 'checkbox' && !/^(select|choose)/i.test(f.value);
    if (prefilled) {
      report.fields.push({ ...entry, value: f.value, source: 'prefilled', confident: true, filled: true });
      continue;
    }
    const a = await engine.answer(f);
    if (!a || !a.confident || (!a.value && !a.file)) {
      if (f.required) report.missingRequired.push(entry.label);
      report.fields.push(entry);
      continue;
    }
    entry.value = a.file ? (a.file === 'resume' ? 'Tailored resume (PDF)' : 'Cover letter (PDF)') : a.value;
    entry.source = a.source;
    entry.confident = true;
    const loc = frame.locator(sel(f.key)).first();
    try {
      switch (f.kind) {
        case 'file': {
          const path = a.file === 'cover' ? await files.cover() : files.resume;
          if (!path) throw new Error('No file to upload.');
          await loc.setInputFiles(path, { timeout: 15_000 });
          break;
        }
        case 'select':
          await loc.selectOption({ label: a.value }, { timeout: 8000 });
          break;
        case 'radio': {
          const idx = f.options.indexOf(a.value);
          if (idx < 0) throw new Error('Option not found.');
          const opt = frame.locator(sel(f.key, idx)).first();
          await opt.check({ force: true, timeout: 8000 }).catch(async () => {
            await opt.evaluate((el: any) => el.closest('label')?.click() ?? el.click());
          });
          break;
        }
        case 'checkbox':
          if (a.value === 'yes') await tick(loc);
          break;
        case 'checkboxGroup':
          for (const v of a.value.split(/,\s*/)) {
            const idx = f.options.indexOf(v);
            if (idx >= 0) await tick(frame.locator(sel(f.key, idx)).first());
          }
          break;
        case 'combobox':
          if (!(await pickComboboxOption(frame, f.key, a.value))) throw new Error('No matching option in the list.');
          break;
        case 'listbox': {
          // Custom dropdown (e.g. Google Forms): open it, then click the option.
          await loc.click({ timeout: 8000 });
          await frame.waitForTimeout(500);
          const option = frame.locator(`[role="option"][data-value="${a.value.replace(/"/g, '\\"')}"]:visible`).first();
          if (await option.isVisible().catch(() => false)) await option.click({ timeout: 5000 });
          else await frame.locator('[role="option"]:visible').filter({ hasText: a.value }).first().click({ timeout: 5000 });
          break;
        }
        case 'date':
          if (!/^\d{4}-\d{2}-\d{2}$/.test(a.value)) throw new Error('Date is not in YYYY-MM-DD format.');
          await loc.fill(a.value, { timeout: 8000 });
          break;
        default:
          await loc.fill(a.value, { timeout: 8000 });
      }
      entry.filled = true;
    } catch (e) {
      entry.error = String((e as Error).message).split('\n')[0].slice(0, 160);
      if (f.required) report.missingRequired.push(entry.label);
    }
    report.fields.push(entry);
    await humanPause(120, 380);
  }
  return report;
}

// ------------------------------------------------------------------ page state checks

export const SUCCESS_TEXT =
  /(thank(s| you) for (applying|your (application|interest|submission))|application (has been |was )?(submitted|received|sent|complete)|we('|’)ve received your application|your application (has been|was) (sent|submitted|received)|successfully applied|you have successfully applied|application submitted)/i;

export async function pageSaysSubmitted(page: Page): Promise<boolean> {
  if (/\/(thanks|thank-you|confirmation|submitted|success)\b/i.test(page.url())) return true;
  const text = await page.evaluate(() => document.body?.innerText?.slice(0, 20_000) || '').catch(() => '');
  return SUCCESS_TEXT.test(text);
}

/** A CAPTCHA challenge the user must solve (invisible reCAPTCHA badges don't count). */
export async function captchaVisible(page: Page): Promise<boolean> {
  for (const f of page.frames()) {
    const u = f.url();
    if (/recaptcha\/(api2|enterprise)\/bframe|hcaptcha\.com.*(frame=challenge|#frame=challenge)|challenges\.cloudflare\.com/.test(u)) {
      const el = await f.frameElement().catch(() => null);
      const box = await el?.boundingBox().catch(() => null);
      if (box && box.height > 80 && box.width > 80) return true;
    }
  }
  const text = await page.evaluate(() => document.body?.innerText?.slice(0, 3000) || '').catch(() => '');
  return /verify you are (a )?human|are you a robot|complete the security check|press (&|and) hold/i.test(text);
}

/** Visible validation messages after a submit attempt. */
export async function validationErrors(page: Page | Frame): Promise<string[]> {
  return page
    .evaluate(() => {
      const out = new Set<string>();
      document.querySelectorAll('[role="alert"], .error, .errors, .field-error, .error-message, [class*="error" i]:not(input):not(form):not(body), [aria-live="assertive"]').forEach((n) => {
        const el = n as HTMLElement;
        const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
        const r = el.getBoundingClientRect();
        if (t && t.length < 300 && r.width > 0 && r.height > 0) out.add(t);
      });
      return [...out].slice(0, 8);
    })
    .catch(() => []);
}

export async function clickFirst(page: Page | Frame, candidates: string[], timeout = 5000): Promise<boolean> {
  for (const s of candidates) {
    const loc = page.locator(s).first();
    if (await loc.isVisible().catch(() => false)) {
      await loc.scrollIntoViewIfNeeded().catch(() => undefined);
      await loc.click({ timeout }).catch(() => undefined);
      return true;
    }
  }
  return false;
}
