import { humanizeLine, humanizeProse } from '../../../shared/humanize.js';
import type { ResumeData, SkillCategory } from '../../../shared/resumeTypes.js';
import { ATS_TEMPLATE_IDS } from '../../../shared/resumeTypes.js';
import { ACTION_VERBS, LEXICON, type LexiconTerm } from '../../../shared/lexicon.js';
import { containsForm, findKeyword, significantTokens, stem } from '../../../shared/match.js';
import { LAB_CONTEXT, keywordEvidence } from '../../../shared/ats.js';
import { collectSkills, newId, normalizeResume, normalizeSections, normalizeStyle, resumeToPlainText, skillList } from '../../../shared/normalize.js';
import type { EditOutput, GenerateOutput } from '../ai/schemas.js';

/**
 * Deterministic guard applied to every AI response before it can become a
 * resume version. The AI proposes; this module decides what is allowed:
 *
 *  - identity/contact fields, employers, titles, dates and education facts are
 *    always copied from the existing resume;
 *  - skills must be evidenced by the original resume, the current resume, or
 *    the user's own instruction;
 *  - rewritten bullets may not introduce technologies that are not evidenced
 *    for that specific role, nor numbers/metrics that appear nowhere in the
 *    resume or instruction — offending bullets are reverted;
 *  - brand-new items are only accepted when the user's instruction supplies
 *    their facts;
 *  - large deletions are rejected unless the user asked for removal.
 */

const TECH_TERMS: LexiconTerm[] = LEXICON.filter((t) => !['soft', 'practice'].includes(t.category));
const REMOVAL_INTENT = /\b(remove|delete|drop|exclude|hide|omit|one[- ]page|1[- ]page|shorten|shorter|condense|compact|trim|cut|only keep|keep only|reduce|brief|briefly|concise|summari[sz]e)\b/i;

export interface GuardResult {
  resume: ResumeData;
  warnings: string[];
}

interface Ctx {
  original: ResumeData;
  current: ResumeData;
  instruction: string;
  /** The instruction when it asserts first-hand experience, else ''. */
  asserted: string;
  corpus: string;
  labOnly: Set<string>;
  warnings: string[];
  /** Job description text: its vocabulary may be used when it accurately describes existing work. */
  jdText: string;
}

/**
 * Text in an instruction only counts as evidence when the user asserts
 * first-hand experience ("I have used Terraform at Acme"). A request such as
 * "add more AWS keywords" is not evidence that the candidate used AWS.
 */
export function assertedFacts(instruction: string): string {
  const asserts =
    /\b(i|we)\s+(have|had|also|actually|used|use|worked|work|built|build|managed|manage|administered|configured|deployed|implemented|led|developed|created|hold|earned|completed|am|was)\b|\bmy (experience|work|role|job) (with|at|in|as)\b|\bi'(ve|m)\b/i;
  return asserts.test(instruction) ? instruction : '';
}

function makeCtx(original: ResumeData, current: ResumeData, instruction: string, userFacts: string[] = [], jdText = ''): Ctx {
  const asserted = assertedFacts(instruction);
  const corpus = [resumeToPlainText(original), resumeToPlainText(current), asserted, ...userFacts].join('\n');
  // Technologies evidenced only in lab / training context in the original.
  const labOnly = new Set<string>();
  for (const term of TECH_TERMS) {
    const ev = keywordEvidence(term.label, current, original);
    if (ev.inOriginal && ev.labOnly && !findKeyword(asserted, term.label)) labOnly.add(term.label);
  }
  return { original, current, instruction, asserted, corpus, labOnly, warnings: [], jdText };
}

export function unsupportedTerms(text: string, scope: string, exclude: Set<string> = new Set()): string[] {
  const out: string[] = [];
  for (const term of TECH_TERMS) {
    const forms = [term.label, ...(term.aliases || [])];
    if (!forms.some((f) => containsForm(text, f))) continue;
    if (exclude.has(term.label) || !forms.some((f) => containsForm(scope, f))) out.push(term.label);
  }
  return out;
}

