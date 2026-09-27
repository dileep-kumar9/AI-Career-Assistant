import type { AtsTemplateType, MarginSize, ResumeData } from './resumeTypes.js';

/**
 * Single-column, ATS-safe template definitions. The same values drive the
 * browser preview, the PDF renderer and the DOCX renderer so exports match
 * what the user sees. No tables, columns, icons, images or rating bars.
 */
export interface TemplateStyle {
  id: AtsTemplateType;
  name: string;
  description: string;
  bestFor: string;
  cssFont: string;
  pdfFont: string;
  pdfFontBold: string;
  pdfFontItalic: string;
  docxFont: string;
  /** Colour of the headline under the name. */
  accent: string;
  /** Colour of section headings. */
  headingColor: string;
  nameColor: string;
  text: string;
  muted: string;
  nameAlign: 'left' | 'center';
  /** "title" turns an ALL-CAPS name into Title Case for display. */
  nameCase: 'as-is' | 'title';
  headlineBold: boolean;
  headingUppercase: boolean;
  headingRule: boolean;
  headingLetterSpacing: number;
  /** inline: "Title | Company | Dates" on one line; split: title left, dates right. */
  entryStyle: 'inline' | 'split';
  /** bullets: "• Category: a, b"; lines: "Category: a, b". */
  skillsStyle: 'bullets' | 'lines';
  justify: boolean;
  /** Base sizes in points for the "medium" font size. */
  nameSize: number;
  headlineSize: number;
  headingSize: number;
  bodySize: number;
  contactSize: number;
  lineHeight: number;
  sectionGap: number;
  /** Multiplier for gaps between entries and bullets (sectionGap already includes it). */
  spacing: number;
  margins: Record<MarginSize, number>;
}

const DEFAULT_MARGINS: Record<MarginSize, number> = { narrow: 0.5, normal: 0.75, wide: 1 };

/**
 * Shared typography for every template (taken from the Professional template):
 * Helvetica, 20pt name, 9pt contact line, bold 13pt blue headline, bold 11pt
 * title-case headings, 9.5pt body. Templates differ only in layout.
 */
const TYPOGRAPHY = {
  cssFont: 'Helvetica, Arial, "Liberation Sans", sans-serif',
  pdfFont: 'Helvetica',
  pdfFontBold: 'Helvetica-Bold',
  pdfFontItalic: 'Helvetica-Oblique',
  docxFont: 'Arial',
  accent: '#1f5582',
  headingColor: '#111111',
  nameColor: '#111111',
  text: '#222222',
  muted: '#444444',
  nameCase: 'title' as const,
  headlineBold: true,
  headingUppercase: false,
  headingLetterSpacing: 0,
  nameSize: 20,
  headlineSize: 13,
  headingSize: 11,
  bodySize: 9.5,
  contactSize: 9,
  lineHeight: 1.4,
};

export const TEMPLATE_STYLES: Record<AtsTemplateType, TemplateStyle> = {
  professional: {
    ...TYPOGRAPHY,
    id: 'professional',
    name: 'Professional',
    description: 'Centred name and contact line, blue headline, inline “Title | Company | Dates” entries.',
    bestFor: 'Most roles — the default style',
    nameAlign: 'center',
    headingRule: false,
    entryStyle: 'inline',
    skillsStyle: 'bullets',
    justify: true,
    sectionGap: 12,
    spacing: 1,
    margins: { narrow: 0.5, normal: 0.64, wide: 0.85 },
  },
  'ats-classic': {
    ...TYPOGRAPHY,
    id: 'ats-classic',
    name: 'ATS Classic',
    description: 'Centred header, a thin line under each heading, dates aligned to the right.',
    bestFor: 'Any industry; conservative employers',
    nameAlign: 'center',
    headingRule: true,
    entryStyle: 'split',
    skillsStyle: 'lines',
    justify: false,
    sectionGap: 11,
    spacing: 1,
    margins: DEFAULT_MARGINS,
  },
  'modern-professional': {
    ...TYPOGRAPHY,
    id: 'modern-professional',
    name: 'Modern Professional',
    description: 'Left-aligned header, lines under headings, dates on the right.',
    bestFor: 'Corporate, business and general professional roles',
    nameAlign: 'left',
    headingRule: true,
    entryStyle: 'split',
    skillsStyle: 'lines',
    justify: false,
    sectionGap: 12,
    spacing: 1,
    margins: DEFAULT_MARGINS,
  },
  technical: {
    ...TYPOGRAPHY,
    id: 'technical',
    name: 'Technical Resume',
    description: 'Left-aligned, skills as bullet groups, inline entries — built for IT and engineering roles.',
    bestFor: 'System admin, DevOps, cloud, network, data and security roles',
    nameAlign: 'left',
    headingRule: true,
    entryStyle: 'inline',
    skillsStyle: 'bullets',
    justify: false,
    sectionGap: 10,
    spacing: 1,
    margins: DEFAULT_MARGINS,
  },
  minimal: {
    ...TYPOGRAPHY,
    id: 'minimal',
    name: 'Minimal',
    description: 'Compact left-aligned layout with no rules — fits more on one page.',
    bestFor: 'Early-career resumes and one-page targets',
    nameAlign: 'left',
    headingRule: false,
    entryStyle: 'inline',
    skillsStyle: 'lines',
    justify: false,
    sectionGap: 8,
    spacing: 1,
    margins: { narrow: 0.45, normal: 0.6, wide: 0.8 },
  },
};

