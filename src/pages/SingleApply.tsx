import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Loader2, Send } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ApplicationDetail } from '@/components/career/ApplicationDetail';
import { ResumeSelect } from '@/components/career/ResumeSelect';
import { ACTIVE, Empty, StageBadge, errMsg, fmtDate } from '@/components/career/bits';
import { toast } from '@/hooks/use-toast';
import { career } from '@/lib/careerApi';
import { cn } from '@/lib/utils';

export const SingleApply: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const [url, setUrl] = useState(params.get('url') || '');
  const [resumeId, setResumeId] = useState<string | null>(null);
  const [mode, setMode] = useState<'review' | 'auto'>('review');
  const selected = params.get('id');
  const { data: apps = [] } = useQuery({
    queryKey: ['applications'],
    queryFn: career.applications,
    refetchInterval: (q) => ((q.state.data || []).some((a) => ACTIVE.includes(a.stage)) ? 2500 : 20_000),
  });
  const mine = apps.filter((a) => a.origin === 'single');
  useEffect(() => {
    if (!selected && mine[0]) setParams((p) => ({ ...Object.fromEntries(p), id: mine[0].id }), { replace: true });
  }, [selected, mine, setParams]);

  const start = useMutation({
    mutationFn: () => career.applyLink(url.trim(), mode, resumeId),
    onSuccess: (a) => {
      qc.invalidateQueries({ queryKey: ['applications'] });
      setUrl('');
      setParams({ id: a.id });
      toast({ title: a.stage === 'found' ? 'Reading the job…' : 'You already have this job', description: a.stage === 'found' ? 'The steps appear on the right as they happen.' : `${a.jobTitle} at ${a.company}` });
    },
    onError: (e) => toast({ title: 'Could not start', description: errMsg(e), variant: 'destructive' }),
  });

  return (
    <AppShell title="Single Job Apply" subtitle="Paste one job link: the app reads it, tailors your resume and applies" wide>
      <form
        className="rounded-xl border bg-background p-4 space-y-3 mb-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) start.mutate();
        }}
      >
        <div className="flex flex-col md:flex-row gap-2">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… job link (Greenhouse, Lever, Ashby, Workday, LinkedIn, Naukri, Indeed or any careers page)" aria-label="Job link" />
          <Button type="submit" disabled={!url.trim() || start.isPending} className="shrink-0">
            {start.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Send className="w-4 h-4 mr-1.5" />} Start
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Resume</span>
            <ResumeSelect value={resumeId} onChange={setResumeId} className="w-64 h-9" />
          </div>
          <RadioGroup value={mode} onValueChange={(v) => setMode(v as 'review' | 'auto')} className="flex gap-4">
            <div className="flex items-center gap-1.5">
              <RadioGroupItem id="m-review" value="review" />
              <Label htmlFor="m-review" className="font-normal">Review before applying</Label>
            </div>
            <div className="flex items-center gap-1.5">
              <RadioGroupItem id="m-auto" value="auto" />
              <Label htmlFor="m-auto" className="font-normal">Apply automatically when ready</Label>
            </div>
          </RadioGroup>
        </div>
        <p className="text-xs text-muted-foreground">
          Steps: read the page → find and analyse the job description → match score → copy your resume as “Role – Company” → tailor it (only your real experience) → show it to you → apply in the automation browser → save to the tracker.
        </p>
      </form>

      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <aside className="space-y-1">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-1 mb-1">Your single applies</h2>
          {mine.length ? (
            mine.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setParams({ id: a.id })}
                className={cn('w-full text-left rounded-lg border bg-background px-3 py-2 hover:border-primary/60', selected === a.id && 'border-primary ring-1 ring-primary')}
              >
                <div className="text-sm font-medium truncate">{a.jobTitle || a.jobUrl}</div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-muted-foreground truncate flex-1">{a.company || fmtDate(a.createdAt)}</span>
                  <StageBadge stage={a.stage} />
                </div>
              </button>
            ))
          ) : (
            <p className="text-sm text-muted-foreground px-1">None yet.</p>
          )}
        </aside>
        <section className="rounded-xl border bg-background p-4 min-h-[20rem]">
          {selected ? (
            <ApplicationDetail id={selected} onDeleted={() => setParams({})} />
          ) : (
            <Empty icon={Link2} title="Paste a job link to begin">
              The tailored resume, match score and every step appear here.
            </Empty>
          )}
        </section>
      </div>
    </AppShell>
  );
};
