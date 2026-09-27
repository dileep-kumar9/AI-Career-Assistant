import type { ResumeData } from './resumeTypes.js';
import type { JDAnalysis } from './jdAnalyzer.js';
import { ACTION_VERBS, DEGREE_PATTERNS, WEAK_PHRASES } from './lexicon.js';
import { canonicalKeyword, findKeyword, matchKeyword, significantTokens, snippetAround, stem, stemSet, uniqueKeywords, type MatchStatus } from './match.js';
import { collectSkills, isSectionVisible, resumeToPlainText, wordCount } from './normalize.js';

/**
 * ATS compatibility scoring.
 *
 * The score is a weighted sum of five categories, each scored 0..1:
 *
 *   keywords        share of JD keywords present (exact = 1, partial = 0.5)
 *   requiredSkills  0.8 * required-skill coverage + 0.2 * preferred coverage
 *   experience      0.4 * responsibility coverage + 0.3 * years-of-experience fit
 *                   + 0.3 * required skills evidenced inside experience/projects
 *                   (blended 60/40 with an optional AI semantic-relevance score)
 *   structure       weighted formatting/readability checks (see STRUCTURE_CHECKS)
 *   education       degree-level fit and required-certification coverage
 *
 * Everything except the optional semantic component is deterministic: the
 * same resume + JD always yields the same score. It is an estimate produced by
 * this application, not the score of any specific employer's ATS.
 */

export interface AtsWeights {
  keywords: number;
  requiredSkills: number;
  experience: number;
  structure: number;
  education: number;
}

export const DEFAULT_WEIGHTS: AtsWeights = { keywords: 30, requiredSkills: 25, experience: 20, structure: 15, education: 10 };

export const ATS_DISCLAIMER =
  'This is an estimated compatibility score calculated by this application. It is not an official score from any employer’s applicant tracking system, ATS products score resumes differently, and no score guarantees an interview or selection.';

export type Importance = 'required' | 'preferred' | 'keyword';

export interface KeywordEvidence {
  inCurrent: boolean;
  inOriginal: boolean;
  originalSection?: string;
  originalSnippet?: string;
  /** The only evidence is in a lab / training / coursework context. */
  labOnly: boolean;
}

export interface KeywordResult {
  keyword: string;
  importance: Importance;
  status: MatchStatus;
  foundIn: string[];
  evidence: KeywordEvidence;
  /** Plain-language explanation shown when the user clicks the keyword. */
  why: string;
  recommendation: string;
}

export interface AtsCategory {
  id: keyof AtsWeights;
  label: string;
  weight: number;
  score: number;
  points: number;
  details: string[];
}

export interface AtsCheck {
  id: string;
  label: string;
  passed: boolean;
  weight: number;
  detail: string;
}

export interface AtsResult {
  total: number;
  categories: AtsCategory[];
  keywordMatchPct: number;
  requiredMatched: string[];
  requiredMissing: string[];
  preferredMatched: string[];
  preferredMissing: string[];
  keywords: KeywordResult[];
  experience: { resumeYears: number; requiredYears: number | null; responsibilityCoverage: number; skillsInContext: number };
  checks: AtsCheck[];
  sections: Array<{ id: string; label: string; present: boolean }>;
  suggestions: string[];
  semantic?: { score: number; rationale: string } | null;
  weights: AtsWeights;
  computedAt: string;
  disclaimer: string;
  /** Fingerprint of the JD analysis this result was computed against. */
  jdHash?: string;
}

export interface ScoreOptions {
  weights?: Partial<AtsWeights>;
  original?: ResumeData | null;
  semantic?: { score: number; rationale: string } | null;
  now?: Date;
}

export const LAB_CONTEXT = /\b(lab|labs|home ?lab|training|course|coursework|bootcamp|tutorial|academic|class project|self[- ]study|learning|familiar(ity)?|exposure|udemy|coursera|certification course|studying|capstone)\b/i;

