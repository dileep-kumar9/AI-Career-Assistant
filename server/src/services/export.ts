import PDFDocument from 'pdfkit';
import { AlignmentType, BorderStyle, Document, ExternalHyperlink, LevelFormat, Packer, Paragraph, TabStopType, TextRun } from 'docx';
import type { ResumeData } from '../../../shared/resumeTypes.js';
import { formatDate, formatDateRange, normalizeSections } from '../../../shared/normalize.js';
import { planPages } from '../../../shared/pagination.js';
import { certificationText, contactItems, displayName, gradeText, marginInches, pageSizeInches, resolvedSizes, sectionHeading, templateStyle } from '../../../shared/templates.js';

/**
 * Renders the resume to ATS-friendly PDF and DOCX files: single column,
 * real selectable text, standard headings, contact details in the body (not in
 * a header/footer), no tables, images, icons or rating bars. LinkedIn, GitHub,
 * portfolio and email are embedded as links styled like normal text (no blue,
 * no underline); the phone number is plain text.
 */

export interface RenderedFile {
  buffer: Buffer;
  pageCount: number;
  filename: string;
}

export function exportFileBase(r: ResumeData): string {
  const name = (r.personalInfo.fullName || 'resume').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'resume';
  return `${name}-resume`;
}

// The built-in PDF fonts use WinAnsi encoding; map common typographic
// characters and drop anything that cannot be encoded.
const PDF_REPLACEMENTS: Record<string, string> = { '→': '->', '←': '<-', '✓': '-', '★': '*', '▪': '•', '◦': '•', '●': '•', '−': '-', '\u2009': ' ', '≥': '>=', '≤': '<=' };
function pdfSafe(text: string): string {
  return String(text || '')
    .replace(/[→←✓★▪◦●−\u2009≥≤]/g, (c) => PDF_REPLACEMENTS[c] ?? '')
    .replace(/[^\t\n -~\u00A0-ÿ–—‘’“”•…€™]/g, '');
}

/** One block per rendered section; every custom section (e.g. Strengths) is its own block. */
type Block = { id: string; title: string; customId?: string };

function sectionsToRender(r: ResumeData): Block[] {
  return normalizeSections(r.sections)
    .filter((s) => s.visible)
    .filter((s) => {
      switch (s.id) {
        case 'summary':
          return !!r.summary.trim();
        case 'skills':
          return r.skills.categorized.some((c) => c.skills.length) || r.skills.simple.length > 0;
        case 'experience':
          return r.experience.length > 0;
        case 'projects':
          return r.projects.length > 0;
        case 'education':
          return r.education.length > 0;
        case 'certifications':
          return (r.certifications || []).length > 0;
        case 'achievements':
          return (r.achievements || []).length > 0;
        case 'custom':
          return (r.customSections || []).some((c) => c.visible !== false && (c.title || c.content));
        default:
          return false;
      }
    })
    .flatMap((s): Block[] =>
      s.id === 'custom'
        ? (r.customSections || []).filter((c) => c.visible !== false && (c.title || c.content)).map((c) => ({ id: 'custom', title: sectionHeading(c.title) || s.title, customId: c.id }))
        : [{ id: s.id, title: s.title }],
    );
}

export function contactParts(r: ResumeData): string[] {
  return contactItems(r).map((c) => c.text);
}

export function descriptionLines(text: string): string[] {
  return text
    .split(/\n+/)
    .map((l) => l.replace(/^[\s•\-*]+/, '').trim())
    .filter(Boolean);
}

/** Text runs for an entry header: [bold, rest..., dates] — shared by PDF and DOCX. */
function entryParts(bold: string, rest: string[], dates: string): Array<{ text: string; bold?: boolean; italic?: boolean }> {
  const parts: Array<{ text: string; bold?: boolean; italic?: boolean }> = [{ text: bold, bold: true }];
  for (const x of rest) if (x) parts.push({ text: ' | ' }, { text: x });
  if (dates) parts.push({ text: ` | ${dates}` });
  return parts;
}

