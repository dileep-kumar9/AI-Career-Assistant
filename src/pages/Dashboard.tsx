import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Bot, CalendarClock, FileText, Link2, Send } from 'lucide-react';
import { STAGE_LABELS } from '../../shared/careerTypes';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StageBadge, fmtDate } from '@/components/career/bits';
import { useMyResumes } from '@/components/career/ResumeSelect';
import { career } from '@/lib/careerApi';

function Stat({ label, value, to, tone }: { label: string; value: number | string; to?: string; tone?: string }) {
  const body = (
    <div className="rounded-xl border bg-background p-4 h-full">
      <div className={`text-2xl font-bold tabular-nums ${tone || ''}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const [link, setLink] = useState('');
  const { data: overview } = useQuery({ queryKey: ['tracker'], queryFn: career.tracker, refetchInterval: 15_000 });
  const { data: apps = [] } = useQuery({ queryKey: ['applications'], queryFn: career.applications, refetchInterval: 15_000 });
  const { data: status } = useQuery({ queryKey: ['agent-status'], queryFn: career.agentStatus, refetchInterval: 10_000 });
  const { data: resumes = [] } = useMyResumes();
  const { data: profile } = useQuery({ queryKey: ['profile'], queryFn: career.profile });
  const s = overview?.stats;
  const r = overview?.reminders;
  const applied = apps.filter((a) => a.appliedAt);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const steps = [
    { done: resumes.length > 0, label: 'Upload your resume', to: '/builder' },
    { done: !!profile?.autofilledFrom, label: 'Fill your Career Profile from it', to: '/profile' },
    { done: apps.length > 0, label: 'Paste a job link (Single Job Apply)', to: '/apply' },
    { done: !!status?.lastRun, label: 'Set up the Auto Job Agent', to: '/agent' },
  ];

  return (
    <AppShell title="Dashboard" subtitle="Your job search at a glance" wide>
      {steps.some((x) => !x.done) && (
        <div className="mb-5 rounded-xl border bg-background p-4">
          <h2 className="font-semibold mb-2">Get started</h2>
          <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((x, i) => (
              <li key={x.label}>
                <Link to={x.to} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${x.done ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200' : 'hover:bg-muted'}`}>
                  <span className={`w-5 h-5 rounded-full text-[11px] flex items-center justify-center ${x.done ? 'bg-emerald-600 text-white' : 'bg-muted-foreground/20'}`}>{x.done ? '✓' : i + 1}</span>
                  {x.label}
                </Link>
              </li>
            ))}
          </ol>
        </div>
      )}

      <form
        className="mb-5 flex flex-col sm:flex-row gap-2 rounded-xl border bg-background p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (link.trim()) navigate(`/apply?url=${encodeURIComponent(link.trim())}`);
        }}
      >
        <div className="flex items-center gap-2 text-sm font-medium shrink-0">
          <Link2 className="w-4 h-4 text-primary" /> Apply to one job
        </div>
        <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste a job link (Greenhouse, Lever, LinkedIn, Naukri, company careers page…)" />
        <Button type="submit" disabled={!link.trim()}>
          <Send className="w-4 h-4 mr-1.5" /> Start
        </Button>
      </form>

      <div className="grid gap-3 grid-cols-2 md:grid-cols-4 lg:grid-cols-6 mb-5">
        <Stat label="Applied today" value={applied.filter((a) => new Date(a.appliedAt!) >= today).length} />
        <Stat label="Applied in total" value={applied.length} to="/tracker" />
        <Stat label="Ready for review" value={r?.readyForReview ?? 0} to="/tracker?stage=ready" tone="text-sky-600" />
        <Stat label="Need your attention" value={r?.needsAttention ?? 0} to="/tracker?stage=needs_attention" tone="text-amber-600" />
        <Stat label="Response rate" value={`${s?.responseRate ?? 0}%`} to="/tracker" />
        <Stat label="Interview rate" value={`${s?.interviewRate ?? 0}%`} to="/tracker" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-xl border bg-background p-4 lg:col-span-2">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold">Recent applications</h2>
            <Button size="sm" variant="ghost" asChild>
              <Link to="/tracker">Open tracker</Link>
            </Button>
          </div>
          {apps.length ? (
            <ul className="divide-y">
              {apps.slice(0, 8).map((a) => (
                <li key={a.id}>
                  <Link to={`/tracker?id=${a.id}`} className="flex items-center gap-3 py-2 hover:bg-muted/50 rounded px-1">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{a.jobTitle || a.jobUrl}</div>
                      <div className="text-xs text-muted-foreground truncate">{a.company} · {fmtDate(a.updatedAt, true)}</div>
                    </div>
                    {a.atsAfter !== null && <span className="text-xs tabular-nums text-muted-foreground">ATS {a.atsAfter}</span>}
                    <StageBadge stage={a.stage} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No applications yet. Paste a job link above or switch on the job agent.</p>
          )}
        </section>

        <div className="space-y-4">
          <section className="rounded-xl border bg-background p-4">
            <div className="flex items-center gap-2 mb-2">
              <Bot className="w-4 h-4 text-primary" />
              <h2 className="font-semibold flex-1">Job agent</h2>
              <span className={`text-xs font-medium ${status?.enabled ? 'text-emerald-600' : 'text-muted-foreground'}`}>{status?.enabled ? 'ON' : 'OFF'}</span>
            </div>
            <p className="text-sm text-muted-foreground">{status?.phase || '—'}</p>
            {status?.lastRun && (
              <p className="mt-1 text-xs text-muted-foreground">
                Last run {fmtDate(status.lastRun.startedAt, true)}: {status.lastRun.counts.new} new, {status.lastRun.counts.prepared} tailored, {status.lastRun.counts.applied} applied
              </p>
            )}
            {status && (
              <p className="mt-1 text-xs text-muted-foreground">
                Today {status.today.applied}/{status.today.limit} applications
              </p>
            )}
            <Button size="sm" variant="outline" className="mt-3" asChild>
              <Link to="/agent">Open agent</Link>
            </Button>
          </section>

          <section className="rounded-xl border bg-background p-4">
            <div className="flex items-center gap-2 mb-2">
              <CalendarClock className="w-4 h-4 text-primary" />
              <h2 className="font-semibold">Reminders</h2>
            </div>
            {!r || (!r.followUps.length && !r.interviews.length) ? (
              <p className="text-sm text-muted-foreground">Nothing due.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {r.interviews.map((i) => (
                  <li key={i.id}>
                    <Link className="hover:underline" to={`/tracker?id=${i.id}`}>
                      🎤 {STAGE_LABELS.interview}: {i.jobTitle} at {i.company} — {fmtDate(i.interviewAt, true)}
                    </Link>
                  </li>
                ))}
                {r.followUps.map((f) => (
                  <li key={f.id}>
                    <Link className="hover:underline" to={`/tracker?id=${f.id}`}>
                      ✉️ Follow up: {f.jobTitle} at {f.company} (applied {fmtDate(f.appliedAt)})
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {!resumes.length && (
            <section className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-4 text-sm">
              <AlertTriangle className="w-4 h-4 text-amber-600 inline mr-1" /> Add a resume first — everything else is built from it.
              <Button size="sm" className="mt-2 w-full" asChild>
                <Link to="/builder">
                  <FileText className="w-4 h-4 mr-1.5" /> Upload resume
                </Link>
              </Button>
            </section>
          )}
        </div>
      </div>
    </AppShell>
  );
};
