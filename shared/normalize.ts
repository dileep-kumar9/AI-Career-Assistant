import type {
  Achievement,
  AtsTemplateType,
  Certification,
  CustomSection,
  Education,
  Experience,
  Project,
  ResumeData,
  ResumeLayout,
  ResumeSection,
  SkillCategory,
  StyleOverrides,
} from './resumeTypes.js';
import { ATS_TEMPLATE_IDS, cleanMissingValue } from './resumeTypes.js';
import { findFont } from './templates.js';

/**
 * Section order used by the session-based ATS builder. Every section has a
 * stable id so the AI (and the UI) can address one section without touching
 * the others.
 */
export const BUILDER_SECTIONS: ResumeSection[] = [
  { id: 'summary', title: 'Professional Summary', visible: true, order: 1 },
  { id: 'skills', title: 'Technical Skills', visible: true, order: 2 },
  { id: 'projects', title: 'Projects', visible: true, order: 3 },
  { id: 'experience', title: 'Professional Experience', visible: true, order: 4 },
  { id: 'education', title: 'Education', visible: true, order: 5 },
  { id: 'certifications', title: 'Certifications', visible: true, order: 6 },
  // Each custom section (e.g. "Strengths") prints under its own heading.
  { id: 'custom', title: 'Strengths & Other Sections', visible: true, order: 7 },
  { id: 'achievements', title: 'Achievements', visible: true, order: 8 },
];

export const SECTION_IDS = BUILDER_SECTIONS.map((s) => s.id);

export const DEFAULT_LAYOUT: ResumeLayout = { margins: 'normal', pageTarget: 1 };

