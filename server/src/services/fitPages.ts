import type { ResumeData, StyleOverrides } from '../../../shared/resumeTypes.js';
import type { JDAnalysis } from '../../../shared/jdAnalyzer.js';
import { findKeyword, uniqueKeywords } from '../../../shared/match.js';
import { normalizeResume, normalizeStyle, resumeToPlainText } from '../../../shared/normalize.js';
import { marginInches, resolvedSizes, templateStyle } from '../../../shared/templates.js';
import { countPdfPages } from './export.js';

/**
 * Fits a resume into a target number of pages without losing what matters.
 *
 * Steps are tried in order, re-measuring the real page count after each, and
 * the process stops as soon as the resume fits:
 *   1. tighter spacing between sections, entries and lines;
 *   2. smaller page margins;
 *   3. the least important content: school (10th) results when a degree is
 *      listed, a summary longer than three sentences, then the least relevant
 *      bullets of long projects/roles;
 *   4. only if still needed, slightly smaller fonts (never below 8.5pt body).
 * Never removed: contact details, headline, section headings, roles,
 * projects, degrees, certifications, skills — and never a line that holds the
 * only mention of a job-description keyword.
 */

export interface FitResult {
  resume: ResumeData;
  before: number;
  after: number;
  target: number;
  /** Layout changes, e.g. "Margins 0.64in → 0.5in". */
  layout: string[];
  /** Content that was removed (the user can restore it with undo). */
  removed: string[];
}

type Step = { kind: 'layout' | 'content'; apply: (r: ResumeData) => string[] };

const SCHOOL = /\b(ssc|s\.s\.c|10th|x(th)? class|class\s*(x|10)|secondary school certificate|matric(ulation)?|high school|cbse\s*10|sslc)\b/i;
const DEGREE = /\b(b\.?\s?tech|b\.?e\b|bachelor|b\.?sc|b\.?com|bca|m\.?\s?tech|master|m\.?sc|mca|mba|ph\.?d|degree|diploma|associate)\b/i;

function keywordsOf(jd: JDAnalysis | null): string[] {
  if (!jd) return [];
  return uniqueKeywords([...jd.requiredSkills, ...jd.preferredSkills, ...jd.tools, ...jd.atsKeywords]);
}

function setStyle(r: ResumeData, patch: StyleOverrides) {
  const style = normalizeStyle({ ...(r.layout?.style || {}), ...patch });
  r.layout = { margins: r.layout?.margins || 'normal', pageTarget: r.layout?.pageTarget || 1, ...(style ? { style } : {}) };
}

