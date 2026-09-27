import type { ResumeData } from './resumeTypes.js';
import { collectSkills, formatDateRange, normalizeSections } from './normalize.js';

export interface ResumeChange {
  section: string;
  label: string;
  type: 'added' | 'removed' | 'modified';
  item?: string;
  before?: string;
  after?: string;
}

export interface DiffToken {
  type: 'same' | 'add' | 'del';
  text: string;
}

/** Word-level LCS diff, bounded to keep it cheap for long texts. */
export function wordDiff(before: string, after: string): DiffToken[] {
  const a = before.split(/(\s+)/).filter((x) => x !== '');
  const b = after.split(/(\s+)/).filter((x) => x !== '');
  if (a.length * b.length > 250_000) {
    return [
      ...(before ? [{ type: 'del' as const, text: before }] : []),
      ...(after ? [{ type: 'add' as const, text: after }] : []),
    ];
  }
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffToken[] = [];
  const push = (type: DiffToken['type'], text: string) => {
    const last = out[out.length - 1];
    if (last && last.type === type) last.text += text;
    else out.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push('same', a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) push('del', a[i++]);
    else push('add', b[j++]);
  }
  while (i < a.length) push('del', a[i++]);
  while (j < b.length) push('add', b[j++]);
  return out;
}

function listDiff<T extends { id: string }>(
  section: string,
  label: string,
  before: T[],
  after: T[],
  name: (x: T) => string,
  body: (x: T) => string,
  out: ResumeChange[],
) {
  const beforeById = new Map(before.map((x) => [x.id, x]));
  const afterIds = new Set(after.map((x) => x.id));
  for (const x of after) {
    const prev = beforeById.get(x.id);
    if (!prev) out.push({ section, label, type: 'added', item: name(x), after: body(x) });
    else if (body(prev) !== body(x) || name(prev) !== name(x)) out.push({ section, label, type: 'modified', item: name(x), before: body(prev), after: body(x) });
  }
  for (const x of before) if (!afterIds.has(x.id)) out.push({ section, label, type: 'removed', item: name(x), before: body(x) });
  const order = (arr: T[]) => arr.filter((x) => beforeById.has(x.id) && afterIds.has(x.id)).map((x) => x.id).join('|');
  if (order(before) !== order(after)) out.push({ section, label, type: 'modified', item: 'Order', before: before.map(name).join(', '), after: after.map(name).join(', ') });
}