const numberCores = (text: string) =>
  new Set((text.match(/\d+(?:[.,]\d+)*/g) || []).map((n) => n.replace(/,/g, '')));

export function unsupportedNumbers(text: string, scope: string): string[] {
  const allowed = numberCores(scope);
  return [...numberCores(text)].filter((n) => !allowed.has(n));
}

const descLines = (text: string) =>
  text
    .split(/\n+/)
    .map((l) => l.replace(/^[\s•\-*]+/, '').trim())
    .filter(Boolean);

/**
 * Guards a project description line by line. Multi-line (bulleted) projects keep
 * their line structure, and — unless the user asked for something shorter —
 * details dropped by the rewrite are restored.
 */
function guardProjectDescription(ctx: Ctx, title: string, proposedRaw: string, previous: string, scope: string, keepDetails: boolean): string {
  // Models sometimes write "↵" or a literal "\n" instead of a line break, and prefix the project name.
  const shortTitle = title.split(/\s+[—–-]\s+/)[0].trim();
  const proposed = proposedRaw
    .replace(/\s*(?:↵|\\n|⏎)\s*/g, '\n')
    .split('\n')
    .map((l) => l.replace(new RegExp(`^\\s*(?:${[title, shortTitle].map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*[:—–-]\\s*`, 'i'), ''))
    .join('\n');
  if (!proposed.trim()) return previous;
  const label = `Project “${title}”`;
  const srcRaw = descLines(previous);
  // A single paragraph of several sentences is treated as one point per sentence.
  const src = srcRaw.length === 1 ? srcRaw[0].split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/).map((x) => x.trim()).filter(Boolean) : srcRaw;
  const prop = proposed.includes('\n') ? descLines(proposed) : src.length > 1 ? proposed.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/).map((s) => s.trim()).filter(Boolean) : [proposed.trim()];
  const guarded = prop
    .map((l) => {
      const invented = tooNovel(ctx, l, scope);
      if (invented) {
        // Drop the embellished line; the safety net below restores the original point.
        ctx.warnings.push(`${label}: skipped a rewritten line that added claims not in your resume (${invented.slice(0, 4).join(', ')}…).`);
        return '';
      }
      return guardProse(ctx, label, l, '', scope);
    })
    .filter(Boolean);
  if (!guarded.length) return previous;
  if (!keepDetails || src.length === 0) return guarded.join(src.length > 1 || guarded.length > 1 ? '\n' : ' ');
  const { bullets, restored } = restoreLostBullets(src, guarded);
  if (restored > src.length / 2) {
    // The rewrite lost most of the project: keep the original wording rather than stitching both together.
    ctx.warnings.push(`${label}: kept the original description because the rewrite dropped most of its details.`);
    return previous;
  }
  if (restored) ctx.warnings.push(`${label}: kept ${restored} original detail${restored === 1 ? '' : 's'} the rewrite had dropped.`);
  return bullets.join('\n');
}

