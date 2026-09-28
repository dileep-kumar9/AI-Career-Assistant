import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Copy, Download, ExternalLink, FileEdit, Mail, Mic, PenLine, RotateCcw, Send, ShieldAlert, SkipForward, Trash2 } from 'lucide-react';
import type { JobApplication, TrackerStage } from '../../../shared/careerTypes';
import { STAGE_LABELS, TRACKER_STAGES } from '../../../shared/careerTypes';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { career, download } from '@/lib/careerApi';
import { ACTIVE, Chips, PdfPreview, ScorePill, StageBadge, errMsg, fmtDate } from './bits';
import { QuestionsPanel } from './QuestionsPanel';

const SOURCE_LABEL: Record<string, string> = { greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby', workday: 'Workday', arbeitnow: 'Arbeitnow', remoteok: 'Remote OK', naukri: 'Naukri', indeed: 'Indeed', linkedin: 'LinkedIn', link: 'Job link', manual: 'Manual' };

/** Polls while a pipeline step runs. */
export function useApplication(id: string | null) {
  return useQuery({
    queryKey: ['application', id],
    queryFn: () => career.application(id!),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data && ACTIVE.includes(q.state.data.stage) ? 2000 : false),
  });
}

/**
 * One application. `onDone` is called after you approve, skip, mark it applied or answer its questions,
 * so a review queue can open the next job waiting for you.
 */
