import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bot, ListChecks, Loader2, Play, Save } from 'lucide-react';
import type { AgentSettings, JobType } from '../../shared/careerTypes';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { ChipsInput, StageBadge, errMsg, fmtDate } from '@/components/career/bits';
import { ResumeSelect } from '@/components/career/ResumeSelect';
import { RunnerBanner } from '@/components/career/RunnerBanner';
import { toast } from '@/hooks/use-toast';
import { career } from '@/lib/careerApi';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-sm">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Num({ value, onChange, min, max, className }: { value: number | null; onChange: (v: number | null) => void; min: number; max: number; className?: string }) {
  return <Input type="number" min={min} max={max} className={className || 'w-28'} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Math.max(min, Math.min(max, Number(e.target.value))))} />;
}

const JOB_TYPES: JobType[] = ['full-time', 'part-time', 'contract', 'internship'];

/** Experience presets: a job fits when the years it asks for are at most your max. */
const EXPERIENCE_PRESETS: Array<{ label: string; min: number | null; max: number | null }> = [
  { label: 'From profile', min: null, max: null },
  { label: 'Fresher (0)', min: 0, max: 0 },
  { label: '0–1', min: 0, max: 1 },
  { label: '1–2', min: 1, max: 2 },
  { label: '2', min: null, max: 2 },
  { label: '2–3', min: 2, max: 3 },
  { label: '3–5', min: 3, max: 5 },
  { label: '5–8', min: 5, max: 8 },
];

