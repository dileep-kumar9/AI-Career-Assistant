import React from 'react';
import { ArrowDown, ArrowUp, Check, Eye, EyeOff } from 'lucide-react';
import type { ResumeData } from '../../../shared/resumeTypes';
import { ATS_TEMPLATE_IDS } from '../../../shared/resumeTypes';
import { normalizeSections } from '../../../shared/normalize';
import { FONT_OPTIONS, TEMPLATE_STYLES, resolvedSizes, templateStyle } from '../../../shared/templates';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type DesignPatch = { template?: string; fontSize?: string; margins?: string; pageTarget?: 1 | 2; pageFormat?: string; sections?: Array<{ id: string; visible: boolean; title?: string }>; style?: Record<string, unknown> | null };

const Segmented: React.FC<{ label: string; value: string; options: Array<[string, string]>; onChange: (v: string) => void; disabled?: boolean }> = ({ label, value, options, onChange, disabled }) => (
  <div className="space-y-1.5">
    <div className="text-xs font-medium">{label}</div>
    <div className="grid gap-1 rounded-lg bg-muted p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }} role="radiogroup" aria-label={label}>
      {options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          disabled={disabled}
          onClick={() => value !== v && onChange(v)}
          className={cn('rounded-md px-2 py-1 text-xs transition', value === v ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground')}
        >
          {l}
        </button>
      ))}
    </div>
  </div>
);