// ------------------------------------------------------------------ PDF

/** Layout tuning for one render pass (see renderPdf). */
interface PdfTune {
  /** Measure-only pass: one very tall page, so nothing breaks. */
  tall?: boolean;
  /** Extra multiplier for every gap (sections, entries, bullets). */
  spacing: number;
  /** Added to the template line height. */
  lineExtra: number;
  /** Blocks (sections) that start on a new page. */
  breakBefore: Set<number>;
  /** Extra space (pt) added above a block to even out a page. */
  gapBefore: Map<number, number>;
}

interface PdfPass extends RenderedFile {
  /** Content height available on one page (pt). */
  contentHeight: number;
  /** Height used by the name/contact/headline header (pt). */
  headerHeight: number;
  /** Measured height of each block (section) including its heading gap. */
  blocks: Array<{ height: number; topGap: number }>;
}

const BASE_TUNE: PdfTune = { spacing: 1, lineExtra: 0, breakBefore: new Set(), gapBefore: new Map() };

/**
 * Page layout for multi-page resumes:
 *  1. a section that would be split across pages starts on the next page
 *     instead (only if the whole section fits on one page);
 *  2. the space that leaves at the bottom of the earlier page is filled by
 *     gently increasing line and section spacing for the whole resume (the
 *     same values on every page), without adding a page;
 *  3. any remainder is spread evenly between the sections on that page.
 * Every step is measured by rendering, so the result is exact for the PDF.
 */
export async function renderPdf(r: ResumeData): Promise<RenderedFile> {
  const base = await drawPdf(r, { ...BASE_TUNE, tall: true });
  const H = base.contentHeight;
  const firstPlan = planPages(base.headerHeight, base.blocks, H);
  if (firstPlan.pages <= 1) return drawPdf(r, BASE_TUNE);

  // Try slightly more generous spacing; keep the page count, minimise empty space.
  let best = { tune: BASE_TUNE, plan: firstPlan, cost: firstPlan.leftover };
  if (firstPlan.breaks.size && firstPlan.leftover > H * 0.05) {
    for (const lineExtra of [0, 0.08, 0.16]) {
      for (const spacing of [1, 1.15, 1.3, 1.45, 1.6]) {
        if (spacing === 1 && lineExtra === 0) continue;
        const tune = { ...BASE_TUNE, spacing, lineExtra };
        const m = await drawPdf(r, { ...tune, tall: true });
        const plan = planPages(m.headerHeight, m.blocks, H);
        if (plan.pages !== firstPlan.pages) continue;
        const cost = plan.leftover + (spacing - 1) * 20 + lineExtra * 60; // prefer the smallest change that works
        if (cost < best.cost) best = { tune, plan, cost };
      }
    }
  }
  const final = await drawPdf(r, { ...best.tune, breakBefore: best.plan.breaks, gapBefore: best.plan.gaps });
  // Safety net: if measurement and real layout ever disagree, fall back to plain flow.
  if (final.pageCount > best.plan.pages) return drawPdf(r, BASE_TUNE);
  return final;
}

