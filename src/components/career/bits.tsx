import React, { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import type { ApplicationStage } from '../../../shared/careerTypes';
import { STAGE_LABELS } from '../../../shared/careerTypes';
import { fileUrl } from '@/lib/careerApi';
import { cn } from '@/lib/utils';

const STAGE_STYLE: Record<ApplicationStage, string> = {
  found: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  matched: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  tailoring: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200',
  ready: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  applying: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200',
  needs_attention: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  skipped: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  failed: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  applied: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  interview: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200',
  offer: 'bg-green-600 text-white',
  rejected: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200',
  no_response: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  withdrawn: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
};

export const ACTIVE: ApplicationStage[] = ['found', 'tailoring', 'applying'];

export function StageBadge({ stage, className }: { stage: ApplicationStage; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', STAGE_STYLE[stage], className)}>
      {ACTIVE.includes(stage) && <Loader2 className="w-3 h-3 animate-spin" />}
      {STAGE_LABELS[stage]}
    </span>
  );
}

export function ScorePill({ label, value, className }: { label: string; value: number | null | undefined; className?: string }) {
  const tone = value === null || value === undefined ? 'text-muted-foreground' : value >= 75 ? 'text-emerald-600' : value >= 60 ? 'text-amber-600' : 'text-rose-600';
  return (
    <div className={cn('rounded-lg border bg-background px-3 py-2 text-center', className)}>
      <div className={cn('text-xl font-bold tabular-nums', tone)}>{value ?? '—'}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

export function Chips({ items, tone = 'neutral', empty }: { items: string[]; tone?: 'neutral' | 'good' | 'bad'; empty?: string }) {
  if (!items.length) return <span className="text-xs text-muted-foreground">{empty || '—'}</span>;
  const cls = tone === 'good' ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-900' : tone === 'bad' ? 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-200 dark:border-rose-900' : 'bg-muted text-foreground border-transparent';
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((s) => (
        <span key={s} className={cn('rounded-md border px-1.5 py-0.5 text-[11px]', cls)}>
          {s}
        </span>
      ))}
    </div>
  );
}

/** Tag input: Enter or comma adds, × removes. */
export function ChipsInput({ value, onChange, placeholder, max = 50 }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; max?: number }) {
  const [draft, setDraft] = useState('');
  const add = (raw: string) => {
    const parts = raw
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    for (const p of parts) if (!next.some((x) => x.toLowerCase() === p.toLowerCase())) next.push(p);
    onChange(next.slice(0, max));
    setDraft('');
  };
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md border bg-background px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring">
      {value.map((v) => (
        <span key={v} className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs">
          {v}
          <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))} className="text-muted-foreground hover:text-foreground">
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
      <input
        className="flex-1 min-w-[8rem] bg-transparent text-sm outline-none py-0.5"
        value={draft}
        placeholder={value.length ? '' : placeholder}
        onChange={(e) => (e.target.value.includes(',') ? add(e.target.value) : setDraft(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add(draft);
          } else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => add(draft)}
      />
    </div>
  );
}

/** PDF from an authenticated API path, shown inline. */
export function PdfPreview({ path, version, className }: { path: string; version?: string | null; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    setUrl(null);
    setError(null);
    fileUrl(path)
      .then((u) => {
        made = u;
        if (alive) setUrl(u);
        else URL.revokeObjectURL(u);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'Could not load the PDF.'));
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [path, version]);
  if (error) return <div className={cn('flex items-center justify-center rounded-lg border bg-muted/40 p-6 text-sm text-muted-foreground', className)}>{error}</div>;
  if (!url)
    return (
      <div className={cn('flex items-center justify-center rounded-lg border bg-muted/40', className)}>
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  return <iframe title="Tailored resume" src={url} className={cn('w-full rounded-lg border bg-white', className)} />;
}

export function Empty({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed bg-background p-8 text-center">
      <Icon className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

export const fmtDate = (iso: string | null | undefined, time = false) =>
  iso ? new Date(iso).toLocaleString(undefined, time ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }) : '—';

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');