const NOT_A_HEADLINE = /\b(fresher|graduate|undergraduate|student|b\.?\s?tech|m\.?\s?tech|b\.?e\b|b\.?sc|m\.?sc|bachelor|master'?s?|degree|diploma|seeking|looking for)\b/i;

const pos = (text: string, label: string) => {
  const i = text.toLowerCase().indexOf(label.toLowerCase());
  return i < 0 ? Number.MAX_SAFE_INTEGER : i;
};

/** "Data Engineer | Python, Pandas & Django": the role, then up to three JD skills the resume supports. */
function roleHeadline(jdTitle: string, corpus: string, jdText: string): string {
  const skills = LEXICON.filter((t) => t.category !== 'soft' && t.category !== 'practice' && findKeyword(jdText, t.label) && findKeyword(corpus, t.label))
    .map((t) => t.label)
    .sort((x, y) => pos(jdText, x) - pos(jdText, y))
    .slice(0, 3);
  if (!skills.length) return jdTitle;
  return `${jdTitle} | ${skills.length > 1 ? `${skills.slice(0, -1).join(', ')} & ${skills[skills.length - 1]}` : skills[0]}`;
}

/** userFacts marker: the user removed the headline under their name; tailoring must not re-add it. */
export const HEADLINE_REMOVED = '__headline_removed__';

/** Lab-only technologies are allowed only in a sentence that labels them as lab/training work. */
function labExclusions(ctx: Ctx, sentence: string): Set<string> {
  return LAB_CONTEXT.test(sentence) ? new Set() : ctx.labOnly;
}

/**
 * Tailoring may merge or tighten bullets but must not silently lose facts.
 * Any source bullet whose technologies (or most of its key words) are not
 * covered by the rewritten bullets is kept, in its original wording.
 */
export function restoreLostBullets(source: string[], rewritten: string[]): { bullets: string[]; restored: number } {
  const out = [...rewritten];
  let restored = 0;
  // Compare word stems so paraphrases count ("matching" ~ "match", "jobs" ~ "job").
  const wordsOf = (s: string) => [...new Set(significantTokens(s).filter((w) => w.length > 3).map(stem))];
  const share = (words: string[], text: string) => {
    const have = new Set(significantTokens(text).map(stem));
    return words.length ? words.filter((w) => have.has(w)).length / words.length : 1;
  };
  for (const b of source) {
    const joined = out.join('\n');
    const words = wordsOf(b);
    // Specific details that must survive: known technologies plus product-like tokens (Log4j, OpenJDK, FreeSWITCH, JAR).
    const terms = TECH_TERMS.filter((t) => [t.label, ...(t.aliases || [])].some((f) => containsForm(b, f))).map((t) => t.label);
    const special = (b.match(/\b(?:[A-Za-z]*\d[A-Za-z\d]*|[A-Za-z]*[a-z][A-Z][A-Za-z]*|[A-Z]{2,}[A-Za-z]*)\b/g) || []).filter((tok) => tok.length > 1);
    const detailMissing = (text: string) => terms.some((t) => !findKeyword(text, t)) || special.some((tok) => !text.includes(tok));
    if (share(words, joined) >= 0.5 && !detailMissing(joined)) continue;
    // The bullet survives in a weakened form: put the original wording back in place of its closest rewrite.
    let best = -1;
    let bestShare = 0;
    out.forEach((r, i) => {
      const s = share(words, r);
      if (s > bestShare) {
        bestShare = s;
        best = i;
      }
    });
    if (best >= 0 && bestShare >= 0.35) out[best] = b;
    else out.push(b);
    restored++;
  }
  return { bullets: dedupeNear(out), restored };
}

/** Removes near-duplicate lines (≥ 75% shared key words), keeping the first occurrence. */
export function dedupeNear(lines: string[]): string[] {
  const out: string[] = [];
  const words = (s: string) => new Set(significantTokens(s).filter((w) => w.length > 3).map(stem));
  for (const line of lines) {
    const a = words(line);
    const dup = out.some((kept) => {
      const b = words(kept);
      if (!a.size || !b.size) return kept.trim().toLowerCase() === line.trim().toLowerCase();
      const shared = [...a].filter((w) => b.has(w)).length;
      return shared / Math.min(a.size, b.size) >= 0.75;
    });
    if (!dup) out.push(line);
  }
  return out;
}

function mentionedInInstruction(ctx: Ctx, phrase: string): boolean {
  const tokens = significantTokens(phrase);
  if (!tokens.length) return false;
  const lower = ctx.instruction.toLowerCase();
  return tokens.filter((t) => lower.includes(t)).length / tokens.length >= 0.6;
}

/** Keeps sentences that introduce no unsupported technology or number. */
function guardProse(ctx: Ctx, label: string, proposed: string, previous: string, scope: string): string {
  const text = proposed.trim();
  if (!text) return previous;
  // Split only at a sentence end followed by whitespace and a capital/digit, so
  // abbreviations like "B.Tech", "Node.js" or "e.g." are never cut or dropped.
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/).filter((s) => s.trim());
  const kept: string[] = [];
  for (const s of sentences) {
    const terms = unsupportedTerms(s, scope, labExclusions(ctx, s));
    const nums = unsupportedNumbers(s, scope);
    if (terms.length || nums.length) ctx.warnings.push(`${label}: removed a sentence that claimed ${[...terms, ...nums.map((n) => `the figure “${n}”`)].join(', ')} without support in your resume.`);
    else kept.push(s.trim());
  }
  if (!kept.length) return previous;
  const joined = kept.join(' ').trim();
  return joined === previous.trim() ? previous : humanizeProse(joined);
}

