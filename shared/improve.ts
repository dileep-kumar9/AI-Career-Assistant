import type { ResumeData } from './resumeTypes.js';
import type { JDAnalysis } from './jdAnalyzer.js';
import { ACTION_VERBS, WEAK_PHRASES } from './lexicon.js';
import { findKeyword } from './match.js';
import { scoreResume, type AtsResult, type AtsWeights, type KeywordResult } from './ats.js';

/**
 * "How do I raise my score?" — a ranked, honest action plan.
 *
 * Each step's gain is measured, not guessed: the step's change is applied to a
 * copy of the resume and the copy is re-scored with the same engine and JD.
 * Steps that need facts only the user knows (skills with no evidence, missing
 * dates) are marked `confirm` / `manual` and are never applied automatically.
 */

export type StepKind = 'auto' | 'confirm' | 'manual';

export interface ImprovementStep {
  id: string;
  title: string;
  detail: string;
  /** Score points this step adds on its own (measured by re-scoring). */
  gain: number;
  kind: StepKind;
  /** Keywords / roles / bullets the step is about. */
  items: string[];
  /** Chat message that performs the step (auto) or starts it (confirm). */
  chat?: string;
}

export interface ImprovementPlan {
  current: number;
  /** Score if every step is done (upper bound; confirm steps assume the user has the skills). */
  potential: number;
  /** Score reachable without any new facts from the user. */
  safePotential: number;
  steps: ImprovementStep[];
}

interface PlanOptions {
  weights?: Partial<AtsWeights>;
  original?: ResumeData | null;
  semantic?: { score: number; rationale: string } | null;
  /** Rendered page count, when known (the preview or the PDF export). */
  pages?: number;
}

type Mutator = (r: ResumeData) => void;

const firstWord = (b: string) => (b.replace(/^[^A-Za-z]+/, '').match(/^[A-Za-z]+/)?.[0] || '').toLowerCase();
const isAction = (w: string) => ACTION_VERBS.has(w) || ACTION_VERBS.has(`${w}ed`) || ACTION_VERBS.has(`${w}d`) || ACTION_VERBS.has(w.replace(/y$/, 'ied')) || /ed$/.test(w);

