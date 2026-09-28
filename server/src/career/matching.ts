import type { ResumeData } from '../../../shared/resumeTypes.js';
import { analyzeJobDescriptionDeterministic, type JDAnalysis } from '../../../shared/jdAnalyzer.js';
import { scoreResume } from '../../../shared/ats.js';
import type { AtsWeights } from '../../../shared/ats.js';
import { resumeToPlainText } from '../../../shared/normalize.js';
import { significantTokens, stem } from '../../../shared/match.js';

/**
 * Deterministic resume ↔ job match (no AI, no cost, same scorer as the
 * resume engine's ATS panel). Used to rank jobs, gate the agent and feed
 * the skill-gap report.
 *
 * When the job text contains no skills the analyser recognises (e.g. a
 * nursing or sales job), the ATS formula would treat "no keywords" as full
 * coverage; the match then falls back to how much of the job's vocabulary
 * appears in the resume, so unrelated jobs score low instead of 100.
 */
export interface MatchResult {
  analysis: JDAnalysis;
  score: number;
  matched: string[];
  missing: string[];
  basis: 'keywords' | 'text-overlap';
}

const GENERIC = new Set(['experience', 'years', 'year', 'work', 'team', 'role', 'job', 'skill', 'ability', 'strong', 'good', 'required', 'requirement', 'responsibilit', 'candidate', 'company', 'knowledge', 'including', 'within', 'ensure', 'provide', 'support', 'working']);

/** Share (0-100) of the job's most frequent meaningful words that also appear in the resume. */
export function textOverlapScore(resumeText: string, jdText: string): { score: number; matched: string[]; missing: string[] } {
  const resume = new Set(significantTokens(resumeText).map(stem));
  const counts = new Map<string, { n: number; word: string }>();
  for (const w of significantTokens(jdText)) {
    const s = stem(w);
    if (s.length < 3 || GENERIC.has(s) || /^\d+$/.test(s)) continue;
    const c = counts.get(s) || { n: 0, word: w };
    c.n++;
    counts.set(s, c);
  }
  const top = [...counts.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 30);
  if (!top.length) return { score: 0, matched: [], missing: [] };
  const matched = top.filter(([s]) => resume.has(s)).map(([, v]) => v.word);
  const missing = top.filter(([s]) => !resume.has(s)).map(([, v]) => v.word);
  return { score: Math.round((matched.length / top.length) * 100), matched: matched.slice(0, 20), missing: missing.slice(0, 20) };
}

export function matchResume(resume: ResumeData, jdText: string, opts: { weights?: Partial<AtsWeights>; analysis?: JDAnalysis | null; original?: ResumeData | null } = {}): MatchResult {
  const analysis = opts.analysis || analyzeJobDescriptionDeterministic(jdText);
  const keywordCount = analysis.requiredSkills.length + analysis.preferredSkills.length + analysis.atsKeywords.length;
  if (keywordCount === 0) {
    const t = textOverlapScore(resumeToPlainText(resume), jdText);
    return { analysis, score: t.score, matched: t.matched, missing: t.missing, basis: 'text-overlap' };
  }
  const ats = scoreResume(resume, analysis, { weights: opts.weights, original: opts.original ?? resume, semantic: null });
  return {
    analysis,
    score: ats.total,
    matched: [...ats.requiredMatched, ...ats.preferredMatched].slice(0, 40),
    missing: ats.requiredMissing.slice(0, 40),
    basis: 'keywords',
  };
}

/** Rough years required by a JD ("3+ years", "minimum 5 years"), null when not stated. */
export function yearsRequired(analysis: JDAnalysis): number | null {
  return typeof analysis.minYears === 'number' ? analysis.minYears : null;
}