export const ApplicationDetail: React.FC<{ id: string; onDeleted?: () => void; onDone?: (app: JobApplication) => void }> = ({ id, onDeleted, onDone }) => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: a, isLoading, error } = useApplication(id);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notes, setNotes] = useState('');
  const [interviewAt, setInterviewAt] = useState('');
  const [email, setEmail] = useState<{ subject: string; body: string; method: string } | null>(null);
  useEffect(() => setNotes(a?.notes || ''), [a?.id, a?.notes]);

  const refresh = (next?: JobApplication) => {
    if (next) qc.setQueryData(['application', id], next);
    qc.invalidateQueries({ queryKey: ['applications'] });
    qc.invalidateQueries({ queryKey: ['tracker'] });
  };
  const act = useMutation({
    mutationFn: async (fn: () => Promise<JobApplication | void>) => fn(),
    onSuccess: (next) => refresh(next || undefined),
    onError: (e) => toast({ title: 'Could not do that', description: errMsg(e), variant: 'destructive' }),
  });
  /** Actions that finish your part for this job: afterwards the next job in the queue opens. */
  const decideAct = useMutation({
    mutationFn: async (fn: () => Promise<JobApplication>) => fn(),
    onSuccess: (next) => {
      refresh(next);
      onDone?.(next);
    },
    onError: (e) => toast({ title: 'Could not do that', description: errMsg(e), variant: 'destructive' }),
  });

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (error || !a) return <div className="p-6 text-sm text-destructive">{errMsg(error) || 'Application not found.'}</div>;

  const busy = ACTIVE.includes(a.stage) || act.isPending || decideAct.isPending;
  const tracker = TRACKER_STAGES.includes(a.stage as TrackerStage);
  const canApply = !!a.resumeSessionId && ['ready', 'needs_attention', 'failed'].includes(a.stage);
  const lastLog = [...a.log].reverse().find((l) => l.level === 'info');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold leading-tight">{a.jobTitle || 'Reading the job…'}</h2>
            <StageBadge stage={a.stage} />
          </div>
          <p className="text-sm text-muted-foreground">
            {[a.company, a.location, a.remote ? 'Remote' : ''].filter(Boolean).join(' · ') || '—'} · {SOURCE_LABEL[a.source] || a.source}
            {a.appliedAt && <> · applied {fmtDate(a.appliedAt)}</>}
          </p>
        </div>
        {a.jobUrl && (
          <Button variant="outline" size="sm" asChild>
            <a href={a.jobUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-4 h-4 mr-1.5" /> Job page
            </a>
          </Button>
        )}
      </div>

      {ACTIVE.includes(a.stage) && lastLog && <p className="rounded-lg border bg-violet-50 dark:bg-violet-950/40 px-3 py-2 text-sm">{lastLog.message}</p>}
      {a.reason && !ACTIVE.includes(a.stage) && (
        <div className={`flex gap-2 rounded-lg border px-3 py-2 text-sm ${a.stage === 'ready' ? 'bg-sky-50 dark:bg-sky-950/40' : 'bg-amber-50 dark:bg-amber-950/40'}`}>
          {a.stage === 'ready' ? <CheckCircle2 className="w-4 h-4 mt-0.5 text-sky-600 shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-600 shrink-0" />}
          <span>{a.reason}</span>
        </div>
      )}
      {a.injectionSignals.length > 0 && (
        <div className="flex gap-2 rounded-lg border border-rose-300 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-sm">
          <ShieldAlert className="w-4 h-4 mt-0.5 text-rose-600 shrink-0" />
          <span>This job page contains text aimed at AI tools ({a.injectionSignals.join(', ')}). It was treated as data only — check that the posting is genuine.</span>
        </div>
      )}

      {a.queuedForRunner && (
        <div className="rounded-lg border border-sky-300 bg-sky-50 dark:bg-sky-950/40 px-3 py-2 text-sm">
          Waiting for the runner on your computer ({a.queuedForRunner === 'apply' ? 'it applies in your logged-in browser' : 'this page needs your logged-in browser'}). Start it with <code>npm run runner</code> — see Auto Job Agent.
        </div>
      )}

      <QuestionsPanel app={a} busy={busy} onSubmit={(answers) => decideAct.mutate(() => career.answerQuestions(a.id, answers))} />

      {a.stage === 'skipped' && /below|apply anyway/i.test(a.reason) && (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => act.mutate(() => career.prepareAnyway(a.id))}>
          Apply anyway
        </Button>
      )}

      {a.experienceRequired && <p className="text-xs text-muted-foreground">Experience asked: {a.experienceRequired}</p>}

      <div className="grid grid-cols-3 gap-2 max-w-md">
        <ScorePill label="Match" value={a.matchScore} />
        <ScorePill label="ATS before" value={a.atsBefore} />
        <ScorePill label="ATS after tailoring" value={a.atsAfter} />
      </div>

      <div className="flex flex-wrap gap-2">
        {canApply && (
          <>
            <Button size="sm" disabled={busy} onClick={() => setConfirmSubmit(true)}>
              <Send className="w-4 h-4 mr-1.5" /> Approve & apply
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => act.mutate(() => career.approve(a.id, false))} title="Fill the form in the automation browser and leave it for you to submit">
              <PenLine className="w-4 h-4 mr-1.5" /> Fill form only
            </Button>
          </>
        )}
        {['ready', 'needs_attention'].includes(a.stage) && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => decideAct.mutate(() => career.setStage(a.id, 'applied', { note: 'You marked it as applied' }))}>
            <CheckCircle2 className="w-4 h-4 mr-1.5" /> Mark as applied
          </Button>
        )}
        {['needs_attention', 'failed', 'skipped'].includes(a.stage) && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => act.mutate(() => career.retry(a.id))}>
            <RotateCcw className="w-4 h-4 mr-1.5" /> Retry
          </Button>
        )}
        {!tracker && !['skipped', ...ACTIVE].includes(a.stage) && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => decideAct.mutate(() => career.setStage(a.id, 'skipped', { note: 'You skipped it' }))}>
            <SkipForward className="w-4 h-4 mr-1.5" /> Skip
          </Button>
        )}
        {a.resumeSessionId && (
          <Button size="sm" variant="ghost" asChild>
            <Link to={`/builder/${a.resumeSessionId}`}>
              <FileEdit className="w-4 h-4 mr-1.5" /> Edit resume
            </Link>
          </Button>
        )}
        {(tracker || a.stage === 'ready') && (
          <Button size="sm" variant="ghost" onClick={() => navigate(`/interview?applicationId=${a.id}`)}>
            <Mic className="w-4 h-4 mr-1.5" /> Interview prep
          </Button>
        )}
      </div>

      {tracker && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-background p-3">
          <div>
            <div className="text-xs text-muted-foreground mb-1">Tracker stage</div>
            <Select value={a.stage} onValueChange={(v) => act.mutate(() => career.setStage(a.id, v as TrackerStage, { interviewAt: v === 'interview' && interviewAt ? new Date(interviewAt).toISOString() : undefined }))}>
              <SelectTrigger className="w-44 h-9">
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
            <div className="text-xs text-muted-foreground mb-1">Interview date</div>
            <Input type="datetime-local" className="h-9 w-52" value={interviewAt || (a.interviewAt ? a.interviewAt.slice(0, 16) : '')} onChange={(e) => setInterviewAt(e.target.value)} onBlur={() => interviewAt && act.mutate(() => career.updateApplication(a.id, { interviewAt: new Date(interviewAt).toISOString() }))} />
          </div>
          <div className="text-xs text-muted-foreground">Follow up: {fmtDate(a.followUpAt)}</div>
          <div className="ml-auto flex gap-1">
            <Button size="sm" variant="outline" onClick={() => career.emailDraft(a.id, 'follow_up').then(setEmail, (e) => toast({ title: errMsg(e), variant: 'destructive' }))}>
              <Mail className="w-4 h-4 mr-1.5" /> Follow-up email
            </Button>
            <Button size="sm" variant="outline" onClick={() => career.emailDraft(a.id, 'thank_you').then(setEmail, (e) => toast({ title: errMsg(e), variant: 'destructive' }))}>
              <Mail className="w-4 h-4 mr-1.5" /> Thank-you email
            </Button>
          </div>
        </div>
      )}

      <Tabs defaultValue={a.hasResumePdf ? 'resume' : 'jd'}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="resume">Tailored resume</TabsTrigger>
          <TabsTrigger value="skills">Skills</TabsTrigger>
          <TabsTrigger value="jd">Job description</TabsTrigger>
          <TabsTrigger value="answers">Answers ({a.answers.length})</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>
        <TabsContent value="resume" className="space-y-2">
          {a.hasResumePdf ? (
            <>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => download(`/applications/${a.id}/resume.pdf?download=1`, `${a.company || 'job'}-resume.pdf`).catch((e) => toast({ title: errMsg(e), variant: 'destructive' }))}>
                  <Download className="w-4 h-4 mr-1.5" /> Download PDF
                </Button>
                {a.resumeSessionId && (
                  <Button size="sm" variant="ghost" asChild>
                    <Link to={`/builder/${a.resumeSessionId}`}>Open in Resume Builder</Link>
                  </Button>
                )}
              </div>
              <PdfPreview path={`/applications/${a.id}/resume.pdf`} version={`${a.resumeVersionId}-${a.updatedAt}`} className="h-[70vh]" />
              <p className="text-xs text-muted-foreground">This is the exact resume version that is uploaded when you apply. It is saved as “{[a.jobTitle, a.company].filter(Boolean).join(' – ')}” in My resumes → Automation resumes.</p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{ACTIVE.includes(a.stage) ? 'Preparing the tailored resume…' : 'No tailored resume yet.'}</p>
          )}
        </TabsContent>
        <TabsContent value="skills" className="space-y-3">
          <div>
            <div className="text-xs font-medium mb-1">Your resume shows</div>
            <Chips items={a.matchedSkills} tone="good" />
          </div>
          <div>
            <div className="text-xs font-medium mb-1">Missing (never added to your resume without evidence)</div>
            <Chips items={a.missingSkills} tone="bad" empty="Nothing required is missing." />
          </div>
          {a.missingSkills.length > 0 && (
            <Button size="sm" variant="outline" asChild>
              <Link to={`/skills?skill=${encodeURIComponent(a.missingSkills[0])}`}>Make a learning plan</Link>
            </Button>
          )}
        </TabsContent>
        <TabsContent value="jd">
          <pre className="whitespace-pre-wrap text-sm font-sans rounded-lg border bg-background p-3 max-h-[60vh] overflow-auto">{a.description || 'Not read yet.'}</pre>
        </TabsContent>
        <TabsContent value="answers">
          {a.answers.length ? (
            <div className="rounded-lg border bg-background divide-y text-sm">
              {a.answers.map((x, i) => (
                <div key={i} className="px-3 py-2 grid md:grid-cols-[1fr_1fr_auto] gap-2">
                  <div className="font-medium">{x.question}</div>
                  <div className={x.confident ? '' : 'text-amber-700 dark:text-amber-400'}>{x.answer || (x.confident ? '—' : 'Not answered — needs you')}</div>
                  <div className="text-[11px] text-muted-foreground">{x.source}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Form answers appear here after the agent fills an application.</p>
          )}
        </TabsContent>
        <TabsContent value="activity">
          <ol className="space-y-1.5 text-sm">
            {[...a.log].reverse().map((l, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-xs text-muted-foreground w-36 shrink-0">{fmtDate(l.at, true)}</span>
                <span className={l.level === 'error' ? 'text-destructive' : l.level === 'warn' ? 'text-amber-700 dark:text-amber-400' : ''}>{l.message}</span>
              </li>
            ))}
          </ol>
        </TabsContent>
        <TabsContent value="notes" className="space-y-2">
          <Textarea rows={6} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Recruiter name, interview notes, salary discussed…" />
          <div className="flex justify-between">
            <Button size="sm" disabled={notes === a.notes} onClick={() => act.mutate(() => career.updateApplication(a.id, { notes }))}>
              Save notes
            </Button>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirmDelete(true)} disabled={busy}>
              <Trash2 className="w-4 h-4 mr-1.5" /> Delete application
            </Button>
          </div>
        </TabsContent>
      </Tabs>

      <AlertDialog open={confirmSubmit} onOpenChange={setConfirmSubmit}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply to {a.jobTitle}{a.company ? ` at ${a.company}` : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              The automation browser will open the application, upload your tailored resume, answer questions only from your profile and resume, and press Submit. If it hits a CAPTCHA, a login or a question it cannot answer truthfully, it stops and leaves the tab open for you.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => decideAct.mutate(() => career.approve(a.id, true))}>Apply now</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this application?</AlertDialogTitle>
            <AlertDialogDescription>It is removed from the tracker with its notes and generated files. The tailored resume stays in My resumes → Automation resumes.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() =>
                act.mutate(async () => {
                  await career.removeApplication(a.id);
                  onDeleted?.();
                })
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={!!email} onOpenChange={(o) => !o && setEmail(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Email draft</DialogTitle>
          </DialogHeader>
          {email && (
            <div className="space-y-2">
              <Input readOnly value={email.subject} />
              <Textarea readOnly rows={10} value={email.body} />
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{email.method === 'ai' ? 'AI draft' : 'Template'} — review it, then send it yourself.</span>
                <Button size="sm" onClick={() => navigator.clipboard.writeText(`Subject: ${email.subject}\n\n${email.body}`).then(() => toast({ title: 'Copied' }))}>
                  <Copy className="w-4 h-4 mr-1.5" /> Copy
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