function list(items: string[], max = 6): string {
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  const joined = shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}` : shown[0] || '';
  return rest > 0 ? `${joined} (+${rest} more)` : joined;
}

function clip(text: string, max: number): string {
  const t = text.split(/\s+\|\s+/)[0].replace(/^\s*\d+[.)]\s*/, '').trim();
  if (t.length <= max) return t.replace(/[.;]$/, '');
  return `${t.slice(0, max).replace(/\s+\S*$/, '')}…`;
}

function addToSkills(r: ResumeData, skills: string[]) {
  if (!skills.length) return;
  if (r.skills.mode === 'simple' && !r.skills.categorized.length) r.skills.simple.push(...skills);
  else {
    const extra = r.skills.categorized.find((c) => c.name === 'Additional Skills');
    if (extra) extra.skills.push(...skills);
    else r.skills.categorized.push({ id: 'plan-skills', name: 'Additional Skills', skills: [...skills] });
  }
  r.sections = r.sections.map((s) => (s.id === 'skills' ? { ...s, visible: true } : s));
}

export function improvementPlan(resume: ResumeData, jd: JDAnalysis | null, ats: AtsResult | null, opts: PlanOptions = {}): ImprovementPlan | null {
  if (!jd || !ats) return null;
  const score = (r: ResumeData) => scoreResume(r, jd, { weights: opts.weights ?? ats.weights, original: opts.original, semantic: opts.semantic ?? ats.semantic }).total;
  const base = score(resume);
  const measure = (m: Mutator) => {
    const copy = structuredClone(resume);
    m(copy);
    return Math.max(0, score(copy) - base);
  };

  const steps: Array<ImprovementStep & { mutate: Mutator }> = [];
  const important = (k: KeywordResult) => k.importance !== 'keyword' || k.status === 'missing';
  const unmatched = ats.keywords.filter((k) => k.status !== 'matched');

  // 1. JD keywords the original resume already proves → safe to surface.
  const evidenced = unmatched.filter((k) => k.evidence.inOriginal && !k.evidence.labOnly).map((k) => k.keyword);
  if (evidenced.length) {
    const mutate: Mutator = (r) => addToSkills(r, evidenced);
    steps.push({
      id: 'surface-evidenced', kind: 'auto', items: evidenced, mutate, gain: measure(mutate),
      title: `Use the JD’s exact wording for skills you already have`,
      detail: `Your resume already shows ${list(evidenced)}, but not in the words the job uses. Adding them to your skills is safe and truthful.`,
      chat: `Add ${evidenced.join(', ')} to my skills`,
    });
  }

  // 2. Missing JD skills with no evidence → only the user can say whether they have them.
  const gaps = unmatched.filter((k) => !k.evidence.inOriginal && important(k)).sort((a, b) => (a.importance === 'required' ? -1 : 0) - (b.importance === 'required' ? -1 : 0)).map((k) => k.keyword);
  if (gaps.length) {
    const mutate: Mutator = (r) => addToSkills(r, gaps);
    steps.push({
      id: 'confirm-gaps', kind: 'confirm', items: gaps, mutate, gain: measure(mutate),
      title: 'Add the missing JD skills you have really used',
      detail: `The job asks for ${list(gaps, 8)}, which your resume does not mention. Tick only the ones you have genuinely used (projects, coursework, work) and I’ll add them. Never add a skill you can’t talk about in an interview.`,
    });
  }

  // 3. Required skills that sit only in the skills list → show them in use.
  const listOnly = ats.keywords
    .filter((k) => k.status === 'matched' && k.importance === 'required' && k.foundIn.length === 1 && /skill/i.test(k.foundIn[0]))
    .map((k) => k.keyword);
  if (listOnly.length && (resume.projects.length || resume.experience.length)) {
    const mutate: Mutator = (r) => {
      if (r.projects[0]) r.projects[0].description += `\nUsed ${listOnly.join(', ')}.`;
      else r.experience[0].bulletPoints.push(`Used ${listOnly.join(', ')}.`);
    };
    steps.push({
      id: 'skills-in-context', kind: 'auto', items: listOnly, mutate, gain: measure(mutate),
      title: 'Show required skills inside projects or experience',
      detail: `${list(listOnly)} appear only in your skills list. ATS and recruiters weigh skills higher when a bullet shows where you used them.`,
      chat: `Mention ${listOnly.join(', ')} in my project or experience bullets only where I actually used them`,
    });
  }

  // 4. Structure checks that failed.
  const failed = new Map(ats.checks.filter((c) => !c.passed).map((c) => [c.id, c]));
  const undated = resume.experience.filter((e) => !e.startDate || (!e.endDate && !e.current));
  if (undated.length && (failed.has('experience') || failed.has('dates'))) {
    const mutate: Mutator = (r) => r.experience.forEach((e) => {
      if (!e.startDate) e.startDate = '2024-01';
      if (!e.endDate && !e.current) e.endDate = '2024-06';
    });
    steps.push({
      id: 'dates', kind: 'manual', items: undated.map((e) => [e.jobTitle, e.company].filter(Boolean).join(' at ')), mutate, gain: measure(mutate),
      title: 'Add start and end dates to every role',
      detail: `Missing dates on ${list(undated.map((e) => e.jobTitle || e.company))}. ATS parsers need month + year (e.g. “Jan 2024 – Jun 2024”) to count experience. Tell me the real dates, e.g. “My internship at X was Jan 2024 to Jun 2024”.`,
    });
  }

  const bullets = resume.experience.flatMap((e) => e.bulletPoints);
  const weakBullets = bullets.filter((b) => !isAction(firstWord(b)) || WEAK_PHRASES.some((w) => b.toLowerCase().includes(w)));
  if (weakBullets.length && (failed.has('action-verbs') || failed.has('bullet-length'))) {
    const mutate: Mutator = (r) => r.experience.forEach((e) => {
      e.bulletPoints = e.bulletPoints.map((b) => {
        let t = b;
        for (const w of WEAK_PHRASES) t = t.replace(new RegExp(w, 'ig'), '');
        t = t.trim();
        if (!isAction(firstWord(t))) t = `Handled ${t.charAt(0).toLowerCase()}${t.slice(1)}`;
        return t.split(/\s+/).slice(0, 30).join(' ');
      });
    });
    steps.push({
      id: 'action-verbs', kind: 'auto', items: weakBullets.slice(0, 5), mutate, gain: measure(mutate),
      title: 'Start every bullet with a strong action verb',
      detail: `${weakBullets.length} bullet(s) start weakly or use phrases like “responsible for”. Rewriting them as “Built…”, “Automated…”, “Resolved…” (same facts) passes the readability check.`,
      chat: 'Rewrite my weak bullets so each starts with a strong action verb and stays under 30 words. Keep every fact the same.',
    });
  }

  if (failed.has('summary')) {
    const mutate: Mutator = (r) => {
      r.summary = `${jd.jobTitle || 'Candidate'} with hands-on work in ${ats.requiredMatched.slice(0, 4).join(', ') || 'the core tools of this role'}, shown through the projects and roles below. `.repeat(2);
      r.sections = r.sections.map((s) => (s.id === 'summary' ? { ...s, visible: true } : s));
    };
    steps.push({
      id: 'summary', kind: 'auto', items: [], mutate, gain: measure(mutate),
      title: 'Add a short, specific summary (2–3 sentences)',
      detail: 'A 25–120 word summary that names the role and your strongest matching tools helps both the ATS and the recruiter.',
      chat: 'Write a 2-3 sentence summary for this job using only facts from my resume.',
    });
  }

  const target = resume.layout?.pageTarget ?? 1;
  if (opts.pages && opts.pages > target) {
    steps.push({
      id: 'pages', kind: 'auto', items: [], mutate: () => undefined, gain: 0,
      title: `Fit it on ${target} page${target === 1 ? '' : 's'} (now ${opts.pages})`,
      detail: 'Recruiters skim the first page; a spill-over second page often goes unread. Shorten long bullets, merge repeated points and trim the least relevant project — keep every JD keyword.',
      chat: `Reduce this resume to ${target === 1 ? 'one page' : `${target} pages`}: shorten long bullets and drop the least relevant points, keep all JD keywords.`,
    });
  }

  if (failed.has('length') && !(opts.pages && opts.pages > target)) {
    const c = failed.get('length')!;
    steps.push({
      id: 'length', kind: 'auto', items: [], mutate: () => undefined, gain: 0,
      title: 'Fit the resume to the target length',
      detail: `${c.detail} Recruiters and some ATS penalise overflowing pages. Shorten older or less relevant bullets rather than removing skills.`,
      chat: 'Make my resume fit on one page: shorten long bullets and drop the least relevant points, keep all JD keywords.',
    });
  }

  if (failed.has('pronouns')) {
    steps.push({ id: 'pronouns', kind: 'auto', items: [], mutate: () => undefined, gain: 0, title: 'Remove “I / my” from the text', detail: 'Resumes are written without first-person pronouns.', chat: 'Remove first-person pronouns (I, me, my) from my resume.' });
  }

  // 5. JD responsibilities nothing in the resume reflects → a relevant project closes the gap.
  const expText = [...resume.experience.flatMap((e) => [e.description, ...e.bulletPoints]), ...resume.projects.map((p) => p.description)].join('\n');
  const uncovered = (jd.responsibilities || []).filter((line) => {
    const words = line.toLowerCase().match(/[a-z][a-z+#.]{3,}/g) || [];
    return words.length && words.filter((w) => expText.toLowerCase().includes(w)).length / words.length < 0.3;
  });
  if (uncovered.length) {
    const gapSkills = gaps.slice(0, 4);
    const mutate: Mutator = (r) => r.projects.push({ id: 'plan-project', title: 'Project', description: uncovered.join('\n'), technologies: gapSkills, liveUrl: '', githubUrl: '', startDate: '', endDate: '' });
    steps.push({
      id: 'project', kind: 'confirm', items: uncovered.slice(0, 4), mutate, gain: measure(mutate),
      title: 'Add a project that covers the job’s main duties',
      detail: `Nothing in your resume reflects: ${list(uncovered.map((u) => `“${clip(u, 80)}”`), 3)}. If you have built something like this (college, personal or freelance), add it — or build a small one${gapSkills.length ? ` using ${list(gapSkills)}` : ''} and put it on GitHub.`,
      chat: 'Suggest some projects for this role that use the skills the job asks for.',
    });
  }

  // 6. Requested certifications.
  const certGaps = (jd.certifications || []).filter((c) => !findKeyword(expText + JSON.stringify(resume.certifications || []), c));
  if (certGaps.length) {
    steps.push({
      id: 'certifications', kind: 'manual', items: certGaps, mutate: () => undefined, gain: 0,
      title: 'Requested certifications',
      detail: `The job mentions ${list(certGaps)}. If you hold them, tell me (“I have the X certification, issued 2024”) and I’ll add them.`,
    });
  }

  // Combined potential: apply the steps in order on one copy.
  const combined = (kinds: StepKind[]) => {
    const copy = structuredClone(resume);
    for (const s of steps) if (kinds.includes(s.kind)) s.mutate(copy);
    return score(copy);
  };
  const ranked = steps
    .map(({ mutate: _m, ...s }) => ({ ...s, gain: Math.round(s.gain) }))
    .sort((a, b) => b.gain - a.gain || (a.kind === 'auto' ? -1 : 1));
  return {
    current: base,
    potential: Math.max(base, combined(['auto', 'confirm', 'manual'])),
    safePotential: Math.max(base, combined(['auto'])),
    steps: ranked,
  };
}

/** Markdown-lite text for the chat answer. */
export function planToText(plan: ImprovementPlan): string {
  if (!plan.steps.length) return `Your score is ${plan.current}/100 and there is nothing left that can be fixed from your resume content — the remaining points depend on skills or experience the job asks for.`;
  const lines = [
    `Your score is **${plan.current}/100**. Doing the steps below could take it to about **${plan.potential}/100** (about ${plan.safePotential}/100 using only what is already in your resume).`,
    '',
  ];
  plan.steps.forEach((s, i) => {
    const gain = s.gain > 0 ? ` (+${s.gain})` : '';
    const tag = s.kind === 'auto' ? '' : s.kind === 'confirm' ? ' — needs your confirmation' : ' — needs details from you';
    lines.push(`${i + 1}. **${s.title}**${gain}${tag}`, `   ${s.detail}`);
    if (s.chat && s.kind === 'auto') lines.push(`   Say: “${s.chat}”`);
  });
  lines.push('', 'Tip: tailor for each job separately, keep the layout single-column, and never add a skill you have not used — interviews check it.');
  return lines.join('\n');
}