function guardSkills(ctx: Ctx, cats: Array<{ name: string; skills: string[] }>): SkillCategory[] {
  const known = new Map(collectSkills(ctx.current).concat(collectSkills(ctx.original)).map((s) => [s.toLowerCase(), s]));
  const rejected: string[] = [];
  const result = cats
    .map((c) => ({
      id: newId('skills'),
      name: (c.name || 'Skills').slice(0, 60),
      skills: skillList(c.skills).filter((s) => {
        if (known.has(s.toLowerCase())) return true;
        const supported = !!findKeyword(ctx.corpus, s) && !ctx.labOnly.has(s);
        if (!supported) rejected.push(s);
        return supported;
      }),
    }))
    .filter((c) => c.skills.length);
  if (rejected.length) ctx.warnings.push(`Skills not added because your resume has no evidence for them: ${[...new Set(rejected)].join(', ')}.`);
  // Preserve category ids where names match the current resume.
  for (const c of result) {
    const prev = ctx.current.skills.categorized.find((x) => x.name.toLowerCase() === c.name.toLowerCase());
    if (prev) c.id = prev.id;
  }
  return result;
}

function experienceScope(ctx: Ctx, id: string): string {
  const pick = (r: ResumeData) => r.experience.filter((e) => e.id === id).map((e) => [e.jobTitle, e.company, e.description, ...e.bulletPoints].join('\n'));
  // Closed evidence boundary: a role may only mention technologies that the
  // same role already mentions (or that the user states in the instruction).
  return [...pick(ctx.original), ...pick(ctx.current), ctx.asserted].join('\n');
}

const ACTION_STEMS = new Set([...ACTION_VERBS].map(stem));
const NEUTRAL_STEMS = new Set(
  ['using', 'use', 'work', 'support', 'including', 'various', 'multiple', 'ensure', 'improve', 'enable', 'deliver', 'efficient', 'effective', 'key', 'core', 'relevant', 'new', 'based', 'within', 'across', 'related', 'through', 'such', 'while', 'also', 'into', 'both', 'user', 'users', 'application', 'project', 'features', 'feature', 'tools', 'tool', 'system', 'systems', 'environment', 'process', 'processes', 'workflow', 'workflows', 'team', 'teams', 'task', 'tasks'].map(stem),
);

/**
 * Words in a rewrite that appear nowhere in the source entry, the JD, the
 * user's instruction or a neutral vocabulary. Many of them means the model
 * added claims ("co-developed", "real-time protocols") rather than rewording.
 */
export function novelWords(text: string, scope: string, extra = ''): { fresh: string[]; ratio: number } {
  const allowed = new Set(significantTokens(`${scope}
${extra}`).map(stem));
  const words = [...new Set(significantTokens(text).filter((w) => w.length > 3).map(stem))];
  const fresh = words.filter((w) => !allowed.has(w) && !ACTION_STEMS.has(w) && !NEUTRAL_STEMS.has(w));
  return { fresh, ratio: words.length ? fresh.length / words.length : 0 };
}

