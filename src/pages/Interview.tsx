import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Mic, MicOff, Plus, Trash2 } from 'lucide-react';
import type { InterviewAttempt, InterviewSet } from '../../shared/careerTypes';
import { TRACKER_STAGES } from '../../shared/careerTypes';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Empty, errMsg, fmtDate } from '@/components/career/bits';
import { toast } from '@/hooks/use-toast';
import { career } from '@/lib/careerApi';
import { cn } from '@/lib/utils';

/** The parts of the Web Speech API used here (not in TypeScript's DOM types). */
interface SpeechResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}
interface Recognizer {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognizerCtor = new () => Recognizer;

/** Browser speech-to-text (Chrome/Edge). Returns null where unsupported. */
function useDictation(onText: (t: string) => void) {
  const rec = useRef<Recognizer | null>(null);
  const [on, setOn] = useState(false);
  const w = typeof window !== 'undefined' ? (window as unknown as { SpeechRecognition?: RecognizerCtor; webkitSpeechRecognition?: RecognizerCtor }) : null;
  const Ctor = w ? w.SpeechRecognition || w.webkitSpeechRecognition || null : null;
  const start = () => {
    if (!Ctor) return;
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = false;
    r.lang = navigator.language || 'en-US';
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) onText(e.results[i][0].transcript.trim());
    };
    r.onend = () => setOn(false);
    r.onerror = () => setOn(false);
    r.start();
    rec.current = r;
    setOn(true);
  };
  const stop = () => rec.current?.stop();
  useEffect(() => () => rec.current?.stop(), []);
  return Ctor ? { on, start, stop } : null;
}

function Feedback({ a }: { a: InterviewAttempt }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-2 text-sm">
      <div className="flex items-center gap-2">
        <span className={cn('text-2xl font-bold', a.score >= 7 ? 'text-emerald-600' : a.score >= 4 ? 'text-amber-600' : 'text-rose-600')}>{a.score}/10</span>
        <span className="text-xs text-muted-foreground">{a.method === 'ai' ? 'AI coach' : 'Rule-based coach'} · {fmtDate(a.at, true)}</span>
      </div>
      {a.strengths.length > 0 && (
        <div>
          <div className="text-xs font-semibold">Good</div>
          <ul className="list-disc pl-5">{a.strengths.map((s) => <li key={s}>{s}</li>)}</ul>
        </div>
      )}
      {a.missing.length > 0 && (
        <div>
          <div className="text-xs font-semibold">Improve</div>
          <ul className="list-disc pl-5">{a.missing.map((s) => <li key={s}>{s}</li>)}</ul>
        </div>
      )}
      <div>
        <div className="text-xs font-semibold">A stronger answer (uses only your real experience)</div>
        <p className="whitespace-pre-wrap">{a.improvedAnswer}</p>
      </div>
      {a.followUp && <p className="text-xs text-muted-foreground">Likely follow-up: {a.followUp}</p>}
    </div>
  );
}

function Practice({ set }: { set: InterviewSet }) {
  const qc = useQueryClient();
  const [current, setCurrent] = useState(set.questions[0]?.id);
  const [answer, setAnswer] = useState('');
  const q = set.questions.find((x) => x.id === current) || set.questions[0];
  const attempts = set.attempts.filter((a) => a.questionId === q?.id);
  const dictation = useDictation((t) => setAnswer((prev) => (prev ? `${prev} ${t}` : t)));
  const submit = useMutation({
    mutationFn: () => career.answerQuestion(set.id, q.id, answer),
    onSuccess: ({ set: next }) => {
      qc.setQueryData(['interview', set.id], next);
      qc.invalidateQueries({ queryKey: ['interviews'] });
      setAnswer('');
    },
    onError: (e) => toast({ title: 'Could not evaluate', description: errMsg(e), variant: 'destructive' }),
  });
  const avg = useMemo(() => {
    const best = new Map<string, number>();
    for (const a of set.attempts) best.set(a.questionId, Math.max(best.get(a.questionId) ?? 0, a.score));
    return best.size ? Math.round(([...best.values()].reduce((x, y) => x + y, 0) / best.size) * 10) / 10 : null;
  }, [set.attempts]);
  if (!q) return null;
  return (
    <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
      <div className="space-y-1">
        <div className="text-xs text-muted-foreground px-1 mb-1">
          {set.questions.length} questions · {set.method === 'ai' ? 'AI' : 'rule-based'} · average best score {avg ?? '—'}
        </div>
        {set.questions.map((x, i) => {
          const best = Math.max(-1, ...set.attempts.filter((a) => a.questionId === x.id).map((a) => a.score));
          return (
            <button key={x.id} type="button" onClick={() => setCurrent(x.id)} className={cn('w-full text-left rounded-lg border bg-background px-3 py-2 text-sm hover:border-primary/60', x.id === q.id && 'border-primary ring-1 ring-primary')}>
              <div className="flex gap-2">
                <span className="text-muted-foreground">{i + 1}.</span>
                <span className="flex-1 line-clamp-2">{x.question}</span>
                {best >= 0 && <span className="text-xs font-semibold tabular-nums">{best}</span>}
              </div>
              <div className="text-[11px] text-muted-foreground capitalize mt-0.5">{x.category}{x.skill ? ` · ${x.skill}` : ''}</div>
            </button>
          );
        })}
      </div>
      <div className="space-y-3">
        <div className="rounded-xl border bg-background p-4">
          <div className="text-xs text-muted-foreground capitalize">{q.category}{q.skill ? ` · ${q.skill}` : ''}</div>
          <h3 className="text-lg font-semibold mt-1">{q.question}</h3>
          <p className="text-sm text-muted-foreground mt-1">{q.why}</p>
          {q.idealPoints.length > 0 && (
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-muted-foreground">What a strong answer covers</summary>
              <ul className="list-disc pl-5 mt-1">{q.idealPoints.map((p) => <li key={p}>{p}</li>)}</ul>
            </details>
          )}
          <Textarea className="mt-3" rows={7} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Type your answer as you would say it — or use the microphone." />
          <div className="mt-2 flex items-center gap-2">
            <Button disabled={!answer.trim() || submit.isPending} onClick={() => submit.mutate()}>
              {submit.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />} Get feedback
            </Button>
            {dictation && (
              <Button variant="outline" onClick={() => (dictation.on ? dictation.stop() : dictation.start())}>
                {dictation.on ? <MicOff className="w-4 h-4 mr-1.5" /> : <Mic className="w-4 h-4 mr-1.5" />} {dictation.on ? 'Stop' : 'Speak'}
              </Button>
            )}
            <span className="text-xs text-muted-foreground ml-auto">{answer.trim() ? answer.trim().split(/\s+/).length : 0} words</span>
          </div>
        </div>
        {[...attempts].reverse().map((a) => (
          <div key={a.at}>
            <p className="text-xs text-muted-foreground mb-1">Your answer: “{a.answer.slice(0, 300)}{a.answer.length > 300 ? '…' : ''}”</p>
            <Feedback a={a} />
          </div>
        ))}
      </div>
    </div>
  );
}