async function drawPdf(r: ResumeData, tune: PdfTune): Promise<PdfPass> {
  const style = templateStyle(r);
  const size = resolvedSizes(r);
  const page = pageSizeInches(r);
  const margin = marginInches(r) * 72;
  const sp = tune.spacing;
  const doc = new PDFDocument({
    size: [page.width * 72, (tune.tall ? 200 : page.height) * 72],
    margins: { top: margin, bottom: margin, left: margin, right: margin },
    bufferPages: true,
    info: { Title: `${r.personalInfo.fullName || 'Resume'} – Resume`, Author: r.personalInfo.fullName || '', Creator: 'ATS Resume Builder' },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve, reject) => {
    doc.on('end', () => resolve());
    doc.on('error', reject);
  });

  const width = doc.page.width - margin * 2;
  const left = margin;
  const lineGap = size.body * (style.lineHeight + tune.lineExtra - 1.05);
  const align = style.justify ? 'justify' : 'left';
  const gap = (pts: number) => {
    doc.y += pts;
  };
  const ensureSpace = (pts: number) => {
    if (doc.y + pts > doc.page.height - margin) doc.addPage();
  };
  const body = (t: string, opts: PDFKit.Mixins.TextOptions = {}) =>
    doc.font(style.pdfFont).fontSize(size.body).fillColor(style.text).text(pdfSafe(t), left, doc.y, { width, lineGap, align, ...opts });

  const inline = style.entryStyle === 'inline';
  const bulletIndent = inline ? 18 : 16;
  const bullets = (items: string[]) => {
    if (inline) gap(3 * sp);
    for (const item of items) {
      ensureSpace(size.body * 2);
      const y = doc.y;
      doc.font(style.pdfFont).fontSize(size.body).fillColor(style.text).text('•', left + (inline ? 8 : 4), y, { width: 10, lineBreak: false });
      doc.text(pdfSafe(item), left + bulletIndent, y, { width: width - bulletIndent, lineGap, align });
      gap((inline ? 3 : 1.5) * sp);
    }
  };

  /** Writes styled segments on one flowing line (bold/italic runs, optional links). */
  const runs = (parts: Array<{ text: string; bold?: boolean; italic?: boolean; link?: string; color?: string }>, opts: { size: number; color: string; align?: 'left' | 'center' }) => {
    parts.forEach((p, i) => {
      const font = p.bold ? style.pdfFontBold : p.italic ? style.pdfFontItalic : style.pdfFont;
      const options: PDFKit.Mixins.TextOptions = { width, align: opts.align || 'left', continued: i < parts.length - 1, link: p.link || null, underline: false, lineGap: 1 };
      doc.font(font).fontSize(opts.size).fillColor(p.color || opts.color);
      // Continuation segments must be called WITHOUT coordinates, otherwise pdfkit drops the options (and `continued`).
      if (i === 0) doc.text(pdfSafe(p.text), left, doc.y, options);
      else doc.text(pdfSafe(p.text), options);
    });
  };

  const splitRow = (leftText: string, rightText: string) => {
    ensureSpace(size.body * 2.5);
    const y = doc.y;
    const rightWidth = rightText ? Math.min(170, doc.font(style.pdfFont).fontSize(size.body).widthOfString(pdfSafe(rightText)) + 4) : 0;
    doc.font(style.pdfFontBold).fontSize(size.body + 0.5).fillColor(style.text).text(pdfSafe(leftText), left, y, { width: width - rightWidth - 8 });
    const afterLeft = doc.y;
    if (rightText) doc.font(style.pdfFont).fontSize(size.body).fillColor(style.muted).text(pdfSafe(rightText), left + width - rightWidth, y + 0.5, { width: rightWidth, align: 'right', lineBreak: false });
    doc.y = Math.max(afterLeft, y + size.body * 1.3);
  };
  const entry = (bold: string, rest: string[], dates: string, italicFirst = false) => {
    if (!inline) return splitRow([bold, ...rest.filter(Boolean)].join(' — '), dates);
    ensureSpace(size.body * 2.5);
    const parts = entryParts(bold, rest, dates).map((p, i) => (italicFirst && i === 2 ? { ...p, italic: true } : p));
    runs(parts, { size: size.body, color: style.text });
  };

  const heading = (title: string) => {
    ensureSpace(size.heading * 4);
    if (doc.y > margin + 1) gap(style.sectionGap * 0.9 * sp); // no gap at the top of a page
    const text = style.headingUppercase ? title.toUpperCase() : title;
    doc.font(style.pdfFontBold).fontSize(size.heading).fillColor(style.headingColor).text(pdfSafe(text), left, doc.y, { width, characterSpacing: style.headingLetterSpacing });
    if (style.headingRule) {
      const y = doc.y + 1.5;
      doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.7).strokeColor(style.headingColor).stroke();
      doc.y = y + 4;
    } else gap(3);
  };

  // Header — in the document body so ATS parsers read it: name, contact line, headline.
  const p = r.personalInfo;
  doc.font(style.pdfFontBold).fontSize(size.name).fillColor(style.nameColor).text(pdfSafe(displayName(r) || 'Your Name'), left, doc.y, { width, align: style.nameAlign });
  const contacts = contactItems(r);
  if (contacts.length) {
    gap(3);
    // Drawn as whole lines (pdfkit cannot centre "continued" text reliably) with
    // clickable areas placed over LinkedIn / portfolio / email. Phone stays plain.
    doc.font(style.pdfFont).fontSize(size.small).fillColor(style.muted);
    const sep = ' | ';
    const lines: Array<typeof contacts> = [[]];
    for (const item of contacts) {
      const cur = lines[lines.length - 1];
      const trial = [...cur, item].map((x) => pdfSafe(x.text)).join(sep);
      if (cur.length && doc.widthOfString(trial) > width) lines.push([item]);
      else cur.push(item);
    }
    for (const line of lines) {
      const text = line.map((x) => pdfSafe(x.text)).join(sep);
      const w = doc.widthOfString(text);
      const x0 = style.nameAlign === 'center' ? left + (width - w) / 2 : left;
      const y = doc.y;
      doc.text(text, x0, y, { lineBreak: false });
      let offset = 0;
      line.forEach((item, i) => {
        const tw = doc.widthOfString(pdfSafe(item.text));
        if (item.href) doc.link(x0 + offset, y, tw, size.small * 1.2, item.href);
        offset += tw + (i < line.length - 1 ? doc.widthOfString(sep) : 0);
      });
      doc.x = left;
      doc.y = y + size.small * 1.35;
    }
  }
  if (p.jobTitle) {
    gap(style.headlineBold ? 9 : 2);
    doc
      .font(style.headlineBold ? style.pdfFontBold : style.pdfFont)
      .fontSize(size.headline)
      .fillColor(style.accent)
      .text(pdfSafe(p.jobTitle), left, doc.y, { width, align: style.nameAlign });
  }
  gap(2);
  const headerHeight = doc.y - margin;
  const measured: PdfPass['blocks'] = [];

  sectionsToRender(r).forEach((block, bi) => {
    if (tune.breakBefore.has(bi)) doc.addPage();
    const extra = tune.gapBefore.get(bi);
    if (extra) gap(extra);
    const start = doc.y;
    heading(block.title);
    switch (block.id) {
      case 'summary':
        body(r.summary);
        break;
      case 'skills': {
        const cats = r.skills.categorized.filter((c) => c.skills.length);
        for (const c of cats) {
          ensureSpace(size.body * 2);
          const bulleted = style.skillsStyle === 'bullets';
          const x = bulleted ? left + 12 : left;
          doc.font(style.pdfFontBold).fontSize(size.body).fillColor(style.text).text(pdfSafe(`${bulleted ? '• ' : ''}${c.name}: `), x, doc.y, { width: width - (x - left), continued: true, lineGap: 1 });
          doc.font(style.pdfFont).text(pdfSafe(c.skills.join(', ')), { lineGap: 1 });
          gap((bulleted ? 4 : 1) * sp);
        }
        if (r.skills.simple.length) body(r.skills.simple.join(', '));
        break;
      }
      case 'experience':
        r.experience.forEach((e, i) => {
          if (i) gap(style.sectionGap * 0.55 * sp);
          entry(e.jobTitle, [e.company, inline ? e.location : ''], formatDateRange(e.startDate, e.endDate, e.current));
          if (!inline && e.location) doc.font(style.pdfFontItalic).fontSize(size.small).fillColor(style.muted).text(pdfSafe(e.location), left, doc.y, { width });
          gap(2);
          if (e.description) body(e.description);
          bullets(e.bulletPoints);
        });
        break;
      case 'projects':
        r.projects.forEach((x, i) => {
          if (i) gap(style.sectionGap * 0.45 * sp);
          const dates = formatDateRange(x.startDate || '', x.endDate || '');
          if (inline) entry(x.title, [x.technologies.join(', ')], dates, true);
          else {
            entry(x.title, [], dates);
            if (x.technologies.length) doc.font(style.pdfFontItalic).fontSize(size.small).fillColor(style.muted).text(pdfSafe(`Technologies: ${x.technologies.join(', ')}`), left, doc.y, { width });
          }
          const lines = descriptionLines(x.description);
          gap(1.5);
          if (lines.length > 1 || inline) bullets(lines);
          else if (lines.length) body(lines[0]);
          const link = x.githubUrl || x.liveUrl;
          if (link) doc.font(style.pdfFont).fontSize(size.small).fillColor(style.muted).text(pdfSafe(link.replace(/^https?:\/\//, '')), left, doc.y, { width, link: /^https?:/i.test(link) ? link : `https://${link}`, underline: false });
        });
        break;
      case 'education':
        r.education.forEach((e, i) => {
          if (i) gap(3);
          const extra = [e.location, gradeText(e.gpa || ''), e.honors].filter(Boolean) as string[];
          if (inline) entry(e.degree, [e.institution, ...extra], formatDate(e.graduationYear));
          else {
            entry(e.degree, [e.institution], formatDate(e.graduationYear));
            if (extra.length) doc.font(style.pdfFont).fontSize(size.small).fillColor(style.muted).text(pdfSafe(extra.join('  |  ')), left, doc.y, { width });
          }
        });
        break;
      case 'certifications':
        bullets((r.certifications || []).map((c) => certificationText(c, inline ? ' | ' : ' — ', formatDate)));
        break;
      case 'achievements':
        bullets((r.achievements || []).map((a) => a.text));
        break;
      case 'custom': {
        const c = (r.customSections || []).find((x) => x.id === block.customId);
        if (!c) break;
        const lines = descriptionLines(c.content);
        if (c.type === 'bullets' && lines.length > 1) bullets(lines);
        else body(lines.join(' '));
        gap(2);
        break;
      }
    }
    measured.push({ height: doc.y - start, topGap: style.sectionGap * 0.9 * sp });
  });

  const pageCount = doc.bufferedPageRange().count;
  doc.end();
  await done;
  return { buffer: Buffer.concat(chunks), pageCount, filename: `${exportFileBase(r)}.pdf`, contentHeight: page.height * 72 - margin * 2, headerHeight, blocks: measured };
}

// ------------------------------------------------------------------ DOCX

export async function renderDocx(r: ResumeData): Promise<RenderedFile> {
  const style = templateStyle(r);
  const size = resolvedSizes(r);
  const page = pageSizeInches(r);
  const marginTw = Math.round(marginInches(r) * 1440);
  const contentWidthTw = Math.round(page.width * 1440) - marginTw * 2;
  const hp = (pt: number) => Math.round(pt * 2); // docx sizes are half-points
  const color = (hex: string) => hex.replace('#', '');
  const align = style.nameAlign === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT;
  const bodyAlign = style.justify ? AlignmentType.JUSTIFIED : AlignmentType.LEFT;
  const lineSpacing = Math.round(240 * style.lineHeight * 0.92);
  const inline = style.entryStyle === 'inline';

  // Paragraph options are collected first so a whole section can be marked
  // "keep with next" before the Paragraph objects are built.
  type POpts = { -readonly [K in keyof Exclude<ConstructorParameters<typeof Paragraph>[0], string>]: Exclude<ConstructorParameters<typeof Paragraph>[0], string>[K] };
  const P = (o: POpts): POpts => o;
  const children: POpts[] = [];
  const text = (t: string, o: { bold?: boolean; italics?: boolean; size?: number; color?: string } = {}) =>
    new TextRun({ text: t, bold: o.bold, italics: o.italics, size: hp(o.size ?? size.body), color: color(o.color ?? style.text), font: style.docxFont });
  const para = (runs: Array<TextRun | ExternalHyperlink>, extra: Record<string, unknown> = {}) => P({ children: runs, spacing: { after: 40, line: lineSpacing }, alignment: bodyAlign, ...extra });
  const bullet = (t: string) => P({ children: [text(t)], numbering: { reference: 'resume-bullets', level: 0 }, alignment: bodyAlign, spacing: { after: inline ? 50 : 30, line: lineSpacing } });
  const entry = (bold: string, rest: string[], dates: string, italicFirst = false) => {
    if (!inline) {
      return P({
        children: [text([bold, ...rest.filter(Boolean)].join(' — '), { bold: true, size: size.body + 0.5 }), ...(dates ? [new TextRun({ text: `\t${dates}`, size: hp(size.body), color: color(style.muted), font: style.docxFont })] : [])],
        tabStops: [{ type: TabStopType.RIGHT, position: contentWidthTw }],
        spacing: { before: 80, after: 20, line: lineSpacing },
        keepNext: true,
      });
    }
    return P({
      children: entryParts(bold, rest, dates).map((p, i) => text(p.text, { bold: p.bold, italics: p.italic || (italicFirst && i === 2) })),
      spacing: { before: 100, after: 40, line: lineSpacing },
      keepNext: true,
    });
  };
  const heading = (title: string) =>
    P({
      children: [new TextRun({ text: style.headingUppercase ? title.toUpperCase() : title, bold: true, size: hp(size.heading), color: color(style.headingColor), font: style.docxFont, characterSpacing: Math.round(style.headingLetterSpacing * 20) })],
      spacing: { before: Math.round(style.sectionGap * 22), after: 60 },
      keepNext: true,
      ...(style.headingRule ? { border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: color(style.headingColor), space: 1 } } } : {}),
    });

  const p = r.personalInfo;
  children.push(para([text(displayName(r) || 'Your Name', { bold: true, size: size.name, color: style.nameColor })], { alignment: align, spacing: { after: 40 } }));
  const contactRuns: Array<TextRun | ExternalHyperlink> = [];
  for (const [i, c] of contactItems(r).entries()) {
    if (i) contactRuns.push(text(' | ', { size: size.small, color: style.muted }));
    // Links are embedded but styled like the surrounding text (no blue, no underline).
    contactRuns.push(c.href ? new ExternalHyperlink({ link: c.href, children: [text(c.text, { size: size.small, color: style.muted })] }) : text(c.text, { size: size.small, color: style.muted }));
  }
  if (contactRuns.length) children.push(para(contactRuns, { alignment: align, spacing: { after: p.jobTitle ? 60 : 80 } }));
  if (p.jobTitle) children.push(para([text(p.jobTitle, { size: size.headline, color: style.accent, bold: style.headlineBold })], { alignment: align, spacing: { before: style.headlineBold ? 120 : 0, after: 80 } }));

  for (const block of sectionsToRender(r)) {
    const first = children.length;
    children.push(heading(block.title));
    switch (block.id) {
      case 'summary':
        children.push(para([text(r.summary)]));
        break;
      case 'skills':
        for (const c of r.skills.categorized.filter((x) => x.skills.length)) {
          if (style.skillsStyle === 'bullets') children.push(P({ children: [text(`${c.name}: `, { bold: true }), text(c.skills.join(', '))], numbering: { reference: 'resume-bullets', level: 0 }, spacing: { after: 60, line: lineSpacing } }));
          else children.push(para([text(`${c.name}: `, { bold: true }), text(c.skills.join(', '))]));
        }
        if (r.skills.simple.length) children.push(para([text(r.skills.simple.join(', '))]));
        break;
      case 'experience':
        for (const e of r.experience) {
          children.push(entry(e.jobTitle, [e.company, inline ? e.location : ''], formatDateRange(e.startDate, e.endDate, e.current)));
          if (!inline && e.location) children.push(para([text(e.location, { italics: true, size: size.small, color: style.muted })]));
          if (e.description) children.push(para([text(e.description)]));
          for (const b of e.bulletPoints) children.push(bullet(b));
        }
        break;
      case 'projects':
        for (const x of r.projects) {
          const dates = formatDateRange(x.startDate || '', x.endDate || '');
          if (inline) children.push(entry(x.title, [x.technologies.join(', ')], dates, true));
          else {
            children.push(entry(x.title, [], dates));
            if (x.technologies.length) children.push(para([text(`Technologies: ${x.technologies.join(', ')}`, { italics: true, size: size.small, color: style.muted })]));
          }
          const lines = descriptionLines(x.description);
          if (lines.length > 1 || inline) lines.forEach((l) => children.push(bullet(l)));
          else if (lines.length) children.push(para([text(lines[0])]));
          const link = x.githubUrl || x.liveUrl;
          if (link) children.push(para([new ExternalHyperlink({ link: /^https?:/i.test(link) ? link : `https://${link}`, children: [text(link.replace(/^https?:\/\//, ''), { size: size.small, color: style.muted })] })]));
        }
        break;
      case 'education':
        for (const e of r.education) {
          const extra = [e.location, gradeText(e.gpa || ''), e.honors].filter(Boolean) as string[];
          if (inline) children.push(entry(e.degree, [e.institution, ...extra], formatDate(e.graduationYear)));
          else {
            children.push(entry(e.degree, [e.institution], formatDate(e.graduationYear)));
            if (extra.length) children.push(para([text(extra.join('  |  '), { size: size.small, color: style.muted })]));
          }
        }
        break;
      case 'certifications':
        for (const c of r.certifications || []) children.push(bullet(certificationText(c, inline ? ' | ' : ' — ', formatDate)));
        break;
      case 'achievements':
        for (const a of r.achievements || []) children.push(bullet(a.text));
        break;
      case 'custom': {
        const c = (r.customSections || []).find((x) => x.id === block.customId);
        if (!c) break;
        const lines = descriptionLines(c.content);
        if (c.type === 'bullets' && lines.length > 1) lines.forEach((l) => children.push(bullet(l)));
        else children.push(para([text(lines.join(' '))]));
        break;
      }
    }
    // Keep a section together: Word moves it to the next page instead of splitting it.
    // (Very long sections are allowed to flow, keeping each entry's lines together.)
    const blockParas = children.slice(first);
    if (blockParas.length <= 30) blockParas.slice(0, -1).forEach((o) => (o.keepNext = true));
    blockParas.forEach((o) => (o.keepLines = true));
  }

  const doc = new Document({
    creator: 'ATS Resume Builder',
    title: `${p.fullName || 'Resume'} – Resume`,
    styles: { default: { document: { run: { font: style.docxFont, size: hp(size.body), color: color(style.text) } } } },
    numbering: {
      config: [
        {
          reference: 'resume-bullets',
          levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: inline ? 400 : 300, hanging: 200 } } } }],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: Math.round(page.width * 1440), height: Math.round(page.height * 1440) },
            margin: { top: marginTw, bottom: marginTw, left: marginTw, right: marginTw },
          },
        },
        children: children.map((o) => new Paragraph(o)),
      },
    ],
  });
  const buffer = await Packer.toBuffer(doc);
  // Word decides pagination; the PDF render gives the authoritative page estimate.
  const { pageCount } = await renderPdf(r);
  return { buffer, pageCount, filename: `${exportFileBase(r)}.docx` };
}

/** Page count exactly as renderPdf would paginate, from a single fast measuring pass. */
export async function countPdfPages(r: ResumeData): Promise<number> {
  const m = await drawPdf(r, { ...BASE_TUNE, tall: true });
  return planPages(m.headerHeight, m.blocks, m.contentHeight).pages;
}