function tooNovel(ctx: Ctx, text: string, scope: string): string[] | null {
  const { fresh, ratio } = novelWords(text, scope, `${ctx.jdText}
${ctx.instruction}`);
  return fresh.length >= 4 && ratio > 0.3 ? fresh : null;
}

function guardBullets(ctx: Ctx, label: string, proposed: string[], previous: string[], scope: string): string[] {
  const numberScope = `${scope}\n${ctx.corpus}`;
  const out: string[] = [];
  proposed.forEach((b, i) => {
    const text = b.replace(/^[\s•\-*]+/, '').trim();
    if (!text) return;
    const terms = unsupportedTerms(text, scope, labExclusions(ctx, text));
    const nums = unsupportedNumbers(text, numberScope);
    const invented = !terms.length && !nums.length ? tooNovel(ctx, text, scope) : null;
    if (invented) {
      ctx.warnings.push(`${label}: kept the original wording of a bullet because the rewrite added claims that are not in your resume (${invented.slice(0, 4).join(', ')}…).`);
      const fallback = previous[i];
      if (fallback && !out.includes(fallback)) out.push(fallback);
      return;
    }
    if (terms.length || nums.length) {
      ctx.warnings.push(`${label}: kept the previous wording of a bullet because the rewrite added ${[...terms, ...nums.map((n) => `“${n}”`)].join(', ')}, which is not supported for this role.`);
      const fallback = previous[i];
      if (fallback && !out.includes(fallback)) out.push(fallback);
      return;
    }
    out.push(previous.includes(text) ? text : humanizeLine(text).slice(0, 600));
  });
  return out;
}

function allowRemoval(ctx: Ctx, section: string, before: number, after: number): boolean {
  if (after >= before) return true;
  if (REMOVAL_INTENT.test(ctx.instruction)) return true;
  ctx.warnings.push(`Ignored the removal of ${before - after} ${section} entr${before - after === 1 ? 'y' : 'ies'} because you did not ask to remove anything.`);
  return false;
}

// ------------------------------------------------------------------ generation

/**
 * Applies AI tailoring on top of `current` (the version being tailored). The
 * original resume remains the evidence source for every fact check.
 */
