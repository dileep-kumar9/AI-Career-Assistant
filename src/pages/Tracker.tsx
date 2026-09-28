import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download, KanbanSquare, Plus } from 'lucide-react';
import type { ApplicationStage, JobApplication, TrackerStage } from '../../shared/careerTypes';
import { PIPELINE_STAGES, STAGE_LABELS, TRACKER_STAGES } from '../../shared/careerTypes';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ApplicationDetail } from '@/components/career/ApplicationDetail';
import { ACTIVE, Empty, StageBadge, errMsg, fmtDate } from '@/components/career/bits';
import { toast } from '@/hooks/use-toast';
import { career, download } from '@/lib/careerApi';

const BOARD: Array<{ title: string; stages: ApplicationStage[] }> = [
  { title: 'In progress', stages: ['found', 'matched', 'tailoring', 'applying'] },
  { title: 'Ready for review', stages: ['ready'] },
  { title: 'Needs attention', stages: ['needs_attention', 'failed'] },
  { title: 'Applied', stages: ['applied'] },
  { title: 'Interview', stages: ['interview'] },
  { title: 'Offer', stages: ['offer'] },
  { title: 'Closed', stages: ['rejected', 'no_response', 'withdrawn', 'skipped'] },
];

function Card({ a, onOpen }: { a: JobApplication; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="w-full text-left rounded-lg border bg-background p-2.5 hover:border-primary/60 shadow-sm">
      <div className="text-sm font-medium leading-snug line-clamp-2">{a.jobTitle || a.jobUrl}</div>
      <div className="text-xs text-muted-foreground truncate">{a.company || '—'}</div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <StageBadge stage={a.stage} />
        {(a.atsAfter ?? a.matchScore) !== null && <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">ATS {a.atsAfter ?? a.matchScore}</span>}
      </div>
    </button>
  );
}

function ManualDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ jobTitle: '', company: '', jobUrl: '', location: '', stage: 'applied' as TrackerStage, appliedAt: new Date().toISOString().slice(0, 10), notes: '' });
  const add = useMutation({
    mutationFn: () => career.addManual({ ...f, appliedAt: f.appliedAt ? new Date(f.appliedAt).toISOString() : null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['applications'] });
      qc.invalidateQueries({ queryKey: ['tracker'] });
      onOpenChange(false);
      toast({ title: 'Added to the tracker' });
    },
    onError: (e) => toast({ title: 'Could not add', description: errMsg(e), variant: 'destructive' }),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a job you applied to elsewhere</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Job title *</Label>
              <Input value={f.jobTitle} onChange={(e) => setF({ ...f, jobTitle: e.target.value })} />
            </div>
            <div>
              <Label>Company *</Label>
              <Input value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} />
            </div>
          </div>
          <div>
            <Label>Job link</Label>
            <Input value={f.jobUrl} onChange={(e) => setF({ ...f, jobUrl: e.target.value })} placeholder="https://…" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Location</Label>
              <Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />
            </div>
            <div>
              <Label>Stage</Label>
              <Select value={f.stage} onValueChange={(v) => setF({ ...f, stage: v as TrackerStage })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRACKER_STAGES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STAGE_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Applied on</Label>
              <Input type="date" value={f.appliedAt} onChange={(e) => setF({ ...f, appliedAt: e.target.value })} />
            </div>
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </div>
          <Button disabled={!f.jobTitle.trim() || !f.company.trim() || add.isPending} onClick={() => add.mutate()}>
            Add
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export const Tracker: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [manual, setManual] = useState(false);
  const stageFilter = params.get('stage') || 'all';
  const openId = params.get('id');
  const { data: apps = [], isLoading } = useQuery({ queryKey: ['applications'], queryFn: career.applications, refetchInterval: (x) => ((x.state.data || []).some((a) => ACTIVE.includes(a.stage)) ? 3000 : 30_000) });
  const { data: overview } = useQuery({ queryKey: ['tracker'], queryFn: career.tracker, refetchInterval: 30_000 });
  const filtered = useMemo(() => {
    const needle = q.toLowerCase();
    return apps.filter((a) => (stageFilter === 'all' || a.stage === stageFilter) && (!needle || `${a.jobTitle} ${a.company} ${a.location} ${a.source}`.toLowerCase().includes(needle)));
  }, [apps, q, stageFilter]);
  const open = (id: string | null) => setParams((p) => {
    const next = new URLSearchParams(p);
    if (id) next.set('id', id);
    else next.delete('id');
    return next;
  });
  const stats = overview?.stats;
  // Jobs waiting for you: ready for review, or paused with questions.
  const waiting = apps.filter((a) => a.stage === 'ready' || (a.stage === 'needs_attention' && a.waitingFor));
  const openNext = (done?: JobApplication) => {
    const next = waiting.find((a) => a.id !== done?.id);
    if (next) {
      open(next.id);
      toast({ title: 'Next job waiting for you', description: `${next.jobTitle} at ${next.company}` });
    } else {
      open(null);
      toast({ title: 'All caught up', description: 'No more jobs are waiting for your review.' });
    }
  };
  useEffect(() => {
    if (params.get('review') && waiting[0] && !openId) open(waiting[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get('review'), waiting.length]);

  return (
    <AppShell
      title="Application Tracker"
      subtitle="Every job from Single Job Apply, the agent and manual entries — from found to offer"
      wide
      actions={
        <>
          <Button size="sm" variant="outline" onClick={() => download('/tracker/export.csv', 'applications.csv').catch((e) => toast({ title: errMsg(e), variant: 'destructive' }))}>
            <Download className="w-4 h-4 mr-1.5" /> CSV
          </Button>
          <Button size="sm" variant={waiting.length ? 'default' : 'outline'} disabled={!waiting.length} onClick={() => openNext()}>
            Review queue ({waiting.length})
          </Button>
          <Button size="sm" variant="outline" onClick={() => setManual(true)}>
            <Plus className="w-4 h-4 mr-1.5" /> Add job
          </Button>
        </>
      }
    >
      <div className="mb-4 flex flex-wrap gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search role, company, source…" className="max-w-xs" />
        <Select value={stageFilter} onValueChange={(v) => setParams((p) => {
          const next = new URLSearchParams(p);
          if (v === 'all') next.delete('stage');
          else next.set('stage', v);
          return next;
        })}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stages</SelectItem>
            {[...PIPELINE_STAGES, ...TRACKER_STAGES].map((s) => (
              <SelectItem key={s} value={s}>
                {STAGE_LABELS[s]} ({apps.filter((a) => a.stage === s).length})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !apps.length ? (
        <Empty icon={KanbanSquare} title="No applications yet">
          Use Single Job Apply, switch on the job agent or add a job manually.
        </Empty>
      ) : (
        <Tabs defaultValue="board">
          <TabsList>
            <TabsTrigger value="board">Board</TabsTrigger>
            <TabsTrigger value="table">Table</TabsTrigger>
            <TabsTrigger value="stats">Stats</TabsTrigger>
          </TabsList>
          <TabsContent value="board">
            <div className="flex gap-3 overflow-x-auto pb-3">
              {BOARD.map((col) => {
                const items = filtered.filter((a) => col.stages.includes(a.stage));
                return (
                  <div key={col.title} className="w-64 shrink-0 rounded-xl bg-muted/60 p-2">
                    <div className="px-1 pb-2 text-xs font-semibold text-muted-foreground">
                      {col.title} · {items.length}
                    </div>
                    <div className="space-y-2 max-h-[65vh] overflow-y-auto">
                      {items.map((a) => (
                        <Card key={a.id} a={a} onOpen={() => open(a.id)} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </TabsContent>
          <TabsContent value="table">
            <div className="rounded-xl border bg-background overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Job title</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>Applied</TableHead>
                    <TableHead className="text-right">ATS</TableHead>
                    <TableHead>Follow up</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((a) => (
                    <TableRow key={a.id} className="cursor-pointer" onClick={() => open(a.id)}>
                      <TableCell className="font-medium max-w-[16rem] truncate">{a.jobTitle || a.jobUrl}</TableCell>
                      <TableCell>{a.company}</TableCell>
                      <TableCell className="capitalize">{a.source}</TableCell>
                      <TableCell>
                        <StageBadge stage={a.stage} />
                      </TableCell>
                      <TableCell>{fmtDate(a.appliedAt)}</TableCell>
                      <TableCell className="text-right tabular-nums">{a.atsAfter ?? a.matchScore ?? '—'}</TableCell>
                      <TableCell>{fmtDate(a.followUpAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
          <TabsContent value="stats" className="space-y-4">
            <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
              {[
                ['Applications', stats?.total ?? 0],
                ['Applied', apps.filter((a) => a.appliedAt).length],
                ['Response rate', `${stats?.responseRate ?? 0}%`],
                ['Interview rate', `${stats?.interviewRate ?? 0}%`],
              ].map(([label, v]) => (
                <div key={label as string} className="rounded-xl border bg-background p-4">
                  <div className="text-2xl font-bold">{v}</div>
                  <div className="text-xs text-muted-foreground">{label}</div>
                </div>
              ))}
            </div>
            <div className="rounded-xl border bg-background p-4">
              <h3 className="font-semibold mb-2 text-sm">Applications per week</h3>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats?.appliedPerWeek || []}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="week" fontSize={11} />
                    <YAxis allowDecimals={false} fontSize={11} />
                    <Tooltip />
                    <Bar dataKey="applied" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {[
                { title: 'By source', rows: (stats?.bySource || []).map((r) => ({ key: r.source, ...r })) },
                { title: 'By ATS score after tailoring', rows: (stats?.byMatch || []).map((r) => ({ key: r.band, ...r })) },
              ].map((t) => (
                <div key={t.title} className="rounded-xl border bg-background p-4">
                  <h3 className="font-semibold mb-2 text-sm">{t.title}</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead />
                        <TableHead className="text-right">Applied</TableHead>
                        <TableHead className="text-right">Responses</TableHead>
                        <TableHead className="text-right">Interviews</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {t.rows.map((r) => (
                        <TableRow key={r.key}>
                          <TableCell className="capitalize">{r.key}</TableCell>
                          <TableCell className="text-right">{r.applied}</TableCell>
                          <TableCell className="text-right">{r.responses}</TableCell>
                          <TableCell className="text-right">{r.interviews}</TableCell>
                          <TableCell className="text-right">{r.responseRate}%</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {!t.rows.length && <p className="text-xs text-muted-foreground">No submitted applications yet.</p>}
                </div>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      )}

      <Sheet open={!!openId} onOpenChange={(o) => !o && open(null)}>
        <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="sr-only">Application</SheetTitle>
          </SheetHeader>
          {openId && <ApplicationDetail id={openId} onDeleted={() => open(null)} onDone={(done) => openNext(done)} />}
        </SheetContent>
      </Sheet>
      <ManualDialog open={manual} onOpenChange={setManual} />
    </AppShell>
  );
};
