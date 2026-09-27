import { splitSentences, textKey } from '../../../shared/diff';
import { planPages } from '../../../shared/pagination';
import React, { useLayoutEffect, useRef, useState } from 'react';
import type { ResumeData } from '../../../shared/resumeTypes';
import { formatDate, formatDateRange, normalizeSections } from '../../../shared/normalize';
import { certificationText, contactItems, displayName, gradeText, marginInches, pageSizeInches, resolvedSizes, sectionHeading, templateStyle } from '../../../shared/templates';

const PX_PER_PT = 96 / 72;

const lines = (text: string) =>
  text
    .split(/\n+/)
    .map((l) => l.replace(/^[\s•\-*]+/, '').trim())
    .filter(Boolean);

/**
 * Renders the resume exactly like the server-side PDF/DOCX templates:
 * single column, real text, standard headings. Page boundaries are marked with
 * dashed guides so the user can see where content will break.
 *
 * Every element sets its own colour: global app styles (e.g. dark-mode heading
 * colours) must never leak into the white "paper".
 */
export const ResumeDocument: React.FC<{ resume: ResumeData; highlight?: string[]; changed?: Set<string>; onPageCount?: (n: number) => void }> = ({ resume: r, highlight = [], changed, onPageCount }) => {
  const style = templateStyle(r);
  const size = resolvedSizes(r);
  const page = pageSizeInches(r);
  const margin = marginInches(r) * 96;
  const pageW = page.width * 96;
  const pageH = page.height * 96;
  const contentH = pageH - margin * 2;
  const ref = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState(1);

  // Pagination mirrors the PDF export: a section that would be split between
  // pages starts on the next page (shared/pagination.ts), and the space that
  // leaves is spread between the sections above. Spacers are applied to the
  // DOM directly so measuring never triggers a React re-render loop.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const blocks = Array.from(el.querySelectorAll<HTMLElement>('[data-block]'));
      blocks.forEach((b) => (b.style.marginTop = '0px'));
      let n = Math.max(1, Math.ceil((el.scrollHeight - 2) / contentH));
      if (blocks.length && n > 1) {
        const tops = blocks.map((b) => b.offsetTop - el.offsetTop);
        const end = el.offsetHeight;
        const measured = blocks.map((b, i) => ({ height: (i < blocks.length - 1 ? tops[i + 1] : end) - tops[i], topGap: style.sectionGap * 1.1 }));
        const plan = planPages(tops[0], measured, contentH, 16 * PX_PER_PT);
        let pos = tops[0];
        measured.forEach((m, i) => {
          let spacer = plan.gaps.get(i) || 0;
          pos += spacer;
          if (plan.breaks.has(i)) {
            // Next page start (a position exactly on a boundary already is one).
            const boundary = Math.ceil((pos - 1) / contentH) * contentH;
            spacer += boundary - pos;
            pos = boundary;
          }
          if (spacer > 0) blocks[i].style.marginTop = `${spacer}px`;
          pos += m.height;
        });
        n = Math.max(1, Math.ceil((pos - 2) / contentH));
      }
      setPages(n);
      onPageCount?.(n);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [r, contentH, onPageCount]);

  const px = (pt: number) => `${(pt * PX_PER_PT).toFixed(2)}px`;
  // Version preview only: text this version added or rewrote gets a soft
  // yellow background. Nothing here reaches exports or the saved resume.
  const isChanged = (text: string) => !!changed?.size && !!text && changed.has(textKey(text));
  const changeMark = (node: React.ReactNode) => (
    <mark data-changed="true" title="Changed in this version" style={{ background: '#fef08a', color: 'inherit', borderRadius: 2, boxShadow: '0 0 0 1px #facc15' }}>
      {node}
    </mark>
  );
  const hl = (text: string): React.ReactNode => (isChanged(text) ? changeMark(kw(text)) : kw(text));
  /** Comma list where each changed item is marked on its own (skills). */
  const hlList = (items: string[]): React.ReactNode =>
    !changed?.size ? kw(items.join(', ')) : items.map((x, i) => <React.Fragment key={i}>{i > 0 && ', '}{hl(x)}</React.Fragment>);
  /** Paragraph where each changed sentence is marked (summary, descriptions). */
  const hlProse = (text: string): React.ReactNode =>
    !changed?.size ? kw(text) : splitSentences(text).map((x, i) => <React.Fragment key={i}>{i > 0 && ' '}{hl(x)}</React.Fragment>);
  const kw = (text: string): React.ReactNode => {
    if (!highlight.length || !text) return text;
    const re = new RegExp(`(${highlight.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
    return text.split(re).map((part, i) => (i % 2 ? <mark key={i} className="bg-emerald-100 text-inherit rounded-sm px-0.5">{part}</mark> : part));
  };
  const justify: React.CSSProperties = style.justify ? { textAlign: 'justify' } : {};

  const heading = (title: string) => (
    <div
      role="heading"
      aria-level={2}
      style={{
        fontSize: px(size.heading),
        color: style.headingColor,
        fontWeight: 700,
        letterSpacing: `${style.headingLetterSpacing}px`,
        textTransform: style.headingUppercase ? 'uppercase' : 'none',
        borderBottom: style.headingRule ? `1px solid ${style.headingColor}` : 'none',
        paddingBottom: style.headingRule ? 2 : 0,
        margin: `${style.sectionGap * 1.1}px 0 ${style.headingRule ? 5 : 4}px`,
        breakAfter: 'avoid',
      }}
    >
      {title}
    </div>
  );

  /** One entry header: inline "Bold | rest | dates" or split with dates on the right. */
  const entry = (bold: string, rest: string[], dates: string, italicRest = false) =>
    style.entryStyle === 'inline' ? (
      <div style={{ breakInside: 'avoid' }}>
        <strong>{hl(bold)}</strong>
        {rest.filter(Boolean).map((x, i) => (
          <span key={i}>
            {' | '}
            {italicRest && i === 0 ? <em>{hl(x)}</em> : hl(x)}
          </span>
        ))}
        {dates && ` | ${dates}`}
      </div>
    ) : (
      <div className="flex items-baseline justify-between gap-3" style={{ breakInside: 'avoid' }}>
        <div style={{ fontWeight: 700, fontSize: px(size.body + 0.5) }}>{hl([bold, ...rest.filter(Boolean)].join(' — '))}</div>
        {dates && <div className="shrink-0 whitespace-nowrap" style={{ color: style.muted, fontSize: px(size.body) }}>{dates}</div>}
      </div>
    );

  const bullets = (items: string[]) => (
    <ul style={{ margin: `${style.entryStyle === 'inline' ? 5 : 2}px 0 0`, paddingLeft: style.entryStyle === 'inline' ? 20 : 16, listStyle: 'disc', ...justify }}>
      {items.map((b, i) => (
        <li key={i} style={{ marginBottom: style.entryStyle === 'inline' ? 3 : 1.5 }}>
          {hl(b)}
        </li>
      ))}
    </ul>
  );

  const sections = normalizeSections(r.sections).filter((s) => s.visible);
  const p = r.personalInfo;
  const contacts = contactItems(r);

  return (
    <div className="relative text-left shadow-sm" style={{ width: pageW, minHeight: pageH * pages, padding: margin, background: '#ffffff', fontFamily: style.cssFont, color: style.text, fontSize: px(size.body), lineHeight: style.lineHeight }}>
      {Array.from({ length: pages - 1 }, (_, i) => (
        <div key={i} aria-hidden className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-sky-300" style={{ top: margin + contentH * (i + 1) }}>
          <span className="absolute right-2 -top-4 text-[10px] font-sans text-sky-600">Page {i + 2}</span>
        </div>
      ))}
      <div ref={ref} data-testid="resume-document">
        <header style={{ textAlign: style.nameAlign }}>
          <div role="heading" aria-level={1} style={{ fontSize: px(size.name), fontWeight: 700, lineHeight: 1.15, margin: 0, color: style.nameColor }}>
            {displayName(r) || 'Your Name'}
          </div>
          {contacts.length > 0 && (
            <div style={{ fontSize: px(size.small), color: style.muted, marginTop: 4 }}>
              {contacts.map((c, i) => (
                <React.Fragment key={i}>
                  {i > 0 && ' | '}
                  {c.href ? (
                    <a href={c.href} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>
                      {c.text}
                    </a>
                  ) : (
                    c.text
                  )}
                </React.Fragment>
              ))}
            </div>
          )}
          {p.jobTitle && <div style={{ fontSize: px(size.headline), color: style.accent, fontWeight: style.headlineBold ? 700 : 400, marginTop: style.headlineBold ? 12 : 3 }}>{hl(p.jobTitle)}</div>}
        </header>

        {sections.map((s) => {
          switch (s.id) {
            case 'summary':
              return r.summary ? (
                <section key={s.id} data-block style={{ display: 'flow-root' }}>
                  {heading(s.title)}
                  <p style={{ margin: 0, ...justify }}>{hlProse(r.summary)}</p>
                </section>
              ) : null;
            case 'skills': {
              const cats = r.skills.categorized.filter((c) => c.skills.length);
              if (!cats.length && !r.skills.simple.length) return null;
              return (
                <section key={s.id} data-block style={{ display: 'flow-root' }}>
                  {heading(s.title)}
                  {cats.map((c) => (
                    <div key={c.id} style={{ marginBottom: style.skillsStyle === 'bullets' ? 4 : 1.5, paddingLeft: style.skillsStyle === 'bullets' ? 12 : 0 }}>
                      {style.skillsStyle === 'bullets' && '• '}
                      <strong>{c.name}: </strong>
                      {hlList(c.skills)}
                    </div>
                  ))}
                  {r.skills.simple.length > 0 && <div>{hlList(r.skills.simple)}</div>}
                </section>
              );
            }
            case 'experience':
              return r.experience.length ? (
                <section key={s.id} data-block style={{ display: 'flow-root' }}>
                  {heading(s.title)}
                  {r.experience.map((e, i) => (
                    <div key={e.id} style={{ marginTop: i ? style.sectionGap * 0.7 : 0 }}>
                      {entry(e.jobTitle, [e.company, style.entryStyle === 'split' ? '' : e.location], formatDateRange(e.startDate, e.endDate, e.current))}
                      {style.entryStyle === 'split' && e.location && <div style={{ fontStyle: 'italic', color: style.muted, fontSize: px(size.small) }}>{e.location}</div>}
                      {e.description && <p style={{ margin: '2px 0 0', ...justify }}>{hlProse(e.description)}</p>}
                      {e.bulletPoints.length > 0 && bullets(e.bulletPoints)}
                    </div>
                  ))}
                </section>
              ) : null;
            case 'projects':
              return r.projects.length ? (
                <section key={s.id} data-block style={{ display: 'flow-root' }}>
                  {heading(s.title)}
                  {r.projects.map((x, i) => {
                    const desc = lines(x.description);
                    const dates = formatDateRange(x.startDate || '', x.endDate || '');
                    return (
                      <div key={x.id} style={{ marginTop: i ? style.sectionGap * 0.6 : 0 }}>
                        {style.entryStyle === 'inline' ? (
                          entry(x.title, [x.technologies.join(', ')], dates, true)
                        ) : (
                          <>
                            {entry(x.title, [], dates)}
                            {x.technologies.length > 0 && <div style={{ fontStyle: 'italic', color: style.muted, fontSize: px(size.small) }}>Technologies: {hlList(x.technologies)}</div>}
                          </>
                        )}
                        {desc.length > 1 || style.entryStyle === 'inline' ? bullets(desc) : desc.length ? <p style={{ margin: '2px 0 0', ...justify }}>{hl(desc[0])}</p> : null}
                        {(x.githubUrl || x.liveUrl) && (
                          <a href={x.githubUrl || x.liveUrl} target="_blank" rel="noreferrer" style={{ color: style.muted, fontSize: px(size.small), textDecoration: 'none' }}>
                            {(x.githubUrl || x.liveUrl || '').replace(/^https?:\/\//, '')}
                          </a>
                        )}
                      </div>
                    );
                  })}
                </section>
              ) : null;
            case 'education':
              return r.education.length ? (
                <section key={s.id} data-block style={{ display: 'flow-root' }}>
                  {heading(s.title)}
                  {r.education.map((e, i) => {
                    const extra = [e.location, gradeText(e.gpa || ''), e.honors].filter(Boolean);
                    return style.entryStyle === 'inline' ? (
                      <div key={e.id} style={{ marginTop: i ? 3 : 0 }}>{entry(e.degree, [e.institution, ...extra], formatDate(e.graduationYear))}</div>
                    ) : (
                      <div key={e.id} style={{ marginTop: i ? 4 : 0 }}>
                        {entry(e.degree, [e.institution], formatDate(e.graduationYear))}
                        {extra.length > 0 && <div style={{ color: style.muted, fontSize: px(size.small) }}>{extra.join('  |  ')}</div>}
                      </div>
                    );
                  })}
                </section>
              ) : null;
            case 'certifications':
              return r.certifications?.length ? (
                <section key={s.id} data-block style={{ display: 'flow-root' }}>
                  {heading(s.title)}
                  {bullets(r.certifications.map((c) => certificationText(c, style.entryStyle === 'inline' ? ' | ' : ' — ', formatDate)))}
                </section>
              ) : null;
            case 'achievements':
              return r.achievements?.length ? (
                <section key={s.id} data-block style={{ display: 'flow-root' }}>
                  {heading(s.title)}
                  {bullets(r.achievements.map((a) => a.text))}
                </section>
              ) : null;
            case 'custom': {
              const custom = (r.customSections || []).filter((c) => c.visible !== false && (c.title || c.content));
              return custom.length ? (
                <section key={s.id}>
                  {custom.map((c) => (
                    <div key={c.id} data-block style={{ display: 'flow-root', paddingBottom: 3 }}>
                      {heading(sectionHeading(c.title) || s.title)}
                      {c.type === 'bullets' && lines(c.content).length > 1 ? bullets(lines(c.content)) : <p style={{ margin: 0 }}>{hl(lines(c.content).join(' '))}</p>}
                    </div>
                  ))}
                </section>
              ) : null;
            }
            default:
              return null;
          }
        })}
      </div>
    </div>
  );
};

/** Scales the fixed-width document to fit its container. */
export const ScaledResume: React.FC<{ resume: ResumeData; highlight?: string[]; changed?: Set<string>; maxScale?: number; onPageCount?: (n: number) => void }> = ({ resume, highlight, changed, maxScale = 1, onPageCount }) => {
  const host = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState(0);
  const pageW = pageSizeInches(resume).width * 96;

  useLayoutEffect(() => {
    const update = () => {
      const w = host.current?.clientWidth || pageW;
      const s = Math.min(maxScale, Math.max(0.3, (w - 8) / pageW));
      setScale(s);
      setHeight((inner.current?.offsetHeight || 0) * s);
    };
    update();
    const ro = new ResizeObserver(update);
    if (host.current) ro.observe(host.current);
    if (inner.current) ro.observe(inner.current);
    return () => ro.disconnect();
  }, [pageW, maxScale, resume]);

  return (
    <div ref={host} className="w-full" style={{ height: height || undefined }}>
      <div ref={inner} className="mx-auto origin-top-left" style={{ width: pageW, transform: `scale(${scale})`, marginLeft: `max(0px, calc((100% - ${pageW * scale}px) / 2))` }}>
        <ResumeDocument resume={resume} highlight={highlight} changed={changed} onPageCount={onPageCount} />
      </div>
    </div>
  );
};