export function applyGeneration(original: ResumeData, current: ResumeData, gen: GenerateOutput, jdTitle: string, userFacts: string[] = [], jdText = ''): GuardResult {
  const base = normalizeResume(structuredClone(current));
  const ctx = makeCtx(original, base, '', userFacts, jdText);
  const out = structuredClone(base);

  // Respect a headline the user explicitly removed; otherwise set a target-role headline.
  if (gen.headline.trim() && !userFacts.includes(HEADLINE_REMOVED)) {
    const headline = gen.headline.trim().slice(0, 120);
    // A target-role headline is positioning, but it must not introduce
    // technologies the resume does not support.
    out.personalInfo.jobTitle = unsupportedTerms(headline, ctx.corpus, ctx.labOnly).length ? base.personalInfo.jobTitle || jdTitle : headline;
  }
  // A degree or "fresher" line is not a headline: use the target role plus supported skills instead.
  if (!userFacts.includes(HEADLINE_REMOVED) && jdTitle && NOT_A_HEADLINE.test(out.personalInfo.jobTitle)) {
    out.personalInfo.jobTitle = roleHeadline(jdTitle, ctx.corpus, jdText);
  }
  out.summary = guardProse(ctx, 'Summary', gen.summary, base.summary, ctx.corpus);

  if (gen.skills.length) {
    const guarded = guardSkills(ctx, gen.skills);
    // Never lose an original skill silently during generation: append omitted ones.
    const kept = new Set(guarded.flatMap((c) => c.skills.map((s) => s.toLowerCase())));
    const omitted = collectSkills(base).filter((s) => !kept.has(s.toLowerCase()));
    if (omitted.length) guarded.push({ id: newId('skills'), name: guarded.length ? 'Additional Skills' : 'Skills', skills: omitted });
    if (guarded.length) out.skills = { mode: 'categorized', simple: [], categorized: guarded };
  }

  const expById = new Map(gen.experience.map((e) => [e.id, e]));
  out.experience = base.experience.map((e) => {
    const g = expById.get(e.id);
    if (!g) return e;
    const label = `${e.jobTitle || 'Role'} at ${e.company || 'employer'}`;
    const guarded = guardBullets(ctx, label, g.bullets, e.bulletPoints, experienceScope(ctx, e.id));
    const { bullets, restored } = guarded.length ? restoreLostBullets(e.bulletPoints, guarded) : { bullets: guarded, restored: 0 };
    if (restored) ctx.warnings.push(`${label}: kept ${restored} original bullet${restored === 1 ? '' : 's'} the rewrite had dropped, so no experience is lost.`);
    return {
      ...e,
      // Keep a role description only if the source role had one (otherwise the AI tends to repeat a bullet there).
      description: e.description && g.description.trim() ? guardProse(ctx, label, g.description, e.description, experienceScope(ctx, e.id)) : e.description,
      bulletPoints: bullets.length ? bullets : e.bulletPoints,
    };
  });

  const projById = new Map(gen.projects.map((p) => [p.id, p]));
  out.projects = base.projects.map((p) => {
    const g = projById.get(p.id);
    if (!g) return p;
    const scope = [p.title, p.description, p.technologies.join(', ')].join('\n');
    return { ...p, description: guardProjectDescription(ctx, p.title, g.description, p.description, scope, true) };
  });

  const achById = new Map(gen.achievements.map((a) => [a.id, a]));
  out.achievements = (base.achievements || []).map((a) => {
    const g = achById.get(a.id);
    return g ? { ...a, text: guardProse(ctx, 'Achievement', g.text, a.text, ctx.corpus) } : a;
  });

  // Section order is the user's choice (default: Summary, Skills, Projects, Experience, Education, …); tailoring never reorders it.
  return { resume: out, warnings: [...new Set(ctx.warnings)] };
}


// ------------------------------------------------------------------ editing

