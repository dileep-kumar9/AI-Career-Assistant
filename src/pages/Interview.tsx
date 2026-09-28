import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderOpen, Loader2, MessageSquareText, Mic, Trash2 } from 'lucide-react';
import { TRACKER_STAGES } from '../../shared/careerTypes';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Empty, errMsg, fmtDate } from '@/components/career/bits';
import { InterviewRoom } from '@/components/interview/InterviewRoom';
import { toast } from '@/hooks/use-toast';
import { career } from '@/lib/careerApi';
import { cn } from '@/lib/utils';

export const Interview: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const sessionId = params.get('session');
  const fromApp = params.get('applicationId');
  const { data } = useQuery({ queryKey: ['interview-sessions'], queryFn: career.interviewSessions });
  const { data: apps = [] } = useQuery({ queryKey: ['applications'], queryFn: career.applications });
  const { data: open } = useQuery({ queryKey: ['interview-session', sessionId], queryFn: () => career.interviewSession(sessionId!), enabled: !!sessionId, staleTime: Infinity });
  const [form, setForm] = useState({ mode: 'live' as 'live' | 'coach', applicationId: fromApp || '', role: '', company: '', jobDescription: '', count: 8 });
  useEffect(() => {
    if (fromApp) setForm((f) => ({ ...f, applicationId: fromApp }));
  }, [fromApp]);
  const candidates = apps.filter((a) => a.description && ((TRACKER_STAGES as string[]).includes(a.stage) || a.stage === 'ready'));
  const start = useMutation({
    mutationFn: () =>
      career.startInterview(
        form.applicationId
          ? { mode: form.mode, applicationId: form.applicationId, count: form.count }
          : { mode: form.mode, role: form.role, company: form.company || undefined, jobDescription: form.jobDescription || undefined, count: form.count },
      ),
    onSuccess: (s) => {
      qc.setQueryData(['interview-session', s.id], s);
      qc.invalidateQueries({ queryKey: ['interview-sessions'] });
      setParams({ session: s.id });
    },
    onError: (e) => toast({ title: 'Could not start the interview', description: errMsg(e), variant: 'destructive' }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => career.removeInterviewSession(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['interview-sessions'] }),
  });
  const sessions = data?.sessions || [];

  if (sessionId && open) {
    return (
      <AppShell
        title="Interview Prep"
        subtitle={open.mode === 'live' ? 'Live AI interview — the interviewer speaks, listens and follows up' : 'Coach mode — answer at your own pace and get suggestions'}
        wide
        actions={
          <Button size="sm" variant="outline" onClick={() => setParams({})}>
            ← All interviews
          </Button>
        }
      >
        <InterviewRoom key={open.id} initial={open} folderRoot={data?.folderRoot || ''} />
      </AppShell>
    );
  }

  return (
    <AppShell title="Interview Prep" subtitle="Practise like a real interview: questions from the job and your resume, follow-ups, hints and feedback" wide>
      <div className="grid gap-5 lg:grid-cols-[1fr_24rem]">
        <section className="rounded-xl border bg-background p-4 space-y-4">
          <h2 className="font-semibold">Start an interview</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {([
              ['live', Mic, 'Live AI interview', 'The interviewer speaks each question, listens to you, detects when you are silent or unsure, asks connecting follow-ups and moves on when you are right.'],
              ['coach', MessageSquareText, 'Coach mode', 'Answer by typing (or dictation) at your own pace. After every answer you get the analysis, suggestions and a stronger answer.'],
            ] as const).map(([mode, Icon, title, text]) => (
              <button key={mode} type="button" onClick={() => setForm({ ...form, mode })} className={cn('text-left rounded-lg border p-3 hover:border-primary/60', form.mode === mode && 'border-primary ring-1 ring-primary')}>
                <div className="flex items-center gap-2 font-medium">
                  <Icon className="w-4 h-4 text-primary" /> {title}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{text}</p>
              </button>
            ))}
          </div>
          <div>
            <Label>For one of your applications</Label>
            <Select value={form.applicationId || 'none'} onValueChange={(v) => setForm({ ...form, applicationId: v === 'none' ? '' : v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Enter a role instead —</SelectItem>
                {candidates.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.jobTitle} · {a.company}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {!form.applicationId && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Role *</Label>
                  <Input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="SOC Analyst" />
                </div>
                <div>
                  <Label>Company (optional)</Label>
                  <Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
                </div>
              </div>
              <div>
                <Label>Job description (optional — makes questions specific)</Label>
                <Textarea rows={5} value={form.jobDescription} onChange={(e) => setForm({ ...form, jobDescription: e.target.value })} />
              </div>
            </>
          )}
          <div className="flex items-end gap-3">
            <div>
              <Label>Questions</Label>
              <Input type="number" min={3} max={20} className="w-24" value={form.count} onChange={(e) => setForm({ ...form, count: Math.max(3, Math.min(20, Number(e.target.value) || 8)) })} />
            </div>
            <Button className="flex-1" disabled={start.isPending || (!form.applicationId && !form.role.trim())} onClick={() => start.mutate()}>
              {start.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Mic className="w-4 h-4 mr-1.5" />} Start {form.mode === 'live' ? 'live interview' : 'coached practice'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Questions are based on the job and your resume. Every interview is saved in its own folder named with the role, company, date and time — transcript, all questions and answers with feedback, and the job description.</p>
        </section>

        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-primary" />
            <h2 className="font-semibold flex-1">Your interview folders</h2>
          </div>
          {data?.folderRoot && <p className="text-[11px] text-muted-foreground break-all">{data.folderRoot}</p>}
          {sessions.length ? (
            sessions.map((s) => (
              <div key={s.id} className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2">
                <button type="button" className="flex-1 text-left min-w-0" onClick={() => setParams({ session: s.id })}>
                  <div className="text-sm font-medium truncate">📁 {s.folder}</div>
                  <div className="text-xs text-muted-foreground">
                    {s.mode === 'live' ? 'Live' : 'Coach'} · {s.status === 'finished' ? `score ${s.summary?.overallScore ?? '—'}/10` : `question ${Math.min(s.current + 1, s.questions.length)}/${s.questions.length}`} · {fmtDate(s.updatedAt, true)}
                  </div>
                </button>
                <Button size="icon" variant="ghost" aria-label="Remove from list" title="Remove from the list (the folder on disk is kept)" onClick={() => remove.mutate(s.id)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))
          ) : (
            <Empty icon={Mic} title="No interviews yet">Start one on the left.</Empty>
          )}
        </section>
      </div>
    </AppShell>
  );
};
