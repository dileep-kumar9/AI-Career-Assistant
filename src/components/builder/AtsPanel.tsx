import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleDashed, Info, Loader2, RefreshCw, Sparkles, TrendingUp, XCircle } from 'lucide-react';
import type { AtsResult, KeywordResult } from '../../../shared/ats';
import type { ImprovementPlan } from '../../../shared/improve';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export function scoreTone(score: number) {
  if (score >= 80) return { ring: '#059669', text: 'text-emerald-700 dark:text-emerald-400', label: 'Strong match' };
  if (score >= 60) return { ring: '#d97706', text: 'text-amber-700 dark:text-amber-400', label: 'Fair match' };
  return { ring: '#dc2626', text: 'text-red-700 dark:text-red-400', label: 'Weak match' };
}

export const ScoreRing: React.FC<{ score: number; size?: number; stroke?: number }> = ({ score, size = 104, stroke = 9 }) => {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const tone = scoreTone(score);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`ATS compatibility ${score} out of 100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-muted" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone.ring} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} style={{ transition: 'stroke-dashoffset 600ms ease' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn('font-bold tabular-nums leading-none', tone.text)} style={{ fontSize: Math.round(size * 0.29) }}>
          {score}
        </span>
        {size >= 64 && <span className="text-[11px] text-muted-foreground mt-0.5">/ 100</span>}
      </div>
    </div>
  );
};

export const ScoreDelta: React.FC<{ previous: number | null; current: number }> = ({ previous, current }) => {
  if (previous === null || previous === undefined) return null;
  const d = current - previous;
  return (
    <div className="text-xs text-muted-foreground space-y-0.5">
      <div>
        Previous: <span className="tabular-nums font-medium text-foreground">{previous}</span> · Current: <span className="tabular-nums font-medium text-foreground">{current}</span>
      </div>
      <div className={cn('font-semibold tabular-nums', d > 0 ? 'text-emerald-600' : d < 0 ? 'text-red-600' : 'text-muted-foreground')}>
        Change: {d > 0 ? '+' : ''}
        {d} point{Math.abs(d) === 1 ? '' : 's'}
      </div>
    </div>
  );
};

const statusStyle: Record<string, string> = {
  matched: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900',
  partial: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900',
  missing: 'bg-red-50 text-red-800 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900',
};
const StatusIcon = ({ status }: { status: string }) =>
  status === 'matched' ? <CheckCircle2 className="w-3 h-3" /> : status === 'partial' ? <CircleDashed className="w-3 h-3" /> : <XCircle className="w-3 h-3" />;

const KeywordChip: React.FC<{ k: KeywordResult; onAsk?: (instruction: string) => void; disabled?: boolean }> = ({ k, onAsk, disabled }) => (
  <Popover>
    <PopoverTrigger asChild>
      <button type="button" className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium hover:shadow-sm transition', statusStyle[k.status])} aria-label={`${k.keyword}: ${k.status}`}>
        <StatusIcon status={k.status} />
        {k.keyword}
        {k.evidence.labOnly && <span className="text-[9px] uppercase tracking-wide opacity-70">lab</span>}
      </button>
    </PopoverTrigger>
    <PopoverContent className="w-80 text-sm space-y-2" align="start">
      <div className="flex items-center justify-between gap-2">
        <strong>{k.keyword}</strong>
        <span className={cn('rounded-full border px-2 py-0.5 text-[11px] capitalize', statusStyle[k.status])}>{k.status}</span>
      </div>
      <p className="text-muted-foreground">{k.why}</p>
      {k.foundIn.length > 0 && <p className="text-xs">Found in: {k.foundIn.join(', ')}</p>}
      <div className="rounded-md bg-muted p-2 text-xs">
        <div className="font-medium mb-0.5">Evidence in your original resume</div>
        {k.evidence.inOriginal ? (
          <>
            <div>
              Yes — {k.evidence.originalSection}
              {k.evidence.labOnly ? ' (lab/training context only)' : ''}
            </div>
            {k.evidence.originalSnippet && <div className="mt-1 italic text-muted-foreground">“{k.evidence.originalSnippet}”</div>}
          </>
        ) : (
          <div>No evidence found.</div>
        )}
      </div>
      <p className="text-xs">{k.recommendation}</p>
      {onAsk && k.status !== 'matched' && k.evidence.inOriginal && (
        <Button size="sm" className="w-full" disabled={disabled} onClick={() => onAsk(k.evidence.labOnly ? `Mention ${k.keyword} honestly as lab/training experience, only where my original resume supports it.` : `Surface ${k.keyword} in my resume using only the evidence from my original resume.`)}>
          <Sparkles className="w-3.5 h-3.5 mr-1" /> Ask AI to add it truthfully
        </Button>
      )}
    </PopoverContent>
  </Popover>
);


const PlanCard: React.FC<{ plan: ImprovementPlan; onAsk?: (instruction: string) => void; busy?: boolean }> = ({ plan, onAsk, busy }) => {
  const [picked, setPicked] = useState<string[]>([]);
  if (!plan.steps.length) return null;
  const toggle = (k: string) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-1.5"><TrendingUp className="w-4 h-4 text-primary" /> Raise your score</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {plan.current} → about <span className="font-semibold text-foreground">{plan.potential}</span> if you do everything
            {plan.safePotential > plan.current && plan.safePotential < plan.potential ? ` (${plan.safePotential} using only what is already in your resume)` : ''}. Gains are measured by re-scoring.
          </p>
        </div>
      </div>
      <ol className="space-y-2.5">
        {plan.steps.map((s) => (
          <li key={s.id} className="rounded-lg border bg-card p-2.5 text-xs space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <span className="font-medium text-sm leading-snug">{s.title}</span>
              {s.gain > 0 && <span className="shrink-0 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 px-2 py-0.5 font-semibold tabular-nums">+{s.gain}</span>}
            </div>
            <p className="text-muted-foreground leading-relaxed">{s.detail}</p>
            {s.id === 'confirm-gaps' && (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {s.items.map((k) => (
                  <button key={k} type="button" onClick={() => toggle(k)} aria-pressed={picked.includes(k)} className={cn('rounded-full border px-2 py-0.5 transition', picked.includes(k) ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted')}>
                    {picked.includes(k) ? '✓ ' : '+ '}
                    {k}
                  </button>
                ))}
              </div>
            )}
            {onAsk && s.id === 'confirm-gaps' && (
              <Button size="sm" className="w-full" disabled={busy || !picked.length} onClick={() => { onAsk(`Add ${picked.join(', ')} to my skills`); setPicked([]); }}>
                Add selected — I have used {picked.length === 1 ? 'it' : 'these'}
              </Button>
            )}
            {onAsk && s.chat && s.id !== 'confirm-gaps' && (
              <Button size="sm" variant={s.kind === 'auto' ? 'default' : 'secondary'} className="w-full" disabled={busy} onClick={() => onAsk(s.chat!)}>
                <Sparkles className="w-3.5 h-3.5 mr-1" /> {s.kind === 'auto' ? 'Do it for me' : 'Get ideas'}
              </Button>
            )}
            {s.kind === 'manual' && <p className="text-[11px] text-muted-foreground italic">Tell me the details in the chat — I won’t guess them.</p>}
          </li>
        ))}
      </ol>
    </div>
  );
};

export const AtsPanel: React.FC<{
  plan?: ImprovementPlan | null;
  ats: AtsResult | null;
  previousScore: number | null;
  onRecalculate: () => void;
  recalculating: boolean;
  onAsk?: (instruction: string) => void;
  busy?: boolean;
  compact?: boolean;
}> = ({ ats, plan, previousScore, onRecalculate, recalculating, onAsk, busy, compact }) => {
  const [showAll, setShowAll] = useState(false);
  if (!ats) {
    return (
      <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground flex gap-2">
        <Info className="w-4 h-4 mt-0.5 shrink-0" />
        Add a job description to calculate the ATS compatibility score.
      </div>
    );
  }
  const tone = scoreTone(ats.total);
  const groups: Array<[string, KeywordResult[]]> = [
    ['Required skills', ats.keywords.filter((k) => k.importance === 'required')],
    ['Preferred skills', ats.keywords.filter((k) => k.importance === 'preferred')],
    ['Other JD keywords', ats.keywords.filter((k) => k.importance === 'keyword')],
  ];
  const matched = ats.keywords.filter((k) => k.status === 'matched').length;
  const partial = ats.keywords.filter((k) => k.status === 'partial').length;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-4">
        <div className="flex items-center gap-4">
          <ScoreRing score={ats.total} />
          <div className="min-w-0 space-y-1">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">ATS Compatibility</div>
            <div className={cn('font-semibold', tone.text)}>{tone.label}</div>
            <ScoreDelta previous={previousScore} current={ats.total} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-4 text-center">
          <Stat label="Keyword match" value={`${ats.keywordMatchPct}%`} />
          <Stat label="Required" value={`${ats.requiredMatched.length}/${ats.requiredMatched.length + ats.requiredMissing.length}`} />
          <Stat label="Preferred" value={`${ats.preferredMatched.length}/${ats.preferredMatched.length + ats.preferredMissing.length}`} />
        </div>
        <Button size="sm" variant="outline" className="w-full mt-3" onClick={onRecalculate} disabled={recalculating || busy}>
          {recalculating ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
          Recalculate ATS Score
        </Button>
      </div>

      {plan && <PlanCard plan={plan} onAsk={onAsk} busy={busy} />}

      <div className="space-y-2.5">
        <h3 className="text-sm font-semibold">Score breakdown</h3>
        {ats.categories.map((c) => (
          <details key={c.id} className="group rounded-lg border px-3 py-2">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">{c.label}</span>
              <span className="tabular-nums text-xs text-muted-foreground shrink-0">
                {c.points.toFixed(1)} / {c.weight}
              </span>
            </summary>
            <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${Math.round(c.score * 100)}%`, background: scoreTone(c.score * 100).ring }} />
            </div>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {c.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          </details>
        ))}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Keywords</h3>
          <span className="text-xs text-muted-foreground">
            {matched} matched · {partial} partial · {ats.keywords.length - matched - partial} missing
          </span>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-emerald-600" />Matched</span>
          <span className="inline-flex items-center gap-1"><CircleDashed className="w-3 h-3 text-amber-600" />Partial</span>
          <span className="inline-flex items-center gap-1"><XCircle className="w-3 h-3 text-red-600" />Missing</span>
          <span>· click a keyword for details</span>
        </div>
        {groups.map(([label, list]) =>
          list.length ? (
            <div key={label}>
              <div className="text-xs font-medium mb-1">{label}</div>
              <div className="flex flex-wrap gap-1.5">
                {(showAll || compact === false ? list : list.slice(0, 18)).map((k) => (
                  <KeywordChip key={k.keyword} k={k} onAsk={onAsk} disabled={busy} />
                ))}
              </div>
            </div>
          ) : null,
        )}
        {ats.keywords.length > 18 && (
          <button type="button" className="text-xs text-primary underline" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Show fewer' : 'Show all keywords'}
          </button>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Formatting & readability</h3>
        <ul className="space-y-1.5">
          {ats.checks.map((c) => (
            <li key={c.id} className="flex gap-2 text-xs">
              {c.passed ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" /> : <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />}
              <span>
                <span className="font-medium">{c.label}.</span> <span className="text-muted-foreground">{c.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Section completeness</h3>
        <div className="flex flex-wrap gap-1.5">
          {ats.sections.map((s) => (
            <span key={s.id} className={cn('rounded-md border px-2 py-0.5 text-xs', s.present ? statusStyle.matched : 'text-muted-foreground')}>
              {s.present ? '✓' : '○'} {s.label}
            </span>
          ))}
        </div>
      </div>

      {ats.suggestions.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">How to improve (truthfully)</h3>
          <ul className="list-disc pl-4 space-y-1 text-xs text-muted-foreground">
            {ats.suggestions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
          {onAsk && (
            <Button size="sm" variant="secondary" className="w-full" disabled={busy} onClick={() => onAsk('Improve the ATS score without adding fake skills.')}>
              <Sparkles className="w-3.5 h-3.5 mr-1.5" /> Improve score with AI
            </Button>
          )}
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground border-t pt-3">{ats.disclaimer}</p>
    </div>
  );
};

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-lg bg-muted/60 px-2 py-1.5">
    <div className="text-sm font-semibold tabular-nums">{value}</div>
    <div className="text-[10px] text-muted-foreground">{label}</div>
  </div>
);