export const Interview: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const id = params.get('id');
  const fromApp = params.get('applicationId');
  const { data: sets = [] } = useQuery({ queryKey: ['interviews'], queryFn: career.interviews });
  const { data: apps = [] } = useQuery({ queryKey: ['applications'], queryFn: career.applications });
  const { data: set } = useQuery({ queryKey: ['interview', id], queryFn: () => career.interview(id!), enabled: !!id });
  const [form, setForm] = useState({ applicationId: fromApp || '', role: '', company: '', jobDescription: '' });
  useEffect(() => {
    if (fromApp) setForm((f) => ({ ...f, applicationId: fromApp }));
  }, [fromApp]);
  const candidates = apps.filter((a) => a.description && ((TRACKER_STAGES as string[]).includes(a.stage) || a.stage === 'ready'));
  const create = useMutation({
    mutationFn: () => career.createInterview(form.applicationId ? { applicationId: form.applicationId } : { role: form.role, company: form.company, jobDescription: form.jobDescription }),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ['interviews'] });
      setParams({ id: s.id });
    },
    onError: (e) => toast({ title: 'Could not create questions', description: errMsg(e), variant: 'destructive' }),
  });
  const remove = useMutation({
    mutationFn: (sid: string) => career.removeInterview(sid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['interviews'] });
      setParams({});
    },
  });

  return (
    <AppShell title="Interview Prep" subtitle="Likely questions for a specific job and your resume, with coaching" wide>
      {!id || !set ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <section className="rounded-xl border bg-background p-4 space-y-3">
            <h2 className="font-semibold">New practice set</h2>
            <div>
              <Label>For an application</Label>
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
                  <Input placeholder="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} />
                  <Input placeholder="Company (optional)" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
                </div>
                <Textarea rows={5} placeholder="Paste the job description (optional, makes questions specific)" value={form.jobDescription} onChange={(e) => setForm({ ...form, jobDescription: e.target.value })} />
              </>
            )}
            <Button disabled={create.isPending || (!form.applicationId && !form.role.trim())} onClick={() => create.mutate()}>
              {create.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Plus className="w-4 h-4 mr-1.5" />} Create questions
            </Button>
          </section>
          <section className="space-y-2">
            <h2 className="font-semibold">Your practice sets</h2>
            {sets.length ? (
              sets.map((s) => (
                <div key={s.id} className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2">
                  <button type="button" className="flex-1 text-left" onClick={() => setParams({ id: s.id })}>
                    <div className="text-sm font-medium">{s.role || 'Interview'}{s.company ? ` · ${s.company}` : ''}</div>
                    <div className="text-xs text-muted-foreground">
                      {s.questions.length} questions · {new Set(s.attempts.map((a) => a.questionId)).size} answered · {fmtDate(s.createdAt)}
                    </div>
                  </button>
                  <Button size="icon" variant="ghost" aria-label="Delete set" onClick={() => remove.mutate(s.id)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))
            ) : (
              <Empty icon={Mic} title="No practice sets yet">When an application reaches the Interview stage, create questions for it here.</Empty>
            )}
          </section>
        </div>
      ) : (
        <>
          <div className="mb-4 flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setParams({})}>
              ← All sets
            </Button>
            <h2 className="font-semibold">
              {set.role}
              {set.company ? ` · ${set.company}` : ''}
            </h2>
          </div>
          <Practice set={set} />
        </>
      )}
    </AppShell>
  );
};