export const Agent: React.FC = () => {
  const qc = useQueryClient();
  const { data: saved } = useQuery({ queryKey: ['agent-settings'], queryFn: career.agentSettings });
  const { data: status } = useQuery({ queryKey: ['agent-status'], queryFn: career.agentStatus, refetchInterval: (q) => (q.state.data?.running ? 2000 : 10_000) });
  const { data: runs = [] } = useQuery({ queryKey: ['agent-runs'], queryFn: career.agentRuns, refetchInterval: status?.running ? 3000 : 30_000 });
  const { data: apps = [] } = useQuery({ queryKey: ['applications'], queryFn: career.applications, refetchInterval: status?.running ? 4000 : 30_000 });
  const [s, setS] = useState<AgentSettings | null>(null);
  const [confirmAuto, setConfirmAuto] = useState(false);
  const [confirmLinkedIn, setConfirmLinkedIn] = useState(false);
  useEffect(() => {
    if (saved && !s) setS(saved);
  }, [saved, s]);
  const dirty = !!s && !!saved && JSON.stringify({ ...s, enabled: 0, updatedAt: 0 }) !== JSON.stringify({ ...saved, enabled: 0, updatedAt: 0 });
  const refresh = () => ['agent-status', 'agent-runs', 'applications', 'tracker'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const save = useMutation({
    mutationFn: () => {
      const { enabled: _e, updatedAt: _u, ...rest } = s!;
      return career.saveAgentSettings(rest);
    },
    onSuccess: (next) => {
      qc.setQueryData(['agent-settings'], next);
      setS(next);
      toast({ title: 'Agent settings saved' });
    },
    onError: (e) => toast({ title: 'Could not save', description: errMsg(e), variant: 'destructive' }),
  });
  const toggle = useMutation({
    mutationFn: (on: boolean) => (on ? career.agentStart() : career.agentStop()),
    onSuccess: (st) => {
      qc.setQueryData(['agent-status'], st);
      qc.invalidateQueries({ queryKey: ['agent-settings'] });
      toast({ title: st.enabled ? 'Job agent is ON' : 'Job agent is OFF' });
    },
    onError: (e) => toast({ title: 'Could not switch the agent', description: errMsg(e), variant: 'destructive' }),
  });
  const runNow = useMutation({ mutationFn: career.agentRun, onSuccess: refresh, onError: (e) => toast({ title: 'Could not run', description: errMsg(e), variant: 'destructive' }) });

  if (!s) return <AppShell title="Auto Job Agent">Loading…</AppShell>;
  const set = <K extends keyof AgentSettings>(k: K, v: AgentSettings[K]) => setS({ ...s, [k]: v });
  const setMany = (patch: Partial<AgentSettings>) => setS({ ...s, ...patch });
  const src = <K extends keyof AgentSettings['sources']>(k: K, v: Partial<AgentSettings['sources'][K]>) => setS({ ...s, sources: { ...s.sources, [k]: { ...s.sources[k], ...v } } });
  const queue = apps.filter((a) => a.origin === 'agent');

  return (
    <AppShell
      title="Auto Job Agent"
      subtitle="Searches jobs by your resume or skills, tailors and applies while it is ON"
      wide
      actions={
        dirty ? (
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
            <Save className="w-4 h-4 mr-1.5" /> Save settings
          </Button>
        ) : undefined
      }
    >
      <section className="rounded-xl border bg-background p-4 mb-5 flex flex-wrap items-center gap-4">
        <Bot className="w-8 h-8 text-primary" />
        <div className="flex-1 min-w-[12rem]">
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold">{status?.enabled ? 'Agent is ON' : 'Agent is OFF'}</span>
            {status?.running && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
          </div>
          <p className="text-sm text-muted-foreground">{status?.phase}</p>
          {status && (
            <p className="text-xs text-muted-foreground">
              Today: {status.today.applied}/{status.today.limit} applied{status.today.linkedinLimit ? ` · LinkedIn ${status.today.linkedin}/${status.today.linkedinLimit}` : ''}
              {status.nextRunAt && ` · next run ${fmtDate(status.nextRunAt, true)}`} · mode: {s.mode === 'auto' ? 'auto-submit' : s.autoApprove ? `review (auto-approve ≥ ${s.autoSubmitMin})` : 'review first'}
              {s.dryRun && ' · DRY RUN'}
            </p>
          )}
        </div>
        <Button variant="outline" disabled={!!status?.running || runNow.isPending || dirty} onClick={() => runNow.mutate()} title={dirty ? 'Save settings first' : undefined}>
          <Play className="w-4 h-4 mr-1.5" /> Run once now
        </Button>
        <Button variant="outline" asChild>
          <Link to="/tracker?review=1">
            <ListChecks className="w-4 h-4 mr-1.5" /> Review queue
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <Switch checked={!!status?.enabled} disabled={toggle.isPending || dirty} onCheckedChange={(on) => toggle.mutate(on)} aria-label="Agent on/off" />
          <span className="text-sm font-medium">{status?.enabled ? 'ON' : 'OFF'}</span>
        </div>
      </section>
      <RunnerBanner info={status?.execution} className="mb-5" />
      {dirty && <p className="mb-4 text-sm text-amber-700 dark:text-amber-400">You have unsaved changes — save them before switching the agent on or running it.</p>}
      {status?.browser.error && (
        <p className="mb-4 flex gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm">
          <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5" /> {status.browser.error}
        </p>
      )}

      <div className="grid gap-5 xl:grid-cols-[1fr_24rem]">
        <div className="space-y-5">
          <section className="rounded-xl border bg-background p-4 space-y-4">
            <h2 className="font-semibold">What to search for</h2>
            <Field label="Search by">
              <RadioGroup value={s.searchBy} onValueChange={(v) => set('searchBy', v as AgentSettings['searchBy'])} className="flex flex-wrap gap-4">
                {(['resume', 'skills', 'both'] as const).map((v) => (
                  <div key={v} className="flex items-center gap-1.5">
                    <RadioGroupItem id={`sb-${v}`} value={v} />
                    <Label htmlFor={`sb-${v}`} className="font-normal">
                      {v === 'resume' ? 'My resume' : v === 'skills' ? 'My skills' : 'Both'}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </Field>
            <Field label="Resume to tailor and apply with" hint="Applying always uses a resume; with “My skills” the skills only decide which jobs are found.">
              <ResumeSelect value={s.resumeId} onChange={(v) => set('resumeId', v)} />
            </Field>
            {s.searchBy !== 'resume' && (
              <Field label="Skills" hint="Used for searching and matching. Skills not in your resume are never added to it.">
                <ChipsInput value={s.skills} onChange={(v) => set('skills', v)} placeholder="SIEM, Splunk, Python…" />
              </Field>
            )}
            <Field label="Target roles" hint="Leave empty to use the roles in your Career Profile.">
              <ChipsInput value={s.targetRoles} onChange={(v) => set('targetRoles', v)} placeholder="SOC Analyst, Security Analyst…" max={10} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Locations" hint="Empty = your Career Profile locations.">
                <ChipsInput value={s.locations} onChange={(v) => set('locations', v)} placeholder="Hyderabad, Bangalore…" max={15} />
              </Field>
              <div className="space-y-3 pt-6">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={s.remoteOk} onCheckedChange={(v) => set('remoteOk', !!v)} /> Remote jobs are OK
                </label>
              </div>
              <div className="sm:col-span-2">
              <Field label="Your experience (years)" hint="Only jobs asking for at most your maximum are kept. Fresher = jobs for 0 years / freshers. Empty = from your Career Profile.">
                <div className="flex flex-wrap gap-1.5">
                  {EXPERIENCE_PRESETS.map((p) => {
                    const on = s.experienceMin === p.min && s.experienceMax === p.max;
                    return (
                      <Button key={p.label} type="button" size="sm" variant={on ? 'default' : 'outline'} className="h-7 px-2.5" onClick={() => setMany({ experienceMin: p.min, experienceMax: p.max })}>
                        {p.label}
                      </Button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2 text-sm mt-2">
                  From <Num value={s.experienceMin} onChange={(v) => set('experienceMin', v)} min={0} max={40} className="w-20" /> to
                  <Num value={s.experienceMax} onChange={(v) => set('experienceMax', v)} min={0} max={40} className="w-20" /> years
                </div>
              </Field>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Job types">
                <div className="flex flex-wrap gap-3">
                  {JOB_TYPES.map((t) => (
                    <label key={t} className="flex items-center gap-1.5 text-sm capitalize">
                      <Checkbox checked={s.jobTypes.includes(t)} onCheckedChange={(v) => set('jobTypes', v ? [...s.jobTypes, t] : s.jobTypes.filter((x) => x !== t))} /> {t}
                    </label>
                  ))}
                </div>
              </Field>
              <Field label="Posted within (days)">
                <Num value={s.postedWithinDays} onChange={(v) => set('postedWithinDays', v ?? 0)} min={0} max={60} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Exclude companies">
                <ChipsInput value={s.excludeCompanies} onChange={(v) => set('excludeCompanies', v)} placeholder="Current employer…" max={100} />
              </Field>
              <Field label="Exclude title words">
                <ChipsInput value={s.excludeTitleWords} onChange={(v) => set('excludeTitleWords', v)} placeholder="Senior, Lead…" max={50} />
              </Field>
            </div>
          </section>

          <section className="rounded-xl border bg-background p-4 space-y-4">
            <h2 className="font-semibold">Job sources</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Greenhouse company boards" hint="Board names, e.g. stripe (from job-boards.greenhouse.io/stripe).">
                <div className="flex items-start gap-2">
                  <Switch checked={s.sources.greenhouse.enabled} onCheckedChange={(v) => src('greenhouse', { enabled: v })} />
                  <ChipsInput value={s.sources.greenhouse.boards} onChange={(v) => src('greenhouse', { boards: v })} placeholder="stripe, airbnb…" max={40} />
                </div>
              </Field>
              <Field label="Lever companies" hint="From jobs.lever.co/<company>.">
                <div className="flex items-start gap-2">
                  <Switch checked={s.sources.lever.enabled} onCheckedChange={(v) => src('lever', { enabled: v })} />
                  <ChipsInput value={s.sources.lever.companies} onChange={(v) => src('lever', { companies: v })} placeholder="palantir…" max={40} />
                </div>
              </Field>
              <Field label="Ashby organisations" hint="From jobs.ashbyhq.com/<org>.">
                <div className="flex items-start gap-2">
                  <Switch checked={s.sources.ashby.enabled} onCheckedChange={(v) => src('ashby', { enabled: v })} />
                  <ChipsInput value={s.sources.ashby.orgs} onChange={(v) => src('ashby', { orgs: v })} placeholder="ramp…" max={40} />
                </div>
              </Field>
              <Field label="Workday career sites (assisted apply)" hint="Full URL, e.g. https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite">
                <div className="flex items-start gap-2">
                  <Switch checked={s.sources.workday.enabled} onCheckedChange={(v) => src('workday', { enabled: v })} />
                  <ChipsInput value={s.sources.workday.sites} onChange={(v) => src('workday', { sites: v })} placeholder="https://…myworkdayjobs.com/…" max={15} />
                </div>
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
              <label className="flex items-center gap-2">
                <Switch checked={s.sources.arbeitnow.enabled} onCheckedChange={(v) => src('arbeitnow', { enabled: v })} /> Arbeitnow (public API)
              </label>
              <label className="flex items-center gap-2">
                <Switch checked={s.sources.remoteok.enabled} onCheckedChange={(v) => src('remoteok', { enabled: v })} /> Remote OK (public API)
              </label>
              <label className="flex items-center gap-2">
                <Switch checked={s.sources.naukri.enabled} onCheckedChange={(v) => src('naukri', { enabled: v })} /> Naukri (your logged-in browser)
              </label>
              <div className="flex items-center gap-2">
                <Switch checked={s.sources.indeed.enabled} onCheckedChange={(v) => src('indeed', { enabled: v })} /> Indeed
                <Input className="h-8 w-36" value={s.sources.indeed.domain} onChange={(e) => src('indeed', { domain: e.target.value })} aria-label="Indeed domain" />
              </div>
              <label className="flex items-center gap-2">
                <Switch checked={s.sources.linkedin.enabled} onCheckedChange={(v) => (v ? setConfirmLinkedIn(true) : src('linkedin', { enabled: false }))} /> LinkedIn (Easy Apply)
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              Naukri, Indeed and LinkedIn Easy Apply use the automation browser: log in once in <Link to="/settings" className="underline">Settings → Automation browser</Link>. Naukri sends your Naukri profile resume, not the tailored PDF.
            </p>
          </section>

          <section className="rounded-xl border bg-background p-4 space-y-4">
            <h2 className="font-semibold">How it applies</h2>
            <Field label="Mode">
              <RadioGroup value={s.mode} onValueChange={(v) => (v === 'auto' ? setConfirmAuto(true) : set('mode', 'review'))} className="flex flex-wrap gap-4">
                <div className="flex items-center gap-1.5">
                  <RadioGroupItem id="mode-review" value="review" />
                  <Label htmlFor="mode-review" className="font-normal">Review — I approve jobs below the auto-approve score</Label>
                </div>
                <div className="flex items-center gap-1.5">
                  <RadioGroupItem id="mode-auto" value="auto" />
                  <Label htmlFor="mode-auto" className="font-normal">Auto — apply to every job that is not skipped</Label>
                </div>
              </RadioGroup>
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Skip jobs below (match / tailored ATS)" hint="Jobs scoring under this are left automatically.">
                <Num value={s.minMatch} onChange={(v) => set('minMatch', v ?? 0)} min={0} max={100} />
              </Field>
              <Field label="Auto-approve when match and ATS are both ≥" hint="These are applied without asking you.">
                <Num value={s.autoSubmitMin} onChange={(v) => set('autoSubmitMin', v ?? 0)} min={0} max={100} />
              </Field>
              <Field label="Run every (minutes)">
                <Num value={s.runEveryMinutes} onChange={(v) => set('runEveryMinutes', v ?? 60)} min={15} max={1440} />
              </Field>
              <Field label="Daily limit (all sources)">
                <Num value={s.dailyLimit} onChange={(v) => set('dailyLimit', v ?? 1)} min={1} max={100} />
              </Field>
              <Field label="LinkedIn daily limit">
                <Num value={s.linkedinDailyLimit} onChange={(v) => set('linkedinDailyLimit', v ?? 0)} min={0} max={25} />
              </Field>
            </div>
            <div className="flex flex-wrap gap-6 text-sm">
              <label className="flex items-center gap-2">
                <Switch checked={s.autoApprove} onCheckedChange={(v) => set('autoApprove', v)} /> Auto-approve &amp; apply high-scoring jobs (≥ {s.autoSubmitMin})
              </label>
              <label className="flex items-center gap-2">
                <Switch checked={s.reviewAnswers} onCheckedChange={(v) => set('reviewAnswers', v)} /> Let me review remembered answers before submitting
              </label>
              <label className="flex items-center gap-2">
                <Switch checked={s.dryRun} onCheckedChange={(v) => set('dryRun', v)} /> Dry run (fill forms, never submit)
              </label>
              <label className="flex items-center gap-2">
                <Switch checked={s.coverLetters} onCheckedChange={(v) => set('coverLetters', v)} /> Write a cover letter when a form asks for one
              </label>
            </div>
          </section>
          {dirty && (
            <div className="sticky bottom-3 flex justify-end">
              <Button onClick={() => save.mutate()} disabled={save.isPending} className="shadow-lg">
                <Save className="w-4 h-4 mr-1.5" /> Save settings
              </Button>
            </div>
          )}
        </div>

        <div className="space-y-5">
          <section className="rounded-xl border bg-background p-4">
            <h2 className="font-semibold mb-2">Agent queue</h2>
            {queue.length ? (
              <ul className="space-y-1 max-h-80 overflow-auto">
                {queue.slice(0, 50).map((a) => (
                  <li key={a.id}>
                    <Link to={`/tracker?id=${a.id}`} className="flex items-center gap-2 rounded px-1 py-1 hover:bg-muted text-sm">
                      <span className="flex-1 truncate">
                        {a.jobTitle} <span className="text-muted-foreground">· {a.company}</span>
                      </span>
                      <span className="text-xs tabular-nums text-muted-foreground">{a.atsAfter ?? a.matchScore ?? ''}</span>
                      <StageBadge stage={a.stage} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Jobs the agent tailors appear here.</p>
            )}
          </section>
          <section className="rounded-xl border bg-background p-4">
            <h2 className="font-semibold mb-2">Recent runs</h2>
            {runs.length ? (
              <div className="space-y-3 max-h-[32rem] overflow-auto">
                {runs.map((r) => (
                  <details key={r.id} open={r.id === runs[0].id} className="rounded-lg border p-2">
                    <summary className="cursor-pointer text-sm">
                      {fmtDate(r.startedAt, true)} · {r.status} · {r.counts.new} new · {r.counts.prepared} tailored · {r.counts.applied} applied
                    </summary>
                    <ol className="mt-2 space-y-1 text-xs">
                      {r.log.map((l, i) => (
                        <li key={i} className={l.level === 'error' ? 'text-destructive' : l.level === 'warn' ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}>
                          {new Date(l.at).toLocaleTimeString()} — {l.message}
                        </li>
                      ))}
                    </ol>
                  </details>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No runs yet.</p>
            )}
          </section>
        </div>
      </div>

      <AlertDialog open={confirmAuto} onOpenChange={setConfirmAuto}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Let the agent submit applications by itself?</AlertDialogTitle>
            <AlertDialogDescription>
              In auto mode the agent submits every application that is not skipped (match and tailored ATS at least {s.minMatch}, experience fits), up to {s.dailyLimit} per day, without asking you first. It still stops at CAPTCHAs, logins and questions it cannot answer truthfully. You can switch back to review mode or turn the agent off at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep review mode</AlertDialogCancel>
            <AlertDialogAction onClick={() => set('mode', 'auto')}>Use auto mode</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={confirmLinkedIn} onOpenChange={setConfirmLinkedIn}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn on LinkedIn?</AlertDialogTitle>
            <AlertDialogDescription>
              LinkedIn’s User Agreement prohibits automated use, and accounts that use automation can be restricted. Searching uses LinkedIn’s public job pages (not your account); Easy Apply uses your logged-in browser, limited to {s.linkedinDailyLimit} per day. Continue only if you accept that risk.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it off</AlertDialogCancel>
            <AlertDialogAction onClick={() => src('linkedin', { enabled: true })}>I accept the risk</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
};