export async function fitToPages(input: ResumeData, target: 1 | 2, jd: JDAnalysis | null): Promise<FitResult> {
  let r = normalizeResume(structuredClone(input));
  const before = await countPdfPages(r);
  const layout: string[] = [];
  const removed: string[] = [];
  if (before <= target) {
    r.layout = { ...r.layout, margins: r.layout?.margins || 'normal', pageTarget: target };
    return { resume: r, before, after: before, target, layout, removed };
  }

  const keywords = keywordsOf(jd);
  const base = { style: templateStyle(r), sizes: resolvedSizes(r), margin: marginInches(r) };

  /** How much a line matters: JD keywords it holds, and whether it is their only mention. */
  const lineValue = (res: ResumeData, line: string) => {
    const text = resumeToPlainText(res, { visibleOnly: true });
    let value = 0;
    let unique = false;
    for (const k of keywords) {
      if (!findKeyword(line, k)) continue;
      value += 2;
      const others = text.split(line).join(' ');
      if (!findKeyword(others, k)) unique = true;
    }
    return { value: value + Math.min(line.length, 200) / 200, unique };
  };

  /** Removes the least valuable lines of lists longer than `cap` (the first line always stays). */
  const capLines = (res: ResumeData, cap: number, which: 'projects' | 'experience'): string[] => {
    const out: string[] = [];
    const trim = (lines: string[], label: string): string[] => {
      if (lines.length <= cap) return lines;
      const ranked = lines.map((l, i) => ({ l, i, ...lineValue(res, l) })).filter((x) => x.i > 0 && !x.unique).sort((a, b) => a.value - b.value);
      const drop = new Set(ranked.slice(0, lines.length - cap).map((x) => x.i));
      for (const i of drop) out.push(`${label}: “${lines[i].length > 90 ? `${lines[i].slice(0, 87)}…` : lines[i]}”`);
      return lines.filter((_, i) => !drop.has(i));
    };
    if (which === 'projects') {
      res.projects = res.projects.map((p) => {
        const lines = p.description.split(/\n+/).map((l) => l.trim()).filter(Boolean);
        return lines.length > cap ? { ...p, description: trim(lines, p.title).join('\n') } : p;
      });
    } else {
      res.experience = res.experience.map((e) => ({ ...e, bulletPoints: trim(e.bulletPoints, [e.jobTitle, e.company].filter(Boolean).join(' at ')) }));
    }
    return out;
  };

  const steps: Step[] = [
    { kind: 'layout', apply: (x) => (setStyle(x, { spacing: 0.85 }), ['Tighter spacing between sections']) },
    {
      kind: 'layout',
      apply: (x) => {
        const lh = Math.max(1.15, Math.round((base.style.lineHeight - 0.1) * 100) / 100);
        setStyle(x, { spacing: 0.7, lineHeight: lh });
        return [`Line spacing ${base.style.lineHeight} → ${lh}`];
      },
    },
    { kind: 'layout', apply: (x) => (base.margin > 0.5 ? (setStyle(x, { marginIn: 0.5 }), [`Page margins ${base.margin}in → 0.5in`]) : []) },
    { kind: 'layout', apply: (x) => (base.margin > 0.42 ? (setStyle(x, { marginIn: 0.42 }), [`Page margins ${base.margin}in → 0.42in`]) : []) },
    {
      kind: 'content',
      apply: (x) => {
        const hasDegree = x.education.some((e) => DEGREE.test(e.degree));
        if (!hasDegree || x.education.length < 2) return [];
        const school = x.education.filter((e) => SCHOOL.test(`${e.degree} ${e.institution}`));
        if (!school.length) return [];
        x.education = x.education.filter((e) => !school.includes(e));
        return school.map((e) => `Education: ${[e.degree, e.institution].filter(Boolean).join(', ')} (school result — least important once a degree is listed)`);
      },
    },
    {
      kind: 'content',
      apply: (x) => {
        const sentences = x.summary.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/).filter((s) => s.trim());
        if (sentences.length <= 3) return [];
        x.summary = sentences.slice(0, 3).join(' ');
        return sentences.slice(3).map((s) => `Summary: “${s}”`);
      },
    },
    { kind: 'content', apply: (x) => capLines(x, 3, 'projects') },
    { kind: 'content', apply: (x) => capLines(x, 5, 'experience') },
    {
      kind: 'layout',
      apply: (x) => {
        const body = Math.max(9, base.sizes.body - 0.5);
        setStyle(x, { bodySize: body, contactSize: Math.max(8, base.sizes.small - 0.5), headingSize: Math.max(10, base.sizes.heading - 0.5), nameSize: Math.max(16, base.sizes.name - 2) });
        return body < base.sizes.body ? [`Body text ${base.sizes.body}pt → ${body}pt`] : [];
      },
    },
    { kind: 'content', apply: (x) => capLines(x, 2, 'projects') },
    { kind: 'content', apply: (x) => capLines(x, 4, 'experience') },
    {
      kind: 'layout',
      apply: (x) => {
        const body = Math.max(8.5, base.sizes.body - 1);
        setStyle(x, { bodySize: body, spacing: 0.6, headlineSize: Math.max(10, base.sizes.headline - 1) });
        return body < base.sizes.body ? [`Body text → ${body}pt, spacing tightened further`] : [];
      },
    },
  ];

  let pages = before;
  for (const step of steps) {
    const next = normalizeResume(structuredClone(r));
    const notes = step.apply(next);
    if (!notes.length) continue;
    const n = await countPdfPages(next);
    // Keep a content step only if it actually helps; layout steps accumulate.
    if (step.kind === 'content' && n >= pages && measureShrink(r, next) === 0) continue;
    r = next;
    if (notes.some((x) => x.startsWith('Page margins'))) layout.splice(0, layout.length, ...layout.filter((x) => !x.startsWith('Page margins')));
    if (notes.some((x) => x.startsWith('Body text'))) layout.splice(0, layout.length, ...layout.filter((x) => !x.startsWith('Body text')));
    (step.kind === 'layout' ? layout : removed).push(...notes);
    pages = n;
    if (pages <= target) break;
  }
  r.layout = { ...r.layout, margins: r.layout?.margins || 'normal', pageTarget: target };
  return { resume: r, before, after: pages, target, layout, removed };
}

/** Characters removed between two versions (content steps that shrink text are kept even if the page count is unchanged yet). */
function measureShrink(a: ResumeData, b: ResumeData): number {
  return Math.max(0, resumeToPlainText(a).length - resumeToPlainText(b).length);
}