export function normalizeWeights(w?: Partial<AtsWeights>): AtsWeights {
  const merged = { ...DEFAULT_WEIGHTS, ...(w || {}) } as AtsWeights;
  const keys = Object.keys(DEFAULT_WEIGHTS) as Array<keyof AtsWeights>;
  for (const k of keys) merged[k] = Math.max(0, Number(merged[k]) || 0);
  const sum = keys.reduce((n, k) => n + merged[k], 0);
  if (!sum) return { ...DEFAULT_WEIGHTS };
  // Scale to 100 so the total is always out of 100.
  for (const k of keys) merged[k] = Math.round((merged[k] / sum) * 1000) / 10;
  return merged;
}

/** Per-section plain text, used to report where a keyword was found. */
export function sectionTexts(r: ResumeData, visibleOnly = true): Record<string, string> {
  const show = (id: string) => !visibleOnly || isSectionVisible(r, id);
  return {
    headline: r.personalInfo.jobTitle || '',
    summary: show('summary') ? r.summary : '',
    skills: show('skills') ? collectSkills(r).join(', ') + '\n' + (r.skills.categorized || []).map((c) => c.name).join(', ') : '',
    experience: show('experience') ? r.experience.map((e) => [e.jobTitle, e.company, e.description, ...e.bulletPoints].join('\n')).join('\n') : '',
    projects: show('projects') ? r.projects.map((p) => [p.title, p.description, p.technologies.join(', ')].join('\n')).join('\n') : '',
    education: show('education') ? r.education.map((e) => [e.degree, e.institution, e.honors].join(' ')).join('\n') : '',
    certifications: show('certifications') ? (r.certifications || []).map((c) => `${c.name} ${c.issuer}`).join('\n') : '',
    achievements: show('achievements') ? (r.achievements || []).map((a) => a.text).join('\n') : '',
    additional: show('custom') ? (r.customSections || []).filter((c) => c.visible !== false).map((c) => `${c.title}\n${c.content}`).join('\n') : '',
  };
}

const SECTION_LABELS: Record<string, string> = {
  headline: 'Headline', summary: 'Summary', skills: 'Skills', experience: 'Experience', projects: 'Projects', education: 'Education',
  certifications: 'Certifications', achievements: 'Achievements', additional: 'Additional information',
};

export function keywordEvidence(keyword: string, current: ResumeData, original?: ResumeData | null): KeywordEvidence {
  const currentText = resumeToPlainText(current, { visibleOnly: true });
  const inCurrent = !!findKeyword(currentText, keyword);
  let inOriginal = false;
  let originalSection: string | undefined;
  let originalSnippet: string | undefined;
  let labOnly = false;
  if (original) {
    const texts = sectionTexts(original, false);
    const contexts: string[] = [];
    for (const [id, text] of Object.entries(texts)) {
      const hit = findKeyword(text, keyword);
      if (!hit) continue;
      inOriginal = true;
      const snip = snippetAround(text, hit.index);
      // A skills-list entry says nothing about *how* the skill was used, so it
      // is not counted when deciding whether the evidence is lab-only.
      if (id !== 'skills') contexts.push(snip);
      if (!originalSection || originalSection === SECTION_LABELS.skills) {
        originalSection = SECTION_LABELS[id] || id;
        originalSnippet = snip;
      }
    }
    // Lab-only when every piece of usage evidence sits in a lab/training context.
    labOnly = inOriginal && contexts.length > 0 && contexts.every((c) => LAB_CONTEXT.test(c));
  }
  return { inCurrent, inOriginal, originalSection, originalSnippet, labOnly };
}

function explain(keyword: string, importance: Importance, status: MatchStatus, ev: KeywordEvidence): { why: string; recommendation: string } {
  const why =
    importance === 'required'
      ? `“${keyword}” is listed as a required skill in the job description. Many ATS filters rank candidates by exact required-skill matches.`
      : importance === 'preferred'
        ? `“${keyword}” is a preferred / nice-to-have qualification in the job description. It can raise your ranking but is usually not a hard filter.`
        : `“${keyword}” appears in the job description and is likely one of the terms recruiters search for.`;
  let recommendation: string;
  if (status === 'matched' && ev.labOnly)
    recommendation = 'Present, but your original resume shows it only as lab/training experience. Keep it described that way — do not present it as professional experience.';
  else if (status === 'matched') recommendation = 'Already present in your resume.';
  else if (ev.inOriginal && ev.labOnly)
    recommendation = `Your original resume mentions it only in a lab/training context (${ev.originalSection}). If you add it, describe it honestly as lab or training experience — do not present it as professional experience.`;
  else if (ev.inOriginal)
    recommendation = `Your original resume supports this (${ev.originalSection}: ${ev.originalSnippet}). You can safely surface it, e.g. “Add ${keyword} from my existing experience”.`;
  else if (status === 'partial')
    recommendation = 'A related term is present. Use the exact wording only if it accurately describes your experience.';
  else recommendation = 'No evidence in your original resume. Treat this as a skill gap — do not add it unless you genuinely have this experience.';
  return { why, recommendation };
}

