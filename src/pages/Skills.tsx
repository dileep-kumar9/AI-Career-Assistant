import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, CheckCircle2, ExternalLink, GraduationCap, Loader2, Plus, Trash2 } from 'lucide-react';
import type { LearningPlan } from '../../shared/careerTypes';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Empty, errMsg, fmtDate } from '@/components/career/bits';
import { toast } from '@/hooks/use-toast';
import { career } from '@/lib/careerApi';
import { cn } from '@/lib/utils';

const searchUrl = (type: string, q: string) => (type === 'video' ? `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}` : `https://www.google.com/search?q=${encodeURIComponent(q)}`);

function PlanView({ plan, onDeleted }: { plan: LearningPlan; onDeleted: () => void }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [statement, setStatement] = useState(`I learned ${plan.skill} and built ${plan.proofProject.title}.`);
  const [projectUrl, setProjectUrl] = useState('');
  const save = (next: LearningPlan) => {
    qc.setQueryData(['plans'], (old: LearningPlan[] | undefined) => (old || []).map((p) => (p.id === next.id ? next : p)));
    qc.invalidateQueries({ queryKey: ['profile'] });
  };
  const update = useMutation({ mutationFn: (stepsDone: boolean[]) => career.updatePlan(plan.id, { stepsDone }), onSuccess: save, onError: (e) => toast({ title: errMsg(e), variant: 'destructive' }) });
  const done = useMutation({
    mutationFn: () => career.confirmPlan(plan.id, statement, projectUrl),
    onSuccess: (p) => {
      save(p);
      setConfirm(false);
      toast({ title: `${plan.skill} saved as a confirmed fact`, description: 'New tailored resumes may now mention it, because you confirmed it.' });
    },
    onError: (e) => toast({ title: 'Could not confirm', description: errMsg(e), variant: 'destructive' }),
  });
  const remove = useMutation({ mutationFn: () => career.removePlan(plan.id), onSuccess: onDeleted });
  const doneCount = plan.steps.filter((s) => s.done).length;
  const hours = plan.steps.reduce((n, s) => n + s.hours, 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold">{plan.skill}</h2>
          <p className="text-sm text-muted-foreground">{plan.overview}</p>
          <p className="text-xs text-muted-foreground mt-1">~{hours} hours · {plan.method === 'ai' ? 'AI plan' : 'rule-based plan'} · created {fmtDate(plan.createdAt)}</p>
        </div>
        <Button size="icon" variant="ghost" aria-label="Delete plan" onClick={() => remove.mutate()}>
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
      <div>
        <Progress value={(doneCount / Math.max(plan.steps.length, 1)) * 100} />
        <p className="text-xs text-muted-foreground mt-1">
          {doneCount}/{plan.steps.length} steps done
        </p>
      </div>
      <ol className="space-y-2">
        {plan.steps.map((s, i) => (
          <li key={i} className="flex gap-3 rounded-lg border bg-background p-3">
            <Checkbox checked={s.done} onCheckedChange={(v) => update.mutate(plan.steps.map((x, j) => (j === i ? !!v : x.done)))} className="mt-0.5" />
            <div className="flex-1">
              <div className={cn('text-sm font-medium', s.done && 'line-through text-muted-foreground')}>
                {i + 1}. {s.title} <span className="text-xs text-muted-foreground font-normal">· {s.hours}h</span>
              </div>
              <p className="text-sm text-muted-foreground">{s.detail}</p>
            </div>
          </li>
        ))}
      </ol>
      <div>
        <h3 className="text-sm font-semibold mb-1">Resources (searches, so links are never made up)</h3>
        <ul className="grid gap-1 sm:grid-cols-2">
          {plan.resources.map((r) => (
            <li key={r.title}>
              <a href={searchUrl(r.type, r.searchQuery)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm hover:border-primary/60">
                <BookOpen className="w-4 h-4 text-primary shrink-0" />
                <span className="flex-1">
                  {r.title} <span className="text-xs text-muted-foreground capitalize">· {r.type}</span>
                </span>
                <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
              </a>
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-lg border bg-background p-3">
        <h3 className="text-sm font-semibold">Proof project: {plan.proofProject.title}</h3>
        <p className="text-sm text-muted-foreground">{plan.proofProject.description}</p>
        <ul className="list-disc pl-5 text-sm mt-1">{plan.proofProject.deliverables.map((d) => <li key={d}>{d}</li>)}</ul>
      </div>
      {plan.confirmation ? (
        <p className="flex gap-2 rounded-lg border bg-emerald-50 dark:bg-emerald-950/40 px-3 py-2 text-sm">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5" /> Confirmed {fmtDate(plan.confirmation.at)}: “{plan.confirmation.statement}” {plan.confirmation.projectUrl && `(${plan.confirmation.projectUrl})`}
        </p>
      ) : (
        <Button onClick={() => setConfirm(true)}>
          <CheckCircle2 className="w-4 h-4 mr-1.5" /> I finished — add it to my facts
        </Button>
      )}
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm what you learned</DialogTitle>
            <DialogDescription>This statement becomes a fact in your Career Profile. Tailored resumes may use it as evidence, so only confirm what is true.</DialogDescription>
          </DialogHeader>
          <Textarea rows={3} value={statement} onChange={(e) => setStatement(e.target.value)} />
          <Input placeholder="Project link (GitHub, portfolio) — optional" value={projectUrl} onChange={(e) => setProjectUrl(e.target.value)} />
          <Button disabled={statement.trim().length < 10 || done.isPending} onClick={() => done.mutate()}>
            Confirm
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export const Skills: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const [role, setRole] = useState('');
  const [days, setDays] = useState(30);
  const [newSkill, setNewSkill] = useState(params.get('skill') || '');
  const { data: report, isFetching, error } = useQuery({ queryKey: ['gaps', role, days], queryFn: () => career.gaps(role, days), retry: false });
  const { data: plans = [] } = useQuery({ queryKey: ['plans'], queryFn: career.plans });
  const planId = params.get('plan');
  const plan = plans.find((p) => p.id === planId);
  useEffect(() => {
    if (params.get('skill')) setNewSkill(params.get('skill')!);
  }, [params]);
  const create = useMutation({
    mutationFn: (skill: string) => career.createPlan(skill, role || undefined),
    onSuccess: (p) => {
      qc.setQueryData(['plans'], (old: LearningPlan[] | undefined) => [p, ...(old || [])]);
      setParams({ plan: p.id });
      setNewSkill('');
    },
    onError: (e) => toast({ title: 'Could not create a plan', description: errMsg(e), variant: 'destructive' }),
  });

  return (
    <AppShell title="Skills & Learning" subtitle="What the jobs you target ask for, what that is worth, and how to close the gap honestly" wide>
      <div className="grid gap-5 xl:grid-cols-[1fr_28rem]">
        <section className="rounded-xl border bg-background p-4">
          <div className="flex flex-wrap items-end gap-2 mb-3">
            <h2 className="font-semibold flex-1">Skill gaps from real job descriptions</h2>
            <Input className="w-48 h-9" placeholder="Filter by role" value={role} onChange={(e) => setRole(e.target.value)} />
            <select className="h-9 rounded-md border bg-background px-2 text-sm" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Window">
              {[7, 30, 60, 90].map((d) => (
                <option key={d} value={d}>
                  Last {d} days
                </option>
              ))}
            </select>
          </div>
          {error ? (
            <p className="text-sm text-muted-foreground">{errMsg(error)}</p>
          ) : !report ? (
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          ) : report.jobsAnalysed === 0 ? (
            <Empty icon={GraduationCap} title="No job descriptions analysed yet">Apply to a job or let the agent run; every JD it reads is counted here.</Empty>
          ) : (
            <>
              <p className="text-xs text-muted-foreground mb-2">
                {report.jobsAnalysed} job description{report.jobsAnalysed === 1 ? '' : 's'} analysed. “Unlocks” = jobs that would reach your auto-apply score if your resume showed the skill — measured by re-scoring them.{isFetching ? ' Updating…' : ''}
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Skill</TableHead>
                    <TableHead className="text-right">In % of jobs</TableHead>
                    <TableHead>Your resume</TableHead>
                    <TableHead className="text-right">Unlocks</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.rows.map((r) => (
                    <TableRow key={r.skill}>
                      <TableCell className="font-medium">
                        {r.skill}
                        <span className="ml-1 text-[11px] text-muted-foreground">{r.importance}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.demandPct}% <span className="text-xs text-muted-foreground">({r.jobs})</span>
                      </TableCell>
                      <TableCell>{r.inResume ? <span className="text-emerald-600 text-sm">✓ shows it</span> : <span className="text-rose-600 text-sm">missing</span>}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.inResume ? '—' : r.unlocks ? `+${r.unlocks}` : '0'}</TableCell>
                      <TableCell className="text-right">
                        {!r.inResume && (
                          <Button size="sm" variant="ghost" disabled={create.isPending} onClick={() => create.mutate(r.skill)}>
                            Plan
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </section>

        <section className="space-y-3">
          <div className="rounded-xl border bg-background p-4">
            <h2 className="font-semibold mb-2">Learning plans</h2>
            <form
              className="flex gap-2 mb-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (newSkill.trim()) create.mutate(newSkill.trim());
              }}
            >
              <Input placeholder="Skill to learn, e.g. Splunk" value={newSkill} onChange={(e) => setNewSkill(e.target.value)} />
              <Button type="submit" disabled={!newSkill.trim() || create.isPending}>
                {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              </Button>
            </form>
            {plans.length ? (
              <ul className="space-y-1">
                {plans.map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => setParams({ plan: p.id })} className={cn('w-full flex items-center gap-2 rounded-lg border px-3 py-2 text-sm text-left hover:border-primary/60', p.id === planId && 'border-primary ring-1 ring-primary')}>
                      <span className="flex-1 font-medium">{p.skill}</span>
                      <span className="text-xs text-muted-foreground">
                        {p.steps.filter((s) => s.done).length}/{p.steps.length}
                      </span>
                      <span className={cn('text-[11px] rounded-full px-2 py-0.5', p.status === 'done' ? 'bg-emerald-100 text-emerald-800' : p.status === 'learning' ? 'bg-sky-100 text-sky-800' : 'bg-muted')}>{p.status}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Create a plan from a missing skill.</p>
            )}
          </div>
          {plan && (
            <div className="rounded-xl border bg-background p-4">
              <PlanView plan={plan} onDeleted={() => {
                qc.invalidateQueries({ queryKey: ['plans'] });
                setParams({});
              }} />
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
};