export const FONT_SIZE_DELTA: Record<ResumeData['fontSize'], number> = { small: -0.75, medium: 0, large: 0.75 };

/**
 * Fonts users can choose. DOCX and the browser preview use the exact font; PDF
 * export uses the closest built-in PDF family (Helvetica, Times or Courier),
 * which keeps text selectable and ATS-readable without embedding font files.
 */
export const FONT_OPTIONS: Array<{ name: string; css: string; pdf: 'Helvetica' | 'Times' | 'Courier' }> = [
  { name: 'Helvetica', css: 'Helvetica, Arial, sans-serif', pdf: 'Helvetica' },
  { name: 'Arial', css: 'Arial, Helvetica, sans-serif', pdf: 'Helvetica' },
  { name: 'Calibri', css: 'Calibri, Carlito, Arial, sans-serif', pdf: 'Helvetica' },
  { name: 'Verdana', css: 'Verdana, Geneva, sans-serif', pdf: 'Helvetica' },
  { name: 'Tahoma', css: 'Tahoma, Verdana, sans-serif', pdf: 'Helvetica' },
  { name: 'Segoe UI', css: '"Segoe UI", Arial, sans-serif', pdf: 'Helvetica' },
  { name: 'Roboto', css: 'Roboto, Arial, sans-serif', pdf: 'Helvetica' },
  { name: 'Open Sans', css: '"Open Sans", Arial, sans-serif', pdf: 'Helvetica' },
  { name: 'Lato', css: 'Lato, Arial, sans-serif', pdf: 'Helvetica' },
  { name: 'Times New Roman', css: '"Times New Roman", Times, serif', pdf: 'Times' },
  { name: 'Georgia', css: 'Georgia, "Times New Roman", serif', pdf: 'Times' },
  { name: 'Garamond', css: 'Garamond, "EB Garamond", Georgia, serif', pdf: 'Times' },
  { name: 'Cambria', css: 'Cambria, Georgia, serif', pdf: 'Times' },
  { name: 'Book Antiqua', css: '"Book Antiqua", Palatino, Georgia, serif', pdf: 'Times' },
  { name: 'Courier New', css: '"Courier New", Courier, monospace', pdf: 'Courier' },
];

export function findFont(name: string | undefined) {
  if (!name) return undefined;
  const n = name.toLowerCase().replace(/[^a-z]/g, '');
  return FONT_OPTIONS.find((f) => f.name.toLowerCase().replace(/[^a-z]/g, '') === n) || (/times|serif/.test(n) ? FONT_OPTIONS[9] : /courier|mono/.test(n) ? FONT_OPTIONS[14] : /arial|sans|helvet/.test(n) ? FONT_OPTIONS[1] : undefined);
}

const PDF_FAMILIES = {
  Helvetica: { regular: 'Helvetica', bold: 'Helvetica-Bold', italic: 'Helvetica-Oblique' },
  Times: { regular: 'Times-Roman', bold: 'Times-Bold', italic: 'Times-Italic' },
  Courier: { regular: 'Courier', bold: 'Courier-Bold', italic: 'Courier-Oblique' },
} as const;

/** The template's style with the resume's own overrides (fonts, colours, sizes…) applied. */
export function templateStyle(r: Pick<ResumeData, 'template'> & { layout?: ResumeData['layout'] }): TemplateStyle {
  const base = TEMPLATE_STYLES[r.template as AtsTemplateType] || TEMPLATE_STYLES.professional;
  const o = r.layout?.style;
  if (!o) return base;
  const font = findFont(o.fontFamily);
  const pdf = font ? PDF_FAMILIES[font.pdf] : null;
  return {
    ...base,
    ...(font && pdf ? { cssFont: font.css, docxFont: font.name, pdfFont: pdf.regular, pdfFontBold: pdf.bold, pdfFontItalic: pdf.italic } : {}),
    ...(o.nameSize ? { nameSize: o.nameSize } : {}),
    ...(o.headlineSize ? { headlineSize: o.headlineSize } : {}),
    ...(o.headingSize ? { headingSize: o.headingSize } : {}),
    ...(o.bodySize ? { bodySize: o.bodySize } : {}),
    ...(o.contactSize ? { contactSize: o.contactSize } : {}),
    ...(o.nameColor ? { nameColor: o.nameColor } : {}),
    ...(o.headlineColor ? { accent: o.headlineColor } : {}),
    ...(o.headingColor ? { headingColor: o.headingColor } : {}),
    ...(o.textColor ? { text: o.textColor } : {}),
    ...(o.contactColor ? { muted: o.contactColor } : {}),
    ...(o.headingUppercase !== undefined ? { headingUppercase: o.headingUppercase } : {}),
    ...(o.headingRule !== undefined ? { headingRule: o.headingRule } : {}),
    ...(o.headlineBold !== undefined ? { headlineBold: o.headlineBold } : {}),
    ...(o.nameAlign ? { nameAlign: o.nameAlign } : {}),
    ...(o.justify !== undefined ? { justify: o.justify } : {}),
    ...(o.lineHeight ? { lineHeight: o.lineHeight } : {}),
    ...(o.spacing ? { spacing: o.spacing, sectionGap: base.sectionGap * o.spacing } : {}),
  };
}