/** Years of professional experience from dated experience entries (overlaps merged). */
export function experienceYears(r: ResumeData, now = new Date()): number {
  const toMonths = (value: string, isEnd: boolean): number | null => {
    if (!value) return null;
    if (/present|current|now/i.test(value)) return now.getFullYear() * 12 + now.getMonth();
    let m = value.match(/^(\d{4})-(\d{1,2})/);
    if (m) return Number(m[1]) * 12 + Number(m[2]) - 1;
    m = value.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{4})/);
    if (m) {
      const idx = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[1].toLowerCase());
      if (idx >= 0) return Number(m[2]) * 12 + idx;
    }
    m = value.match(/(\d{4})/);
    if (m) return Number(m[1]) * 12 + (isEnd ? 11 : 0);
    return null;
  };
  const ranges: Array<[number, number]> = [];
  for (const e of r.experience) {
    const s = toMonths(e.startDate, false);
    const end = e.current ? toMonths('present', true) : toMonths(e.endDate, true) ?? s;
    if (s !== null && end !== null && end >= s) ranges.push([s, end + 1]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cur: [number, number] | null = null;
  for (const range of ranges) {
    if (!cur || range[0] > cur[1]) {
      if (cur) total += cur[1] - cur[0];
      cur = [...range] as [number, number];
    } else cur[1] = Math.max(cur[1], range[1]);
  }
  if (cur) total += cur[1] - cur[0];
  return Math.round((total / 12) * 10) / 10;
}

function degreeLevel(r: ResumeData): number {
  let level = 0;
  for (const e of r.education) {
    const text = `${e.degree} ${e.honors}`;
    for (const d of DEGREE_PATTERNS) if (d.re.test(text)) level = Math.max(level, d.level);
  }
  return level;
}

export function allBullets(r: ResumeData): string[] {
  return [
    ...(isSectionVisible(r, 'experience') ? r.experience.flatMap((e) => e.bulletPoints) : []),
    ...(isSectionVisible(r, 'achievements') ? (r.achievements || []).map((a) => a.text) : []),
  ].filter((b) => b.trim());
}

function structureChecks(r: ResumeData, now: Date): AtsCheck[] {
  const p = r.personalInfo;
  const bullets = allBullets(r);
  const firstWord = (b: string) => (b.replace(/^[^A-Za-z]+/, '').match(/^[A-Za-z]+/)?.[0] || '').toLowerCase();
  // Past tense ("Deployed") and present tense for current roles ("Deploy", "Manage") both count.
  const isAction = (w: string) => ACTION_VERBS.has(w) || ACTION_VERBS.has(`${w}ed`) || ACTION_VERBS.has(`${w}d`) || ACTION_VERBS.has(w.replace(/y$/, 'ied')) || /ed$/.test(w);
  const actionShare = bullets.length ? bullets.filter((b) => isAction(firstWord(b))).length / bullets.length : 0;
  const longBullets = bullets.filter((b) => wordCount(b) > 35).length;
  const weak = bullets.filter((b) => WEAK_PHRASES.some((w) => b.toLowerCase().includes(w))).length;
  const body = resumeToPlainText(r, { visibleOnly: true });
  const words = wordCount(body);
  const summaryWords = wordCount(r.summary);
  const pronouns = (body.match(/\b(I|me|my|mine|myself)\b/g) || []).length;
  const expDated = r.experience.length > 0 && r.experience.every((e) => e.startDate && (e.endDate || e.current));
  const standardTitles = (r.customSections || []).every((c) => c.title.length <= 40);
  const target = r.layout?.pageTarget ?? 1;
  const maxWords = target === 1 ? 750 : 1300;
  const checks: AtsCheck[] = [
    { id: 'contact', label: 'Contact details (name, email, phone) in the body', weight: 0.15, passed: !!(p.fullName && p.email && p.phone), detail: p.fullName && p.email && p.phone ? 'Name, email and phone are present in the document body.' : `Missing: ${[!p.fullName && 'name', !p.email && 'email', !p.phone && 'phone'].filter(Boolean).join(', ')}.` },
    { id: 'summary', label: 'Professional summary (25–120 words)', weight: 0.1, passed: isSectionVisible(r, 'summary') && summaryWords >= 25 && summaryWords <= 120, detail: isSectionVisible(r, 'summary') && r.summary ? `Summary has ${summaryWords} words.` : 'No visible professional summary.' },
    { id: 'experience', label: 'Experience section with dated entries', weight: 0.15, passed: isSectionVisible(r, 'experience') && expDated, detail: r.experience.length ? (expDated ? 'Every role has start and end dates.' : 'Some roles are missing dates.') : 'No work experience entries.' },
    { id: 'skills', label: 'Dedicated skills section', weight: 0.1, passed: isSectionVisible(r, 'skills') && collectSkills(r).length >= 3, detail: `${collectSkills(r).length} skills listed.` },
    { id: 'education', label: 'Education section', weight: 0.1, passed: isSectionVisible(r, 'education') && r.education.length > 0, detail: r.education.length ? `${r.education.length} education entr${r.education.length === 1 ? 'y' : 'ies'}.` : 'No education entries.' },
    { id: 'action-verbs', label: 'Bullets start with action verbs', weight: 0.1, passed: bullets.length > 0 && actionShare >= 0.7, detail: bullets.length ? `${Math.round(actionShare * 100)}% of bullets start with an action verb.` : 'No bullet points found.' },
    { id: 'bullet-length', label: 'Concise bullets (≤ 35 words)', weight: 0.1, passed: bullets.length > 0 && longBullets <= Math.max(0, Math.floor(bullets.length * 0.1)) && weak === 0, detail: `${longBullets} long bullet(s); ${weak} bullet(s) use weak phrasing such as “responsible for”.` },
    { id: 'pronouns', label: 'No first-person pronouns', weight: 0.05, passed: pronouns === 0, detail: pronouns ? `${pronouns} first-person pronoun(s) found.` : 'None found.' },
    { id: 'dates', label: 'Consistent date information', weight: 0.05, passed: expDated || r.experience.length === 0, detail: expDated ? 'Dates are consistent.' : 'Add dates to every role.' },
    { id: 'length', label: `Appropriate length for a ${target}-page resume`, weight: 0.05, passed: words >= 180 && words <= maxWords, detail: `${words} words (recommended 180–${maxWords}).` },
    { id: 'headings', label: 'Standard section headings, single-column layout', weight: 0.05, passed: standardTitles, detail: standardTitles ? 'Uses standard headings and an ATS-safe single-column template.' : 'Shorten custom section titles to standard headings.' },
  ];
  void now;
  return checks;
}

export function scoreResume(resume: ResumeData, jd: JDAnalysis | null, opts: ScoreOptions = {}): AtsResult {
  const weights = normalizeWeights(opts.weights);
  const now = opts.now || new Date();
  const text = resumeToPlainText(resume, { visibleOnly: true });
  const stems = stemSet(text);
  const texts = sectionTexts(resume);
  const original = opts.original || null;

  const required = uniqueKeywords(jd?.requiredSkills || []);
  const preferred = uniqueKeywords(jd?.preferredSkills || []).filter((k) => !required.includes(k));
  const certs = uniqueKeywords(jd?.certifications || []);
  const keywordList = uniqueKeywords([...required, ...preferred, ...certs, ...(jd?.atsKeywords || [])]);

  const keywords: KeywordResult[] = keywordList.map((keyword) => {
    const importance: Importance = required.includes(keyword) ? 'required' : preferred.includes(keyword) ? 'preferred' : 'keyword';
    const status = matchKeyword(text, keyword, stems);
    const foundIn = Object.entries(texts).filter(([, t]) => t && findKeyword(t, keyword)).map(([id]) => SECTION_LABELS[id] || id);
    const evidence = keywordEvidence(keyword, resume, original);
    return { keyword, importance, status, foundIn, evidence, ...explain(keyword, importance, status, evidence) };
  });

  const statusOf = (k: string) => keywords.find((x) => x.keyword === k)?.status || 'missing';
  const credit = (s: MatchStatus) => (s === 'matched' ? 1 : s === 'partial' ? 0.5 : 0);
  const coverage = (list: string[]) => (list.length ? list.reduce((n, k) => n + credit(statusOf(k)), 0) / list.length : 1);

  // 1. Keyword alignment
  const keywordScore = coverage(keywordList);
  const keywordMatchPct = keywordList.length ? Math.round((keywords.filter((k) => k.status === 'matched').length / keywordList.length) * 100) : 100;

  // 2. Required skills alignment
  const reqCov = coverage(required);
  const prefCov = coverage(preferred);
  const skillsScore = required.length ? (preferred.length ? 0.8 * reqCov + 0.2 * prefCov : reqCov) : preferred.length ? prefCov : 1;

  // 3. Relevant experience alignment
  const expText = `${texts.experience}\n${texts.projects}\n${texts.achievements}`;
  const expStems = stemSet(expText);
  const responsibilities = jd?.responsibilities || [];
  const covered = responsibilities.filter((line) => {
    const tokens = [...new Set(significantTokens(line).map(stem))];
    if (!tokens.length) return false;
    const overlap = tokens.filter((t) => expStems.has(t)).length / tokens.length;
    return overlap >= 0.3;
  }).length;
  const respCoverage = responsibilities.length ? covered / responsibilities.length : 1;
  const resumeYears = experienceYears(resume, now);
  const requiredYears = jd?.minYears ?? null;
  const yearsFit = requiredYears ? Math.min(1, resumeYears / requiredYears) : 1;
  const contextSkills = required.length ? required.filter((k) => findKeyword(expText, k)).length / required.length : 1;
  let experienceScore = 0.4 * respCoverage + 0.3 * yearsFit + 0.3 * contextSkills;
  const semantic = opts.semantic && Number.isFinite(opts.semantic.score) ? { score: Math.max(0, Math.min(1, opts.semantic.score)), rationale: opts.semantic.rationale } : null;
  if (semantic) experienceScore = 0.6 * experienceScore + 0.4 * semantic.score;

  // 4. Structure and readability
  const checks = structureChecks(resume, now);
  const structureScore = checks.reduce((n, c) => n + (c.passed ? c.weight : 0), 0) / checks.reduce((n, c) => n + c.weight, 0);

  // 5. Education and certifications
  const eduRequired = jd?.educationLevel || 0;
  const eduLevel = degreeLevel(resume);
  const eduFit = eduRequired ? (eduLevel >= eduRequired ? 1 : eduLevel > 0 ? 0.5 : 0) : 1;
  const certFit = certs.length ? coverage(certs) : 1;
  const educationScore = eduRequired && certs.length ? 0.6 * eduFit + 0.4 * certFit : eduRequired ? eduFit : certs.length ? certFit : 1;

  const cat = (id: keyof AtsWeights, label: string, score: number, details: string[]): AtsCategory => ({
    id, label, weight: weights[id], score: Math.round(score * 1000) / 1000, points: Math.round(score * weights[id] * 10) / 10, details,
  });
  const categories: AtsCategory[] = [
    cat('keywords', 'Job description keyword alignment', keywordScore, [
      `${keywords.filter((k) => k.status === 'matched').length} matched, ${keywords.filter((k) => k.status === 'partial').length} partial, ${keywords.filter((k) => k.status === 'missing').length} missing of ${keywordList.length} keywords.`,
    ]),
    cat('requiredSkills', 'Required skills alignment', skillsScore, [
      `${required.filter((k) => statusOf(k) === 'matched').length}/${required.length} required skills matched.`,
      `${preferred.filter((k) => statusOf(k) === 'matched').length}/${preferred.length} preferred skills matched.`,
    ]),
    cat('experience', 'Relevant experience alignment', experienceScore, [
      `${covered}/${responsibilities.length} key responsibilities reflected in experience or projects.`,
      requiredYears ? `${resumeYears} years of dated experience vs ${requiredYears}+ requested.` : `${resumeYears} years of dated experience (no minimum stated).`,
      `${Math.round(contextSkills * 100)}% of required skills are evidenced in experience/projects, not only the skills list.`,
      ...(semantic ? [`AI semantic relevance: ${Math.round(semantic.score * 100)}% — ${semantic.rationale}`] : []),
    ]),
    cat('structure', 'Resume structure and ATS readability', structureScore, [`${checks.filter((c) => c.passed).length}/${checks.length} checks passed.`]),
    cat('education', 'Education and certifications alignment', educationScore, [
      eduRequired ? `Job asks for ${DEGREE_PATTERNS.find((d) => d.level === eduRequired)?.label || 'a degree'}; resume shows ${DEGREE_PATTERNS.find((d) => d.level === eduLevel)?.label || 'no recognised degree'}.` : 'No specific degree requirement detected.',
      certs.length ? `${certs.filter((c) => statusOf(c) === 'matched').length}/${certs.length} requested certifications present.` : 'No certifications requested.',
    ]),
  ];
  const total = Math.max(0, Math.min(100, Math.round(categories.reduce((n, c) => n + c.score * c.weight, 0))));

  const sections = [
    { id: 'contact', label: 'Contact information', present: !!(resume.personalInfo.email || resume.personalInfo.phone) },
    { id: 'summary', label: 'Professional summary', present: isSectionVisible(resume, 'summary') && !!resume.summary },
    { id: 'skills', label: 'Skills', present: isSectionVisible(resume, 'skills') && collectSkills(resume).length > 0 },
    { id: 'experience', label: 'Experience', present: isSectionVisible(resume, 'experience') && resume.experience.length > 0 },
    { id: 'projects', label: 'Projects', present: isSectionVisible(resume, 'projects') && resume.projects.length > 0 },
    { id: 'education', label: 'Education', present: isSectionVisible(resume, 'education') && resume.education.length > 0 },
    { id: 'certifications', label: 'Certifications', present: isSectionVisible(resume, 'certifications') && (resume.certifications || []).length > 0 },
  ];

  const suggestions: string[] = [];
  for (const k of keywords.filter((x) => x.status !== 'matched' && x.importance !== 'keyword')) {
    if (k.evidence.inOriginal && !k.evidence.labOnly) suggestions.push(`Surface “${k.keyword}” — your original resume already supports it (${k.evidence.originalSection}).`);
    else if (k.evidence.labOnly) suggestions.push(`“${k.keyword}” appears only as lab/training experience; if you include it, label it as lab experience.`);
  }
  const gaps = keywords.filter((x) => x.status === 'missing' && x.importance === 'required' && !x.evidence.inOriginal).map((x) => x.keyword);
  if (gaps.length) suggestions.push(`Skill gaps (not in your original resume — do not add unless you have them): ${gaps.join(', ')}.`);
  for (const c of checks.filter((x) => !x.passed)) suggestions.push(`${c.label}: ${c.detail}`);
  if (requiredYears && resumeYears < requiredYears) suggestions.push(`The role asks for ${requiredYears}+ years; emphasise the depth of relevant projects rather than inflating dates.`);

  return {
    total,
    categories,
    keywordMatchPct,
    requiredMatched: required.filter((k) => statusOf(k) === 'matched'),
    requiredMissing: required.filter((k) => statusOf(k) !== 'matched'),
    preferredMatched: preferred.filter((k) => statusOf(k) === 'matched'),
    preferredMissing: preferred.filter((k) => statusOf(k) !== 'matched'),
    keywords,
    experience: { resumeYears, requiredYears, responsibilityCoverage: Math.round(respCoverage * 100) / 100, skillsInContext: Math.round(contextSkills * 100) / 100 },
    checks,
    sections,
    suggestions: [...new Set(suggestions)].slice(0, 14),
    semantic,
    weights,
    computedAt: now.toISOString(),
    disclaimer: ATS_DISCLAIMER,
  };
}

export { canonicalKeyword };