export function diffResumes(before: ResumeData, after: ResumeData): ResumeChange[] {
  const out: ResumeChange[] = [];
  const pi = (r: ResumeData) => r.personalInfo;
  for (const key of ['fullName', 'jobTitle', 'email', 'phone', 'location', 'linkedin', 'website', 'github'] as const) {
    if ((pi(before)[key] || '') !== (pi(after)[key] || '')) out.push({ section: 'personalInfo', label: 'Contact & headline', type: 'modified', item: key, before: pi(before)[key] || '', after: pi(after)[key] || '' });
  }
  if (before.summary !== after.summary) out.push({ section: 'summary', label: 'Professional Summary', type: before.summary ? (after.summary ? 'modified' : 'removed') : 'added', before: before.summary, after: after.summary });

  const skillText = (r: ResumeData) =>
    r.skills.categorized?.length ? r.skills.categorized.map((c) => `${c.name}: ${c.skills.join(', ')}`).join('\n') + (r.skills.simple.length ? `\n${r.skills.simple.join(', ')}` : '') : r.skills.simple.join(', ');
  if (skillText(before) !== skillText(after)) {
    const a = new Set(collectSkills(before).map((s) => s.toLowerCase()));
    const b = new Set(collectSkills(after).map((s) => s.toLowerCase()));
    const added = collectSkills(after).filter((s) => !a.has(s.toLowerCase()));
    const removed = collectSkills(before).filter((s) => !b.has(s.toLowerCase()));
    out.push({
      section: 'skills',
      label: 'Skills',
      type: 'modified',
      item: [added.length && `added ${added.join(', ')}`, removed.length && `removed ${removed.join(', ')}`].filter(Boolean).join('; ') || 'reordered',
      before: skillText(before),
      after: skillText(after),
    });
  }

  listDiff('experience', 'Experience', before.experience, after.experience, (e) => `${e.jobTitle} — ${e.company}`, (e) => [formatDateRange(e.startDate, e.endDate, e.current), e.description, ...e.bulletPoints.map((b) => `• ${b}`)].filter(Boolean).join('\n'), out);
  listDiff('projects', 'Projects', before.projects, after.projects, (p) => p.title, (p) => [p.technologies.join(', '), p.description].filter(Boolean).join('\n'), out);
  listDiff('education', 'Education', before.education, after.education, (e) => e.degree, (e) => [e.institution, e.graduationYear, e.gpa, e.honors].filter(Boolean).join(' | '), out);
  listDiff('certifications', 'Certifications', before.certifications || [], after.certifications || [], (c) => c.name, (c) => [c.name, c.issuer, c.date].filter(Boolean).join(' | '), out);
  listDiff('achievements', 'Achievements', before.achievements || [], after.achievements || [], (a) => a.text.slice(0, 60), (a) => a.text, out);
  listDiff('custom', 'Additional sections', before.customSections || [], after.customSections || [], (c) => c.title, (c) => c.content, out);

  const secs = (r: ResumeData) => normalizeSections(r.sections);
  const secKey = (r: ResumeData) => secs(r).map((s) => `${s.id}:${s.visible ? 1 : 0}:${s.title}`).join('|');
  if (secKey(before) !== secKey(after)) {
    const fmt = (r: ResumeData) => secs(r).filter((s) => s.visible).map((s) => s.title).join(' → ');
    out.push({ section: 'sections', label: 'Section order & visibility', type: 'modified', before: fmt(before), after: fmt(after) });
  }
  const styleText = (r: ResumeData) => Object.entries(r.layout?.style || {}).map(([k, v]) => `${k}: ${v}`).join(', ');
  const design = (r: ResumeData) => `${r.template} | font size ${r.fontSize} | ${r.pageFormat} | margins ${r.layout?.margins} | ${r.layout?.pageTarget} page(s)${styleText(r) ? ` | ${styleText(r)}` : ''}`;
  if (design(before) !== design(after)) out.push({ section: 'design', label: 'Template & layout', type: 'modified', before: design(before), after: design(after) });
  return out;
}

export function summarizeChanges(changes: ResumeChange[]): string[] {
  if (!changes.length) return ['No differences.'];
  return changes.map((c) => {
    const what = c.item ? `${c.label} (${c.item})` : c.label;
    return c.type === 'added' ? `Added ${what}` : c.type === 'removed' ? `Removed ${what}` : `Updated ${what}`;
  });
}

/** Normalised key used to compare rendered text units between versions. */
export function textKey(text: string): string {
  return (text || '').toLowerCase().replace(/[^a-z0-9+#%.]+/g, ' ').trim();
}

export function splitSentences(text: string): string[] {
  return (text || '').split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/).map((s) => s.trim()).filter(Boolean);
}

function textUnits(r: ResumeData): string[] {
  const lines = (t: string) => (t || '').split(/\n+/).map((l) => l.replace(/^[\s•\-*]+/, '').trim()).filter(Boolean);
  return [
    r.personalInfo.jobTitle,
    ...splitSentences(r.summary),
    ...collectSkills(r),
    ...r.skills.categorized.map((c) => c.name),
    ...r.experience.flatMap((e) => [e.jobTitle, e.company, e.location, ...splitSentences(e.description), ...e.bulletPoints, formatDateRange(e.startDate, e.endDate, e.current)]),
    ...r.projects.flatMap((p) => [p.title, p.technologies.join(', '), ...lines(p.description)]),
    ...r.education.flatMap((e) => [e.degree, e.institution]),
    ...(r.certifications || []).map((c) => c.name),
    ...(r.achievements || []).map((a) => a.text),
    ...(r.customSections || []).flatMap((c) => [c.title, ...lines(c.content)]),
  ].filter((t): t is string => !!t && !!t.trim());
}

/**
 * Text units (bullets, summary sentences, skills, headline…) present in
 * `after` but not in `before` — used to highlight what a version changed
 * while previewing it. Keys are `textKey()`-normalised.
 */
export function changedTexts(before: ResumeData, after: ResumeData): Set<string> {
  const old = new Set(textUnits(before).map(textKey));
  return new Set(textUnits(after).map(textKey).filter((k) => k && !old.has(k)));
}