export const TemplatePanel: React.FC<{ resume: ResumeData; onChange: (patch: DesignPatch) => void; busy: boolean; readOnly?: boolean; pageCount: number }> = ({ resume, onChange, busy, readOnly, pageCount }) => (
  <div className="space-y-4">
    <div className="grid grid-cols-1 gap-2">
      {ATS_TEMPLATE_IDS.map((id) => {
        const t = TEMPLATE_STYLES[id];
        const active = resume.template === id;
        return (
          <button
            key={id}
            type="button"
            disabled={busy || readOnly}
            onClick={() => !active && onChange({ template: id })}
            className={cn('flex gap-3 rounded-lg border p-2.5 text-left transition hover:border-primary/60', active && 'border-primary ring-1 ring-primary')}
            aria-pressed={active}
          >
            <div className="w-12 h-16 shrink-0 rounded border bg-white p-1.5 flex flex-col gap-1" aria-hidden>
              <div className="h-1.5 rounded-sm" style={{ background: '#111', width: '70%', marginInline: t.nameAlign === 'center' ? 'auto' : 0 }} />
              {[0, 1, 2].map((i) => (
                <div key={i} className="space-y-0.5">
                  <div className="h-[3px] rounded-sm" style={{ background: t.accent, width: '45%' }} />
                  {t.headingRule && <div className="h-px" style={{ background: t.accent }} />}
                  <div className="h-[2px] bg-slate-300 rounded-sm" />
                  <div className="h-[2px] bg-slate-300 rounded-sm w-4/5" />
                </div>
              ))}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1 text-sm font-medium">
                {t.name} {active && <Check className="w-3.5 h-3.5 text-primary" />}
              </div>
              <div className="text-xs text-muted-foreground">{t.description}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">Best for: {t.bestFor}</div>
            </div>
          </button>
        );
      })}
    </div>
    <Segmented label="Font size" value={resume.fontSize} options={[['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']]} onChange={(v) => onChange({ fontSize: v })} disabled={busy || readOnly} />
    <Segmented label="Margins" value={resume.layout?.margins || 'normal'} options={[['narrow', 'Narrow'], ['normal', 'Normal'], ['wide', 'Wide']]} onChange={(v) => onChange({ margins: v })} disabled={busy || readOnly} />
    <Segmented label="Length" value={String(resume.layout?.pageTarget || 1)} options={[['1', 'One page'], ['2', 'Two pages']]} onChange={(v) => onChange({ pageTarget: v === '2' ? 2 : 1 })} disabled={busy || readOnly} />
    <Segmented label="Paper size" value={resume.pageFormat} options={[['letter', 'US Letter'], ['a4', 'A4']]} onChange={(v) => onChange({ pageFormat: v })} disabled={busy || readOnly} />
    <StyleControls resume={resume} onChange={onChange} disabled={busy || readOnly} />
    <div className={cn('rounded-md p-2 text-xs', pageCount > (resume.layout?.pageTarget || 1) ? 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200' : 'bg-muted text-muted-foreground')}>
      Estimated length: {pageCount} page{pageCount === 1 ? '' : 's'}
      {pageCount > (resume.layout?.pageTarget || 1) && ' — longer than your target. Try “Reduce this resume to one page” in the chat.'}
    </div>
    <p className="text-[11px] text-muted-foreground">All templates are single-column with standard headings, real text, and contact details in the body — no tables, graphics or rating bars.</p>
  </div>
);

const HeadlineControl: React.FC<{ value: string; onSave: (v: string) => void; disabled?: boolean }> = ({ value, onSave, disabled }) => {
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => setDraft(value), [value]);
  return (
    <div className="rounded-lg border p-2 space-y-1.5">
      <div className="text-sm font-medium">Line under your name</div>
      <input
        className="w-full rounded-md border bg-background px-2 py-1 text-sm"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="e.g. Python Developer (leave empty to hide)"
        maxLength={120}
        disabled={disabled}
        aria-label="Headline under your name"
      />
      <div className="flex gap-1.5">
        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={disabled || draft.trim() === value} onClick={() => onSave(draft.trim())}>
          Save
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={disabled || !value} onClick={() => onSave('')}>
          Remove line
        </Button>
      </div>
    </div>
  );
};

export const SectionsPanel: React.FC<{ resume: ResumeData; onChange: (patch: DesignPatch) => void; busy: boolean; readOnly?: boolean; onHeadline?: (v: string) => void }> = ({ resume, onChange, busy, readOnly, onHeadline }) => {
  const sections = normalizeSections(resume.sections);
  const count: Record<string, number> = {
    summary: resume.summary ? 1 : 0,
    skills: resume.skills.categorized.reduce((n, c) => n + c.skills.length, 0) + resume.skills.simple.length,
    experience: resume.experience.length,
    projects: resume.projects.length,
    education: resume.education.length,
    certifications: resume.certifications?.length || 0,
    achievements: resume.achievements?.length || 0,
    custom: resume.customSections.length,
  };
  const apply = (next: typeof sections) => onChange({ sections: next.map((s) => ({ id: s.id, visible: s.visible, title: s.title })) });
  const move = (i: number, d: number) => {
    const next = [...sections];
    const [s] = next.splice(i, 1);
    next.splice(i + d, 0, s);
    apply(next);
  };
  return (
    <div className="space-y-2">
      {onHeadline && <HeadlineControl value={resume.personalInfo.jobTitle || ''} onSave={onHeadline} disabled={busy || readOnly} />}
      <p className="text-xs text-muted-foreground">Reorder or hide sections. Hidden sections keep their content.</p>
      {sections.map((s, i) => (
        <div key={s.id} className={cn('flex items-center gap-2 rounded-lg border px-2 py-1.5', !s.visible && 'opacity-60')}>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{s.title}</div>
            <div className="text-[11px] text-muted-foreground">{count[s.id] ? `${count[s.id]} item${count[s.id] === 1 ? '' : 's'}` : 'Empty'}</div>
          </div>
          <Button size="icon" variant="ghost" className="h-7 w-7" disabled={i === 0 || busy || readOnly} onClick={() => move(i, -1)} aria-label={`Move ${s.title} up`}>
            <ArrowUp className="w-3.5 h-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" disabled={i === sections.length - 1 || busy || readOnly} onClick={() => move(i, 1)} aria-label={`Move ${s.title} down`}>
            <ArrowDown className="w-3.5 h-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" disabled={busy || readOnly} onClick={() => apply(sections.map((x) => (x.id === s.id ? { ...x, visible: !x.visible } : x)))} aria-label={s.visible ? `Hide ${s.title}` : `Show ${s.title}`}>
            {s.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          </Button>
        </div>
      ))}
    </div>
  );
};

/** Fonts, sizes, colours and heading styles — saved per resume on top of the template. */
const StyleControls: React.FC<{ resume: ResumeData; onChange: (patch: DesignPatch) => void; disabled?: boolean }> = ({ resume, onChange, disabled }) => {
  const st = templateStyle(resume);
  const sz = resolvedSizes(resume);
  const hasOverrides = !!resume.layout?.style && Object.keys(resume.layout.style).length > 0;
  const set = (patch: Record<string, unknown>) => onChange({ style: patch });
  const sizes: Array<[string, string, number]> = [['nameSize', 'Name', sz.name], ['headlineSize', 'Headline', sz.headline], ['headingSize', 'Headings', sz.heading], ['bodySize', 'Body text', sz.body], ['contactSize', 'Contact line', sz.small]];
  const colours: Array<[string, string, string]> = [['nameColor', 'Name', st.nameColor], ['headlineColor', 'Headline', st.accent], ['headingColor', 'Headings', st.headingColor], ['textColor', 'Body text', st.text], ['contactColor', 'Contact line', st.muted]];
  const toggles: Array<[string, string, boolean]> = [['headingUppercase', 'UPPERCASE headings', st.headingUppercase], ['headingRule', 'Line under headings', st.headingRule], ['headlineBold', 'Bold headline', st.headlineBold], ['justify', 'Justify paragraphs', st.justify]];
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Fonts & colours</div>
        <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={disabled || !hasOverrides} onClick={() => onChange({ style: null })}>
          Reset to template
        </Button>
      </div>
      <label className="block space-y-1 text-xs">
        <span className="font-medium">Font</span>
        <select className="w-full rounded-md border bg-background px-2 py-1 text-sm" value={FONT_OPTIONS.find((f) => f.name === resume.layout?.style?.fontFamily)?.name || ''} disabled={disabled} onChange={(e) => set({ fontFamily: e.target.value })}>
          <option value="" disabled>
            Template default ({st.docxFont})
          </option>
          {FONT_OPTIONS.map((f) => (
            <option key={f.name} value={f.name} style={{ fontFamily: f.css }}>
              {f.name}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        {sizes.map(([key, label, value]) => (
          <label key={key} className="space-y-1 text-xs">
            <span className="font-medium">{label} (pt)</span>
            <input
              type="number"
              step={0.5}
              min={7}
              max={36}
              defaultValue={value}
              key={`${key}-${value}`}
              disabled={disabled}
              className="w-full rounded-md border bg-background px-2 py-1 text-sm"
              onBlur={(e) => Number(e.target.value) !== value && set({ [key]: Number(e.target.value) })}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          </label>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {colours.map(([key, label, value]) => (
          <label key={key} className="flex items-center gap-2 text-xs">
            <input type="color" defaultValue={value} key={`${key}-${value}`} disabled={disabled} className="h-7 w-9 cursor-pointer rounded border bg-background p-0.5" onBlur={(e) => e.target.value.toLowerCase() !== value.toLowerCase() && set({ [key]: e.target.value })} aria-label={`${label} colour`} />
            {label}
          </label>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-1.5">
        {toggles.map(([key, label, value]) => (
          <label key={key} className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={value} disabled={disabled} onChange={(e) => set({ [key]: e.target.checked })} />
            {label}
          </label>
        ))}
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={st.nameAlign === 'center'} disabled={disabled} onChange={(e) => set({ nameAlign: e.target.checked ? 'center' : 'left' })} />
          Centre name & contact line
        </label>
      </div>
      <p className="text-[11px] text-muted-foreground">You can also ask in the chat, e.g. “change font to Georgia”, “headings size 12”, “make headings navy”. PDF export uses the closest built-in PDF font (Helvetica, Times or Courier); DOCX uses the exact font.</p>
    </div>
  );
};
