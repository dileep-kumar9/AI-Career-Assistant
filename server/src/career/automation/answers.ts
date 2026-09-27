import type { ApplicationAnswer, CareerProfile } from '../../../../shared/careerTypes.js';
import type { AIChain } from '../../ai/provider.js';
import { answerQuestion, runPrompt } from '../../ai/prompts/index.js';
import { normQuestion, profileToText } from '../profile.js';

/**
 * Decides what to enter in one application-form field, truthfully.
 * Order: profile rules → saved answers → AI (only when your resume/profile
 * supports it) → unanswered. Unanswered required fields make the job
 * "Needs attention" — the agent never guesses.
 */

export type FieldKind = 'text' | 'email' | 'tel' | 'url' | 'number' | 'date' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'checkboxGroup' | 'combobox' | 'file';

export interface FieldInfo {
  key: string;
  kind: FieldKind;
  label: string;
  name: string;
  required: boolean;
  options: string[];
  value: string;
  autocomplete: string;
  placeholder: string;
  accept: string;
}

export interface AnswerContext {
  profile: CareerProfile;
  resumeText: string;
  /** Employers in the resume, for "Have you worked for X before?". */
  employers: string[];
  job: { title: string; company: string; description: string; source: string };
  coverLetter: () => Promise<string>;
  wantCoverLetter: boolean;
  ai: AIChain | null;
}

export interface FieldAnswer {
  /** Text to type, option to choose, "yes"/"no" for a checkbox, comma list for checkbox groups. */
  value: string;
  source: ApplicationAnswer['source'];
  confident: boolean;
  /** file fields: which document to upload */
  file?: 'resume' | 'cover';
}

const DECLINE = /decline|prefer not|don.?t wish|do not wish|not to (say|disclose|answer|self.?identify)|rather not|choose not/i;
const YES = /^(yes|y|true|i do|i am|i have)\b/i;
const NO = /^(no|n|false|i do not|i don.?t|i am not)\b/i;

const clean = (s: string) => s.replace(/\s+/g, ' ').replace(/\s*\*\s*$/, '').trim();
const has = (label: string, re: RegExp) => re.test(label);