export function marginInches(r: Pick<ResumeData, 'template' | 'layout'>): number {
  return r.layout?.style?.marginIn ?? templateStyle(r).margins[r.layout?.margins || 'normal'];
}

export function pageSizeInches(r: Pick<ResumeData, 'pageFormat'>): { width: number; height: number } {
  return r.pageFormat === 'a4' ? { width: 8.27, height: 11.69 } : { width: 8.5, height: 11 };
}

/** Resolved point sizes for a resume (template × font-size preference). */
export function resolvedSizes(r: Pick<ResumeData, 'template' | 'fontSize'> & { layout?: ResumeData['layout'] }) {
  const s = templateStyle(r);
  const o = r.layout?.style || {};
  const d = FONT_SIZE_DELTA[r.fontSize] ?? 0;
  // Sizes the user set explicitly (in points) are used exactly; others follow the Small/Medium/Large setting.
  return {
    name: o.nameSize ?? s.nameSize + d * 2,
    headline: o.headlineSize ?? s.headlineSize + d,
    heading: o.headingSize ?? s.headingSize + d,
    body: o.bodySize ?? s.bodySize + d,
    small: o.contactSize ?? s.contactSize + d,
  };
}

/** "BADHAM DILEEP KUMAR" → "Badham Dileep Kumar" when the template asks for it. */
export function displayName(r: Pick<ResumeData, 'template' | 'personalInfo'>): string {
  const name = r.personalInfo.fullName || '';
  if (templateStyle(r).nameCase !== 'title' || name !== name.toUpperCase()) return name;
  return name.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
}

/** "91.9%" stays as-is, "7.79 / 10" → "CGPA: 7.79 / 10", "3.6" → "GPA: 3.6". */
export function gradeText(gpa: string): string {
  const g = gpa.trim();
  if (!g) return '';
  if (/%|\b(gpa|cgpa|cpi|percent)/i.test(g)) return g;
  const n = parseFloat(g);
  return /\/\s*10\b/.test(g) || (n > 4.5 && n <= 10) ? `CGPA: ${g}` : `GPA: ${g}`;
}

/** Certification line without repeating an issuer that is already part of the name. */
export function certificationText(c: { name: string; issuer: string; date: string }, sep: string, formatDate: (d: string) => string): string {
  const issuer = c.issuer && !c.name.toLowerCase().includes(c.issuer.toLowerCase()) ? c.issuer : '';
  return [c.name, issuer].filter(Boolean).join(sep) + (c.date ? ` (${formatDate(c.date)})` : '');
}

export interface ContactItem {
  text: string;
  /** Present for items that should be clickable (email, LinkedIn, GitHub, portfolio). Phone is never a link. */
  href?: string;
}

/** Contact line items in display order: email | phone | location | LinkedIn | GitHub | portfolio. */
export function contactItems(r: Pick<ResumeData, 'personalInfo'>): ContactItem[] {
  const p = r.personalInfo;
  const clean = (u: string) => u.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
  const href = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);
  const items: ContactItem[] = [];
  if (p.email) items.push({ text: p.email, href: `mailto:${p.email}` });
  if (p.phone) items.push({ text: p.phone });
  if (p.location) items.push({ text: p.location });
  if (p.linkedin) items.push({ text: clean(p.linkedin), href: href(p.linkedin) });
  if (p.github) items.push({ text: clean(p.github), href: href(p.github) });
  if (p.website) items.push({ text: clean(p.website), href: href(p.website) });
  return items;
}

/** "STRENGTHS" → "Strengths"; mixed-case titles are kept as written. */
export function sectionHeading(title: string): string {
  const t = (title || '').trim();
  if (!t || t !== t.toUpperCase() || !/[A-Z]{2}/.test(t)) return t;
  return t.toLowerCase().replace(/(^|[\s&/(-])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase()).replace(/\b(And|Of|The|For|In)\b/g, (w, _x, i) => (i ? w.toLowerCase() : w));
}