export function applyEdit(current: ResumeData, original: ResumeData, edit: EditOutput, instruction: string, userFacts: string[] = [], jdText = ''): GuardResult {
  const ctx = makeCtx(original, current, instruction, userFacts, jdText);
  const out = structuredClone(current);
  const u = edit.updates || {};

  if (typeof u.headline === 'string' && !u.headline.trim() && REMOVAL_INTENT.test(instruction)) {
    out.personalInfo.jobTitle = '';
  } else if (typeof u.headline === 'string' && u.headline.trim()) {
    const h = u.headline.trim().slice(0, 120);
    if (unsupportedTerms(h, ctx.corpus, ctx.labOnly).length) ctx.warnings.push('Headline change skipped: it named technologies your resume does not support.');
    else out.personalInfo.jobTitle = h;
  }

  if (typeof u.summary === 'string') {
    out.summary = u.summary.trim() ? guardProse(ctx, 'Summary', u.summary, current.summary, ctx.corpus) : REMOVAL_INTENT.test(instruction) ? '' : current.summary;
  }

  if (Array.isArray(u.skills)) {
    const guarded = guardSkills(ctx, u.skills);
    const before = collectSkills(current).length;
    const after = guarded.reduce((n, c) => n + c.skills.length, 0);
    if (after || REMOVAL_INTENT.test(instruction)) {
      if (after < before * 0.5 && !REMOVAL_INTENT.test(instruction)) ctx.warnings.push('Ignored a skills change that would have removed most of your skills.');
      else out.skills = { mode: 'categorized', simple: [], categorized: guarded };
    }
  }

  if (Array.isArray(u.experience)) {
    const byId = (r: ResumeData, id: string) => r.experience.find((e) => e.id === id);
    const next = [] as ResumeData['experience'];
    for (const item of u.experience) {
      const existing = byId(current, item.id) || byId(original, item.id);
      if (existing) {
        const label = `${existing.jobTitle || 'Role'} at ${existing.company || 'employer'}`;
        const scope = experienceScope(ctx, existing.id);
        const bullets = guardBullets(ctx, label, item.bullets, existing.bulletPoints, scope);
        next.push({
          ...existing, // employer, title, dates and location are locked
          description: item.description.trim() ? guardProse(ctx, label, item.description, existing.description, scope) : bullets.length ? '' : existing.description,
          bulletPoints: bullets.length || REMOVAL_INTENT.test(instruction) ? bullets : existing.bulletPoints,
        });
      } else if (item.company && item.jobTitle && mentionedInInstruction(ctx, item.company) && mentionedInInstruction(ctx, item.jobTitle)) {
        const scope = ctx.instruction;
        next.push({
          id: newId('exp'),
          jobTitle: item.jobTitle,
          company: item.company,
          location: item.location,
          startDate: item.startDate && ctx.instruction.includes(item.startDate.slice(0, 4)) ? item.startDate : '',
          endDate: item.endDate && ctx.instruction.includes(item.endDate.slice(0, 4)) ? item.endDate : '',
          current: item.current && /present|current/i.test(ctx.instruction),
          description: '',
          bulletPoints: guardBullets(ctx, item.jobTitle, item.bullets, [], scope),
        });
      } else if (item.id) {
        ctx.warnings.push(`Skipped a new experience entry (“${item.jobTitle || item.company || item.id}”) because its details did not come from you or your resume.`);
      }
    }
    if (allowRemoval(ctx, 'experience', current.experience.length, next.length)) out.experience = next;
  }

  if (Array.isArray(u.projects)) {
    const next = [] as ResumeData['projects'];
    for (const item of u.projects) {
      const existing = current.projects.find((p) => p.id === item.id) || original.projects.find((p) => p.id === item.id);
      if (existing) {
        const scope = [existing.title, existing.description, existing.technologies.join(', '), ctx.asserted].join('\n');
        next.push({ ...existing, description: guardProjectDescription(ctx, existing.title, item.description, existing.description, scope, !REMOVAL_INTENT.test(instruction)) });
      } else if (item.title && mentionedInInstruction(ctx, item.title)) {
        next.push({
          id: newId('proj'),
          title: item.title,
          description: guardProse(ctx, `Project “${item.title}”`, item.description, '', ctx.instruction),
          technologies: skillList(item.technologies).filter((t) => findKeyword(ctx.instruction, t)),
          liveUrl: '',
          githubUrl: '',
          startDate: '',
          endDate: '',
        });
      } else if (item.id) ctx.warnings.push(`Skipped a new project (“${item.title || item.id}”) because its details were not provided by you.`);
    }
    if (allowRemoval(ctx, 'project', current.projects.length, next.length)) out.projects = next;
  }

  if (Array.isArray(u.education)) {
    const next = u.education.map((e) => current.education.find((x) => x.id === e.id) || original.education.find((x) => x.id === e.id)).filter((e): e is NonNullable<typeof e> => !!e);
    if (next.length && allowRemoval(ctx, 'education', current.education.length, next.length)) out.education = next;
  }

  if (Array.isArray(u.certifications)) {
    const next = [] as NonNullable<ResumeData['certifications']>;
    for (const c of u.certifications) {
      const existing = (current.certifications || []).find((x) => x.id === c.id) || (original.certifications || []).find((x) => x.id === c.id);
      if (existing) next.push(existing);
      else if (c.name && (findKeyword(resumeToPlainText(original), c.name) || mentionedInInstruction(ctx, c.name))) next.push({ id: newId('cert'), name: c.name, issuer: c.issuer, date: c.date && ctx.corpus.includes(c.date.slice(0, 4)) ? c.date : '' });
      else if (c.name) ctx.warnings.push(`Certification “${c.name}” was not added because it is not in your resume.`);
    }
    if (allowRemoval(ctx, 'certification', (current.certifications || []).length, next.length)) out.certifications = next;
  }

  if (Array.isArray(u.achievements)) {
    const next = [] as NonNullable<ResumeData['achievements']>;
    for (const a of u.achievements) {
      const existing = (current.achievements || []).find((x) => x.id === a.id) || (original.achievements || []).find((x) => x.id === a.id);
      const text = guardProse(ctx, 'Achievement', a.text, existing?.text || '', ctx.corpus);
      if (!text) continue;
      if (existing) next.push({ ...existing, text });
      else {
        const tokens = significantTokens(text);
        const supported = tokens.length > 0 && tokens.filter((t) => ctx.corpus.toLowerCase().includes(t)).length / tokens.length >= 0.6;
        if (supported) next.push({ id: newId('ach'), text });
        else ctx.warnings.push('Skipped a new achievement that was not supported by your resume.');
      }
    }
    if (allowRemoval(ctx, 'achievement', (current.achievements || []).length, next.length)) out.achievements = next;
  }

  if (Array.isArray(u.customSections)) {
    const next = [] as ResumeData['customSections'];
    u.customSections.forEach((c, i) => {
      const existing = current.customSections.find((x) => x.id === c.id) || original.customSections.find((x) => x.id === c.id);
      const content = guardProse(ctx, c.title || 'Section', c.content, existing?.content || '', ctx.corpus);
      if (existing) next.push({ ...existing, title: c.title || existing.title, content: content || existing.content, order: i });
      else if (content) next.push({ id: newId('custom'), title: c.title.slice(0, 60), content, type: 'bullets', visible: true, order: i });
    });
    if (allowRemoval(ctx, 'custom section', current.customSections.length, next.length)) out.customSections = next;
  }

  if (Array.isArray(u.sections) && u.sections.length) {
    const byId = new Map(u.sections.map((s, i) => [s.id, { ...s, order: i }]));
    out.sections = normalizeSections(
      normalizeSections(current.sections).map((s) => {
        const n = byId.get(s.id);
        return n ? { ...s, visible: n.visible, title: (n.title || s.title).slice(0, 60), order: n.order } : { ...s, order: 100 + s.order };
      }),
    );
  }

  if (u.template && (ATS_TEMPLATE_IDS as string[]).includes(u.template)) out.template = u.template;
  if (u.layout) {
    out.layout = { ...out.layout, margins: u.layout.margins, pageTarget: String(u.layout.pageTarget) === '2' ? 2 : 1 };
    out.fontSize = u.layout.fontSize;
  }
  if (u.style) {
    const { reset, ...changes } = u.style;
    const provided = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== null && v !== undefined));
    const merged = { ...(reset ? {} : out.layout?.style || {}), ...provided };
    out.layout = { margins: out.layout?.margins || 'normal', pageTarget: out.layout?.pageTarget || 1, style: normalizeStyle(merged) };
  }

  // Identity and contact details never change through AI edits.
  out.personalInfo = { ...current.personalInfo, jobTitle: out.personalInfo.jobTitle };

  return { resume: normalizeResume(out), warnings: [...new Set(ctx.warnings)] };
}

/** Rejects AI output that would leave an obviously broken resume. */
export function isMalformed(before: ResumeData, after: ResumeData): string | null {
  const content = (r: ResumeData) => r.summary.length + r.experience.length + r.projects.length + r.education.length + collectSkills(r).length;
  if (content(before) > 0 && content(after) === 0) return 'The AI returned an empty resume.';
  if (!after.personalInfo.fullName && before.personalInfo.fullName) return 'The AI response dropped the candidate name.';
  return null;
}