/** Best option for an answer: exact → startsWith → contains → word overlap. */
export function bestOption(answer: string, options: string[]): string | null {
  const a = answer.toLowerCase().trim();
  if (!a || !options.length) return null;
  const opts = options.map((o) => ({ o, l: o.toLowerCase().trim() })).filter((x) => x.l && !/^(select|choose|please select|--)/.test(x.l));
  const exact = opts.find((x) => x.l === a);
  if (exact) return exact.o;
  if (YES.test(a)) return opts.find((x) => YES.test(x.l))?.o ?? null;
  if (NO.test(a)) return opts.find((x) => NO.test(x.l))?.o ?? null;
  const starts = opts.find((x) => x.l.startsWith(a) || a.startsWith(x.l));
  if (starts) return starts.o;
  const contains = opts.find((x) => x.l.includes(a) || a.includes(x.l));
  if (contains) return contains.o;
  const words = new Set(a.split(/[^a-z0-9+#]+/).filter((w) => w.length > 2));
  let best: { o: string; n: number } | null = null;
  for (const x of opts) {
    const n = x.l.split(/[^a-z0-9+#]+/).filter((w) => words.has(w)).length;
    if (n > 0 && (!best || n > best.n)) best = { o: x.o, n };
  }
  return best?.o ?? null;
}

const yesNo = (v: boolean | null): string | null => (v === null ? null : v ? 'Yes' : 'No');

function nameParts(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  return { first: parts[0] || '', last: parts.length > 1 ? parts.slice(1).join(' ') : '' };
}

/** Deterministic answers from the Career Profile (and resume facts for a few questions). */
export function ruleAnswer(f: FieldInfo, ctx: AnswerContext): FieldAnswer | null {
  const p = ctx.profile;
  const label = clean(`${f.label} ${f.name} ${f.autocomplete} ${f.placeholder}`).toLowerCase();
  const ok = (value: string | null | undefined, source: FieldAnswer['source'] = 'profile'): FieldAnswer | null => (value ? { value, source, confident: true } : null);
  const { first, last } = nameParts(p.basics.fullName);

  if (f.kind === 'file') {
    if (has(label, /cover/)) return ctx.wantCoverLetter ? { value: 'cover letter', source: 'rule', confident: true, file: 'cover' } : null;
    if (has(label, /resume|cv\b|curriculum/) || (!has(label, /photo|picture|image|transcript|portfolio|sample/) && f.required)) return { value: 'resume', source: 'rule', confident: true, file: 'resume' };
    return null;
  }

  // Voluntary self-identification: your saved value, else "decline".
  const diversity: Array<[RegExp, keyof CareerProfile['diversity']]> = [
    [/\bgender\b|\bsex\b|pronoun/, 'gender'],
    [/race|ethnic|hispanic|latino/, 'ethnicity'],
    [/veteran|military|armed forces/, 'veteran'],
    [/disabilit/, 'disability'],
  ];
  for (const [re, key] of diversity) {
    if (has(label, re) && ['select', 'radio', 'combobox'].includes(f.kind)) {
      const own = p.diversity[key] && bestOption(p.diversity[key], f.options);
      const decline = f.options.find((o) => DECLINE.test(o));
      if (own) return { value: own, source: 'profile', confident: true };
      if (decline) return { value: decline, source: 'rule', confident: true };
      return null;
    }
  }

  // Consent / acknowledgement checkboxes: tick when required; never opt in to marketing.
  if (f.kind === 'checkbox') {
    if (has(label, /newsletter|marketing|promotional|sms|text message|whatsapp|job alerts?|talent (community|network)|future (roles|opportunities)/)) return { value: 'no', source: 'rule', confident: true };
    if (has(label, /privacy|terms|consent|acknowledg|certify|attest|agree|accurate|true and complete|gdpr|data (processing|protection)/)) return f.required ? { value: 'yes', source: 'rule', confident: true } : { value: 'no', source: 'rule', confident: true };
  }

  if (has(label, /first.?name|given.?name|fname/) && !has(label, /last/)) return ok(first);
  if (has(label, /last.?name|surname|family.?name|lname/)) return ok(last);
  if (has(label, /preferred.?name|nick.?name/)) return ok(first);
  if (has(label, /\b(full.?name|your name|^name|legal name)\b/) || label === 'name') return ok(p.basics.fullName);
  if (f.kind === 'email' || has(label, /e-?mail/)) return ok(p.basics.email);
  if (f.kind === 'tel' || has(label, /phone|mobile|contact number|cell/)) return ok(p.basics.phone);
  if (has(label, /linkedin/)) return ok(p.basics.linkedin);
  if (has(label, /github/)) return ok(p.basics.github);
  if (has(label, /portfolio|personal (web)?site|website|blog/) && f.kind !== 'checkbox') return ok(p.basics.portfolio || p.basics.github || p.basics.linkedin);
  if (has(label, /\bcity\b|town/)) return ok(p.basics.city);
  if (has(label, /\bcountry\b/) && !has(label, /authori[sz]|eligible|legally|citizen/)) return ok(p.basics.country);
  if (has(label, /current location|where are you (located|based)|^location$|your location|address/) && !has(label, /relocat/)) return ok([p.basics.city, p.basics.country].filter(Boolean).join(', '));
  if (has(label, /current (company|employer)|present (company|employer)|most recent (company|employer)/)) return ok(p.career.currentCompany);
  if (has(label, /current (job )?title|current (role|position|designation)/)) return ok(p.career.currentTitle);
  if (has(label, /notice period|when can you (join|start)|availability to join/)) return ok(p.career.noticePeriod || p.career.earliestStart);
  if (has(label, /start date|earliest (start|date)|available to start|availability/)) return ok(p.career.earliestStart || p.career.noticePeriod);
  if (has(label, /current (ctc|salary|compensation|pay)|present (ctc|salary)/)) return ok(p.career.currentSalary);
  if (has(label, /expected (ctc|salary|compensation|pay)|salary expectation|desired (salary|compensation|pay)|compensation expectation|salary requirement/)) return ok(p.career.expectedSalary);
  if (has(label, /total (years of )?(work |professional )?experience|years of (professional |relevant |work |total )?experience\??$|how many years of experience do you have\??$/) && p.career.yearsExperience !== null) {
    return ok(String(Math.floor(p.career.yearsExperience)));
  }
  if (has(label, /sponsor/)) return ok(yesNo(p.authorization.needsSponsorship));
  if (has(label, /relocat/)) return ok(yesNo(p.authorization.willingToRelocate));
  if (has(label, /authori[sz]ed to work|legally (authori[sz]ed|eligible|able) to work|eligib\w* to work|right to work|work permit/)) {
    const countries = p.authorization.countries.map((c) => c.toLowerCase());
    if (!countries.length) return null;
    const mentioned = countries.find((c) => label.includes(c));
    if (mentioned) return ok('Yes');
    const namesCountry = /\b(in|for) (the )?[a-z]+/i.test(f.label) && /(united|india|canada|germany|kingdom|states|australia|singapore|ireland|uk|us|usa|eu)\b/i.test(f.label);
    return namesCountry ? ok('No') : ok(countries.length ? 'Yes' : null);
  }
  if (has(label, /how did you (hear|find|learn)|where did you (hear|find|see)|source of (application|referral)|referral source/)) {
    const via = ctx.job.source === 'linkedin' ? 'LinkedIn' : ctx.job.source === 'naukri' ? 'Naukri' : ctx.job.source === 'indeed' ? 'Indeed' : 'Company website';
    return f.options.length ? ok(bestOption(via, f.options) || bestOption('job board', f.options) || bestOption('other', f.options)) : ok(via);
  }
  if (has(label, /(previously|ever|before) (been )?(worked|employed)|former employee|worked (for|at) .* before/)) {
    const company = ctx.job.company.toLowerCase();
    const worked = !!company && ctx.employers.some((e) => e.toLowerCase().includes(company) || company.includes(e.toLowerCase()));
    return ok(worked ? 'Yes' : 'No', 'rule');
  }
  return null;
}

function savedAnswer(f: FieldInfo, p: CareerProfile): FieldAnswer | null {
  const key = normQuestion(f.label);
  if (!key) return null;
  const words = new Set(key.split(' ').filter((w) => w.length > 2));
  for (const a of p.savedAnswers) {
    const k = normQuestion(a.question);
    if (k === key) return { value: a.answer, source: 'saved', confident: true };
    const other = k.split(' ').filter((w) => w.length > 2);
    const overlap = other.filter((w) => words.has(w)).length;
    if (other.length >= 3 && words.size >= 3 && overlap / Math.max(words.size, other.length) >= 0.85) return { value: a.answer, source: 'saved', confident: true };
  }
  return null;
}

/** Makes an answer fit the field (option text, digits, yes/no). */
export function conform(f: FieldInfo, a: FieldAnswer): FieldAnswer {
  if (['select', 'radio', 'combobox'].includes(f.kind) && f.options.length) {
    const opt = bestOption(a.value, f.options);
    return opt ? { ...a, value: opt } : { ...a, confident: false };
  }
  if (f.kind === 'checkboxGroup') {
    const picks = a.value
      .split(/[,;\n]/)
      .map((v) => bestOption(v, f.options))
      .filter((v): v is string => !!v);
    return picks.length ? { ...a, value: [...new Set(picks)].join(', ') } : { ...a, confident: false };
  }
  if (f.kind === 'checkbox') return { ...a, value: YES.test(a.value) || a.value === 'yes' ? 'yes' : 'no' };
  if (f.kind === 'number') {
    const n = a.value.match(/-?\d+(\.\d+)?/);
    return n ? { ...a, value: n[0] } : { ...a, confident: false };
  }
  return a;
}

export class AnswerEngine {
  constructor(private ctx: AnswerContext) {}

  async answer(f: FieldInfo): Promise<FieldAnswer | null> {
    const rule = ruleAnswer(f, this.ctx);
    if (rule) return rule.file ? rule : conform(f, rule);
    const saved = savedAnswer(f, this.ctx.profile);
    if (saved) return conform(f, saved);
    if (f.kind === 'textarea' && /cover letter/i.test(f.label) && this.ctx.wantCoverLetter) {
      const text = await this.ctx.coverLetter().catch(() => '');
      return text ? { value: text, source: 'ai', confident: true } : null;
    }
    if (!f.label || f.kind === 'file') return null;
    if (!this.ctx.ai?.available) return null;
    try {
      const { data } = await runPrompt(this.ctx.ai, answerQuestion, {
        question: f.label,
        fieldType: f.kind === 'combobox' ? 'select' : f.kind === 'checkboxGroup' ? 'checkbox' : f.kind === 'email' || f.kind === 'tel' || f.kind === 'url' ? 'text' : f.kind,
        options: f.options,
        required: f.required,
        profile: profileToText(this.ctx.profile),
        resumeText: this.ctx.resumeText,
        job: this.ctx.job,
      });
      if (!data.confident || !data.answer.trim() || data.basis === 'none') return { value: '', source: 'ai', confident: false };
      return conform(f, { value: data.answer, source: 'ai', confident: true });
    } catch {
      return null;
    }
  }
}
