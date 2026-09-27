import type { ResumeData } from '../../../shared/resumeTypes.js';
import { analyzeJobDescriptionDeterministic, type JDAnalysis } from '../../../shared/jdAnalyzer.js';
import { scoreResume } from '../../../shared/ats.js';
import type { AtsWeights } from '../../../shared/ats.js';

/**
 * Deterministic resume ↔ job match (no AI, no cost, same scorer as the
 * resume engine's ATS panel). Used to rank jobs, gate the agent and feed
 * the skill-gap report.
 */
export interface MatchResult {
  analysis: JDAnalysis;
  score: number;
  matched: string[];
  missing: string[];
}

export function matchResume(resume: ResumeData, jdText: string, opts: { weights?: Partial<AtsWeights>; analysis?: JDAnalysis | null; original?: ResumeData | null } = {}): MatchResult {
  const analysis = opts.analysis || analyzeJobDescriptionDeterministic(jdText);
  const ats = scoreResume(resume, analysis, { weights: opts.weights, original: opts.original ?? resume, semantic: null });
  return {
    analysis,
    score: ats.total,
    matched: [...ats.requiredMatched, ...ats.preferredMatched].slice(0, 40),
    missing: ats.requiredMissing.slice(0, 40),
  };
}

/** Rough years required by a JD ("3+ years", "minimum 5 years"), null when not stated. */
export function yearsRequired(analysis: JDAnalysis): number | null {
  return typeof analysis.minYears === 'number' ? analysis.minYears : null;
}