export function newId(prefix: string): string {
  const rand =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${rand}`;
}

const str = (v: unknown, max = 5000): string => {
  const cleaned = cleanMissingValue(typeof v === 'number' ? String(v) : v);
  // Strip control characters that break PDF/DOCX generation.
  // eslint-disable-next-line no-control-regex
  return cleaned.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, max);
};

const strList = (v: unknown, maxItems = 60, maxLen = 1000): string[] =>
  Array.isArray(v) ? v.map((x) => str(x, maxLen).trim()).filter(Boolean).slice(0, maxItems) : [];

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Splits, trims and de-duplicates skill labels without altering their spelling. */
export function skillList(values: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    if (typeof v !== 'string') continue;
    for (const part of v.split(/\s*[,;•·|]\s*/)) {
      const label = part.replace(/^[-*\s]+|[.\s]+$/g, '').trim();
      if (!label || label.length > 60 || seen.has(label.toLowerCase())) continue;
      seen.add(label.toLowerCase());
      out.push(label);
    }
  }
  return out;
}

export function blankResume(): ResumeData {
  return {
    personalInfo: { fullName: '', jobTitle: '', email: '', phone: '', location: '', website: '', linkedin: '', github: '' },
    summary: '',
    experience: [],
    education: [],
    projects: [],
    skills: { mode: 'categorized', simple: [], categorized: [] },
    customSections: [],
    certifications: [],
    achievements: [],
    sections: BUILDER_SECTIONS.map((s) => ({ ...s })),
    colors: { primary: '#1f2937', secondary: '#4b5563', accent: '#1d4ed8', text: '#111827', background: '#ffffff' },
    template: 'professional',
    pageFormat: 'letter',
    fontSize: 'medium',
    fontFamily: 'Calibri',
    layout: { ...DEFAULT_LAYOUT },
  };
}

/**
 * Coerces any (possibly AI-produced or legacy) object into a valid ResumeData.
 * Missing ids are generated; existing ids are always preserved so that
 * section-level edits and diffs can match items across versions.
 */
export function normalizeResume(input: unknown): ResumeData {
  const base = blankResume();
  if (!isObj(input)) return base;
  const p = isObj(input.personalInfo) ? input.personalInfo : {};
  base.personalInfo = {
    fullName: str(p.fullName, 200),
    jobTitle: str(p.jobTitle, 200),
    email: str(p.email, 200),
    phone: str(p.phone, 100),
    location: str(p.location, 200),
    website: str(p.website, 500),
    linkedin: str(p.linkedin, 500),
    github: str(p.github, 500),
  };
  base.summary = str(input.summary, 4000).trim();

  base.experience = (Array.isArray(input.experience) ? input.experience : []).filter(isObj).map(
    (e): Experience => ({
      id: str(e.id, 80) || newId('exp'),
      jobTitle: str(e.jobTitle, 200),
      company: str(e.company, 200),
      location: str(e.location, 200),
      startDate: str(e.startDate, 40),
      endDate: str(e.endDate, 40),
      current: Boolean(e.current),
      description: str(e.description, 3000),
      bulletPoints: strList(e.bulletPoints ?? e.bullets, 30, 800),
    }),
  );
  // A role description that just repeats one of its bullets would print twice.
  const same = (a: string, b: string) => a.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() === b.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  for (const e of base.experience) {
    if (e.description && e.bulletPoints.some((b) => same(b, e.description))) e.description = '';
    // Extraction artefact: the description only restates "Title at Company".
    if (e.description && [e.jobTitle, e.company, `${e.jobTitle} at ${e.company}`, `${e.jobTitle} ${e.company}`].some((x) => x && same(x, e.description))) e.description = '';
    e.bulletPoints = e.bulletPoints.filter((b, i, all) => all.findIndex((x) => same(x, b)) === i);
  }

  base.education = (Array.isArray(input.education) ? input.education : []).filter(isObj).map(
    (e): Education => ({
      id: str(e.id, 80) || newId('edu'),
      degree: str(e.degree, 300),
      institution: str(e.institution, 300),
      location: str(e.location, 200),
      graduationYear: str(e.graduationYear, 40),
      gpa: str(e.gpa, 40),
      honors: str(e.honors, 500),
    }),
  );

  base.projects = (Array.isArray(input.projects) ? input.projects : []).filter(isObj).map(
    (x): Project => ({
      id: str(x.id, 80) || newId('proj'),
      title: str(x.title, 300),
      description: str(x.description, 3000),
      technologies: skillList(strList(x.technologies, 40, 100)),
      liveUrl: str(x.liveUrl, 500),
      githubUrl: str(x.githubUrl, 500),
      startDate: str(x.startDate, 40),
      endDate: str(x.endDate, 40),
    }),
  );

  const skills = isObj(input.skills) ? input.skills : Array.isArray(input.skills) ? { mode: 'simple', simple: input.skills } : {};
  const categorized: SkillCategory[] = (Array.isArray(skills.categorized) ? skills.categorized : [])
    .filter(isObj)
    .map((c: any) => ({ id: str(c.id, 80) || newId('skills'), name: str(c.name, 100) || 'Skills', skills: skillList(strList(c.skills, 80, 100)) }))
    .filter((c: SkillCategory) => c.skills.length)
    // Two categories with the same name (e.g. "Additional Skills" twice) become one.
    .reduce((acc: SkillCategory[], c: SkillCategory) => {
      const same = acc.find((x) => x.name.trim().toLowerCase() === c.name.trim().toLowerCase());
      if (same) same.skills = skillList([...same.skills, ...c.skills]);
      else acc.push(c);
      return acc;
    }, []);
  const simple = skillList(strList(skills.simple, 120, 100));
  base.skills = {
    mode: skills.mode === 'simple' || (!categorized.length && simple.length) ? 'simple' : 'categorized',
    simple,
    categorized,
  };

  base.customSections = (Array.isArray(input.customSections) ? input.customSections : []).filter(isObj).map(
    (c, i): CustomSection => ({
      id: str(c.id, 80) || newId('custom'),
      title: str(c.title, 200),
      content: str(c.content, 4000),
      type: c.type === 'paragraph' ? 'paragraph' : 'bullets',
      visible: c.visible !== false,
      order: Number.isFinite(c.order) ? Number(c.order) : i,
    }),
  ).filter((c) => c.title || c.content).map(retitleGeneric);

  base.certifications = (Array.isArray(input.certifications) ? input.certifications : [])
    .map((c: any): Certification | null => {
      if (typeof c === 'string') return c.trim() ? { id: newId('cert'), name: str(c, 300), issuer: '', date: '' } : null;
      if (!isObj(c)) return null;
      return { id: str(c.id, 80) || newId('cert'), name: str(c.name, 300), issuer: str(c.issuer, 200), date: str(c.date, 40) };
    })
    .filter((c): c is Certification => !!c && !!c.name);

  base.achievements = (Array.isArray(input.achievements) ? input.achievements : [])
    .map((a: any): Achievement | null => {
      if (typeof a === 'string') return a.trim() ? { id: newId('ach'), text: str(a, 800) } : null;
      if (!isObj(a)) return null;
      return { id: str(a.id, 80) || newId('ach'), text: str(a.text, 800) };
    })
    .filter((a): a is Achievement => !!a && !!a.text);

  base.sections = normalizeSections(input.sections);
  if (isObj(input.colors)) base.colors = { ...base.colors, ...pickStrings(input.colors, ['primary', 'secondary', 'accent', 'text', 'background']) };
  base.template = (ATS_TEMPLATE_IDS as string[]).includes(input.template) ? (input.template as AtsTemplateType) : 'professional';
  base.pageFormat = input.pageFormat === 'a4' ? 'a4' : 'letter';
  base.fontSize = ['small', 'medium', 'large'].includes(input.fontSize) ? input.fontSize : 'medium';
  base.fontFamily = str(input.fontFamily, 60) || base.fontFamily;
  const layout = isObj(input.layout) ? input.layout : {};
  const style = normalizeStyle(layout.style);
  base.layout = {
    margins: ['narrow', 'normal', 'wide'].includes(layout.margins) ? layout.margins : 'normal',
    pageTarget: layout.pageTarget === 2 ? 2 : 1,
    ...(style ? { style } : {}),
  };
  return base;
}

/** Validates style overrides: known fonts, point sizes within sane limits, #hex colours. */
export function normalizeStyle(input: unknown): StyleOverrides | undefined {
  if (!isObj(input)) return undefined;
  const out: StyleOverrides = {};
  const size = (v: unknown, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(Math.min(max, Math.max(min, n)) * 2) / 2 : undefined;
  };
  const colour = (v: unknown) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : undefined);
  const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined);
  const font = findFont(typeof input.fontFamily === 'string' ? input.fontFamily : undefined);
  const set = <K extends keyof StyleOverrides>(k: K, v: StyleOverrides[K] | undefined) => {
    if (v !== undefined) out[k] = v;
  };
  set('fontFamily', font?.name);
  set('nameSize', size(input.nameSize, 12, 36));
  set('headlineSize', size(input.headlineSize, 8, 24));
  set('headingSize', size(input.headingSize, 8, 20));
  set('bodySize', size(input.bodySize, 7, 16));
  set('contactSize', size(input.contactSize, 7, 14));
  set('nameColor', colour(input.nameColor));
  set('headlineColor', colour(input.headlineColor));
  set('headingColor', colour(input.headingColor));
  set('textColor', colour(input.textColor));
  set('contactColor', colour(input.contactColor));
  set('headingUppercase', bool(input.headingUppercase));
  set('headingRule', bool(input.headingRule));
  set('headlineBold', bool(input.headlineBold));
  set('nameAlign', input.nameAlign === 'left' || input.nameAlign === 'center' ? input.nameAlign : undefined);
  set('justify', bool(input.justify));
  const lh = Number(input.lineHeight);
  set('lineHeight', Number.isFinite(lh) && lh >= 1 && lh <= 2 ? Math.round(lh * 100) / 100 : undefined);
  const sp = Number(input.spacing);
  set('spacing', Number.isFinite(sp) && sp >= 0.4 && sp <= 2 ? Math.round(sp * 100) / 100 : undefined);
  const mi = Number(input.marginIn);
  set('marginIn', Number.isFinite(mi) && mi >= 0.3 && mi <= 1.2 ? Math.round(mi * 100) / 100 : undefined);
  return Object.keys(out).length ? out : undefined;
}

function pickStrings(obj: Record<string, any>, keys: string[]) {
  const out: Record<string, string> = {};
  for (const k of keys) if (typeof obj[k] === 'string' && /^#[0-9a-f]{3,8}$/i.test(obj[k])) out[k] = obj[k];
  return out;
}

/** Keeps the canonical section ids, preserving known order/visibility values. */
export function normalizeSections(input: unknown): ResumeSection[] {
  const given = Array.isArray(input) ? input.filter(isObj) : [];
  const byId = new Map(given.map((s) => [String(s.id), s]));
  const merged = BUILDER_SECTIONS.map((def) => {
    const s = byId.get(def.id);
    return {
      id: def.id,
      title: (s && str(s.title, 80)) || def.title,
      visible: s ? s.visible !== false : def.visible,
      order: s && Number.isFinite(Number(s.order)) ? Number(s.order) : def.order + 100,
    };
  });
  merged.sort((a, b) => a.order - b.order);
  return merged.map((s, i) => ({ ...s, order: i + 1 }));
}

export function collectSkills(r: Pick<ResumeData, 'skills'>): string[] {
  if (!r?.skills) return [];
  const all = [...(r.skills.simple || []), ...(r.skills.categorized || []).flatMap((c) => c.skills || [])];
  const seen = new Set<string>();
  return all.filter((s) => {
    const k = s.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function visibleSections(r: ResumeData): ResumeSection[] {
  return normalizeSections(r.sections).filter((s) => s.visible);
}

export function isSectionVisible(r: ResumeData, id: string): boolean {
  return visibleSections(r).some((s) => s.id === id);
}

/** Plain-text rendering used for keyword matching, diffs and AI context. */
export function resumeToPlainText(r: ResumeData, opts: { visibleOnly?: boolean } = {}): string {
  const show = (id: string) => !opts.visibleOnly || isSectionVisible(r, id);
  const lines: string[] = [];
  const p = r.personalInfo;
  lines.push(p.fullName, p.jobTitle, [p.email, p.phone, p.location, p.linkedin, p.website, p.github].filter(Boolean).join(' | '));
  if (show('summary') && r.summary) lines.push('PROFESSIONAL SUMMARY', r.summary);
  if (show('skills')) {
    const cats = r.skills.categorized?.length ? r.skills.categorized : [];
    if (cats.length || r.skills.simple.length) lines.push('SKILLS');
    for (const c of cats) lines.push(`${c.name}: ${c.skills.join(', ')}`);
    if (r.skills.simple.length) lines.push(r.skills.simple.join(', '));
  }
  if (show('experience') && r.experience.length) {
    lines.push('EXPERIENCE');
    for (const e of r.experience) {
      lines.push(`${e.jobTitle} | ${e.company} | ${e.location} | ${formatDateRange(e.startDate, e.endDate, e.current)}`);
      if (e.description) lines.push(e.description);
      for (const b of e.bulletPoints) lines.push(`- ${b}`);
    }
  }
  if (show('projects') && r.projects.length) {
    lines.push('PROJECTS');
    for (const x of r.projects) {
      lines.push(`${x.title}${x.technologies.length ? ` | ${x.technologies.join(', ')}` : ''}`);
      if (x.description) lines.push(x.description);
    }
  }
  if (show('education') && r.education.length) {
    lines.push('EDUCATION');
    for (const e of r.education) lines.push([e.degree, e.institution, e.location, e.graduationYear, e.gpa ? `GPA ${e.gpa}` : '', e.honors].filter(Boolean).join(' | '));
  }
  if (show('certifications') && r.certifications?.length) {
    lines.push('CERTIFICATIONS');
    for (const c of r.certifications) lines.push([c.name, c.issuer, c.date].filter(Boolean).join(' | '));
  }
  if (show('achievements') && r.achievements?.length) {
    lines.push('ACHIEVEMENTS');
    for (const a of r.achievements) lines.push(`- ${a.text}`);
  }
  if (show('custom')) for (const c of r.customSections || []) if (c.visible !== false) lines.push(c.title.toUpperCase(), c.content);
  return lines.filter((l) => l && l.trim()).join('\n');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(value: string): string {
  if (!value) return '';
  const m = value.match(/^(\d{4})-(\d{2})$/);
  if (m) return `${MONTHS[Number(m[2]) - 1] || ''} ${m[1]}`.trim();
  return value;
}

export function formatDateRange(start: string, end: string, current?: boolean): string {
  const s = formatDate(start);
  const e = current ? 'Present' : formatDate(end);
  if (s && e && s === e) return s;
  if (s && e) return `${s} – ${e}`;
  return s || e || '';
}

/** Word count of the visible resume body, used for readability checks. */
export function wordCount(text: string): number {
  return (text.match(/\b[\w'+#./-]+\b/g) || []).length;
}

const GENERIC_CUSTOM_TITLE = /^(additional\s+(information|info|details)|other(s| information| details)?|misc(ellaneous)?)$/i;

/** "Additional Information" holding "Strengths: …" becomes a "Strengths" section of its own. */
function retitleGeneric(c: CustomSection): CustomSection {
  if (c.title && !GENERIC_CUSTOM_TITLE.test(c.title.trim())) return c;
  const m = c.content.match(/^\s*[•\-*]?\s*([A-Za-z][A-Za-z &/]{2,40}?)\s*:\s*([\s\S]*)$/);
  if (!m || /\n\s*[•\-*]?\s*[A-Za-z][A-Za-z &/]{2,40}:/.test(m[2])) return c; // several labelled groups: keep as-is
  return { ...c, title: m[1].trim(), content: m[2].trim() };
}
