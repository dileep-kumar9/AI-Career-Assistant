import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, Lightbulb, Loader2, Mic, MicOff, Pause, Play, SkipForward, Square, Volume2, VolumeX } from 'lucide-react';
import type { AnswerAnalysis, AnswerMetrics, InterviewSession, InterviewTurn } from '../../../shared/careerTypes';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { errMsg } from '@/components/career/bits';
import { toast } from '@/hooks/use-toast';
import { career, download } from '@/lib/careerApi';
import { cn } from '@/lib/utils';
import { sttSupported, speak, stopSpeaking, ttsSupported, useMicLevel, useRecognizer } from './speech';

/** Timings for the live interviewer (ms). */
const END_OF_ANSWER_SILENCE = 3500;
const HINT_AFTER_SILENCE = 12_000;
const LONG_PAUSE = 2000;
const SPEAKING_LEVEL = 0.12;

const KIND_LABEL: Record<InterviewTurn['kind'], string> = { intro: 'Interviewer', question: 'Question', followup: 'Follow-up', hint: 'Hint', model_answer: 'Suggested answer', feedback: 'Interviewer', clarification: 'Clarification', answer: 'You', closing: 'Interviewer' };
const VERDICT: Record<AnswerAnalysis['verdict'], { label: string; cls: string }> = {
  correct: { label: 'Correct', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' },
  partially_correct: { label: 'Partly correct', cls: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200' },
  incorrect: { label: 'Not correct', cls: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200' },
  unclear: { label: 'Unclear', cls: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200' },
  no_answer: { label: 'No answer', cls: 'bg-muted' },
};

export function AnalysisCard({ a }: { a: AnswerAnalysis }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 rounded-lg border bg-background/80 p-2.5 text-xs space-y-1.5 text-foreground">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={cn('rounded-full px-2 py-0.5 font-medium', VERDICT[a.verdict].cls)}>{VERDICT[a.verdict].label}</span>
        <span className="font-semibold">{a.score}/10</span>
        <span className="rounded-full bg-muted px-2 py-0.5">clarity: {a.clarity.replace('_', ' ')}</span>
        <span className={cn('rounded-full px-2 py-0.5', a.confidence === 'confident' ? 'bg-emerald-50 dark:bg-emerald-950' : 'bg-amber-50 dark:bg-amber-950')}>{a.confidence}</span>
        <span className="text-muted-foreground">{a.method === 'ai' ? 'AI' : 'rule-based'}</span>
      </div>
      {a.deliverySignals.length > 0 && <p className="text-muted-foreground">Delivery: {a.deliverySignals.join(' · ')}</p>}
      {a.strengths.length > 0 && <p>✓ {a.strengths.join(' · ')}</p>}
      {a.gaps.length > 0 && <p>△ {a.gaps.join(' · ')}</p>}
      {a.suggestion && <p className="font-medium">Tip: {a.suggestion}</p>}
      {a.suggestedAnswer && (
        <div>
          <button type="button" className="text-primary underline" onClick={() => setOpen(!open)}>
            {open ? 'Hide' : 'Show'} a stronger answer
          </button>
          {open && <p className="mt-1 whitespace-pre-wrap rounded bg-muted/60 p-2">{a.suggestedAnswer}</p>}
        </div>
      )}
    </div>
  );
}

function Transcript({ session }: { session: InterviewSession }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), [session.turns.length]);
  return (
    <div className="space-y-3">
      {session.turns.map((t) => (
        <div key={t.id} className={cn('flex', t.speaker === 'user' ? 'justify-end' : 'justify-start')}>
          <div className={cn('max-w-[88%] rounded-2xl px-3.5 py-2 text-sm', t.speaker === 'user' ? 'bg-primary text-primary-foreground' : t.kind === 'hint' || t.kind === 'model_answer' ? 'bg-amber-50 dark:bg-amber-950/40 border' : 'bg-background border')}>
            <div className={cn('text-[10px] uppercase tracking-wide mb-0.5', t.speaker === 'user' ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
              {KIND_LABEL[t.kind]}
              {t.kind === 'question' && ` ${t.questionIndex + 1}/${session.questions.length}`}
            </div>
            <p className="whitespace-pre-wrap">{t.text}</p>
            {t.analysis && <AnalysisCard a={t.analysis} />}
          </div>
        </div>
      ))}
      <div ref={end} />
    </div>
  );
}

export function SummaryCard({ session }: { session: InterviewSession }) {
  const s = session.summary;
  if (!s) return null;
  return (
    <div className="rounded-xl border bg-background p-4 space-y-2">
      <div className="flex items-center gap-3">
        <div className="text-3xl font-bold">{s.overallScore}/10</div>
        <div className="text-sm">{s.readiness === 'ready' ? 'Ready for the real interview' : s.readiness === 'almost' ? 'Almost there' : 'Needs more practice'}</div>
      </div>
      {s.strengths.length > 0 && (
        <div className="text-sm">
          <div className="font-medium">Strengths</div>
          <ul className="list-disc pl-5">{s.strengths.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      )}
      {s.improve.length > 0 && (
        <div className="text-sm">
          <div className="font-medium">Practise next</div>
          <ul className="list-disc pl-5">{s.improve.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      )}
      <ul className="text-xs text-muted-foreground space-y-0.5">
        {s.perQuestion.map((p, i) => (
          <li key={i}>
            Q{i + 1}: {p.score ?? '—'}/10 · {VERDICT[p.verdict].label} — {p.question.slice(0, 90)}
          </li>
        ))}
      </ul>
    </div>
  );
}

type Phase = 'idle' | 'ai' | 'listening' | 'thinking' | 'paused' | 'done';

/**
 * One interview. Live mode: the interviewer speaks, listens, detects speech and
 * silence, and takes turns automatically. Coach mode: answer at your own pace
 * (typing or dictation) and get suggestions after every answer.
 */
export const InterviewRoom: React.FC<{ initial: InterviewSession; folderRoot: string }> = ({ initial, folderRoot }) => {
  const qc = useQueryClient();
  const [session, setSession] = useState(initial);
  const live = session.mode === 'live';
  const [phase, setPhase] = useState<Phase>(session.status === 'finished' ? 'done' : 'idle');
  const [muted, setMuted] = useState(!ttsSupported);
  const [typed, setTyped] = useState('');
  const [finalText, setFinalText] = useState('');
  const [interim, setInterim] = useState('');
  const [micError, setMicError] = useState<string | null>(null);
  const timing = useRef({ questionEnd: 0, firstSpeech: 0, lastActivity: 0, pauses: 0, hinting: false });
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const answerRef = useRef('');
  answerRef.current = `${finalText} ${interim}`.trim();

  const mic = useMicLevel(live && (phase === 'listening' || phase === 'paused'));
  const recog = useRecognizer({
    onText: (t) => setFinalText((prev) => `${prev} ${t}`.trim()),
    onInterim: setInterim,
    onActivity: () => markActivity(),
    onError: setMicError,
  });
  const { start: startRecog, stop: stopRecog } = recog;
  const stopRef = useRef(stopRecog);
  stopRef.current = stopRecog;

  const markActivity = () => {
    const t = timing.current;
    const nowMs = Date.now();
    if (!t.firstSpeech) t.firstSpeech = nowMs;
    else if (nowMs - t.lastActivity > LONG_PAUSE) t.pauses++;
    t.lastActivity = nowMs;
  };

  const sayTurns = useCallback(
    async (turns: InterviewTurn[]) => {
      if (muted) return;
      for (const t of turns) {
        if (t.speaker !== 'ai') continue;
        await speak(t.kind === 'model_answer' ? 'Here is a suggested answer on the screen.' : t.text);
      }
    },
    [muted],
  );

  const startListening = useCallback(() => {
    timing.current = { questionEnd: Date.now(), firstSpeech: 0, lastActivity: 0, pauses: 0, hinting: false };
    setFinalText('');
    setInterim('');
    setPhase('listening');
    if (live && sttSupported) startRecog();
  }, [live, startRecog]);

  const afterServer = useCallback(
    async (next: InterviewSession, said: InterviewTurn[]) => {
      setSession(next);
      qc.invalidateQueries({ queryKey: ['interview-sessions'] });
      if (live) {
        setPhase('ai');
        await sayTurns(said);
      }
      if (next.status === 'finished') setPhase('done');
      else if (live) startListening();
      else setPhase('idle');
    },
    [live, qc, sayTurns, startListening],
  );

  const call = useCallback(
    async (fn: () => Promise<{ session: InterviewSession; said: InterviewTurn[] }>) => {
      stopRecog();
      setPhase('thinking');
      try {
        const r = await fn();
        await afterServer(r.session, r.said);
      } catch (e) {
        toast({ title: 'The interviewer could not respond', description: errMsg(e), variant: 'destructive' });
        if (live) startListening();
        else setPhase('idle');
      }
    },
    [afterServer, live, stopRecog, startListening],
  );

  const submit = useCallback(
    (text: string) => {
      const t = timing.current;
      const nowMs = Date.now();
      const metrics: AnswerMetrics = live
        ? { source: 'voice', secondsToStart: t.firstSpeech ? (t.firstSpeech - t.questionEnd) / 1000 : null, durationSec: t.firstSpeech ? (nowMs - t.firstSpeech) / 1000 : null, longPauses: t.pauses, speechDetected: !!t.firstSpeech }
        : { source: 'text', secondsToStart: null, durationSec: null, longPauses: 0, speechDetected: false };
      setTyped('');
      return call(() => career.respondInterview(session.id, text, metrics));
    },
    [call, live, session.id],
  );

  // Live turn-taking: detect speaking vs silence, end of answer, and long silence.
  useEffect(() => {
    if (!live || phase !== 'listening') return;
    const id = window.setInterval(() => {
      if (phaseRef.current !== 'listening') return;
      const t = timing.current;
      const nowMs = Date.now();
      if (mic.level > SPEAKING_LEVEL) markActivity();
      if (t.firstSpeech && answerRef.current && nowMs - t.lastActivity > END_OF_ANSWER_SILENCE) {
        submit(answerRef.current);
      } else if (!t.firstSpeech && !t.hinting && nowMs - t.questionEnd > HINT_AFTER_SILENCE) {
        t.hinting = true;
        call(() => career.interviewHint(session.id));
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [live, phase, mic.level, submit, call, session.id]);

  // Stop the voice and the microphone when leaving the interview.
  useEffect(() => () => {
    stopSpeaking();
    stopRef.current();
  }, []);

  const begin = async () => {
    if (live) {
      setPhase('ai');
      // Say what the interviewer said since your last answer (the intro and first question on a new interview).
      let lastUser = -1;
      session.turns.forEach((t, i) => t.speaker === 'user' && (lastUser = i));
      await sayTurns(session.turns.slice(lastUser + 1));
      startListening();
    } else setPhase('idle');
  };

  const pauseResume = () => {
    if (phase === 'paused') startListening();
    else {
      stopRecog();
      stopSpeaking();
      setPhase('paused');
    }
  };

  const finish = async () => {
    stopRecog();
    stopSpeaking();
    setPhase('thinking');
    try {
      const done = await career.finishInterview(session.id);
      setSession(done);
      setPhase('done');
      qc.invalidateQueries({ queryKey: ['interview-sessions'] });
      if (live && !muted) speak(`That's the end of the interview. Your overall score is ${done.summary?.overallScore ?? 0} out of 10.`);
    } catch (e) {
      toast({ title: errMsg(e), variant: 'destructive' });
      setPhase('idle');
    }
  };

  const progress = Math.round((Math.min(session.current, session.questions.length) / Math.max(session.questions.length, 1)) * 100);
  const speaking = live && phase === 'listening' && mic.level > SPEAKING_LEVEL;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="rounded-xl border bg-muted/20 p-3 min-h-[60vh] max-h-[72vh] overflow-y-auto">
        <Transcript session={session} />
        {live && phase === 'listening' && answerRef.current && (
          <div className="flex justify-end mt-3">
            <div className="max-w-[88%] rounded-2xl px-3.5 py-2 text-sm bg-primary/70 text-primary-foreground italic">{answerRef.current}</div>
          </div>
        )}
      </div>

      <aside className="space-y-3">
        <div className="rounded-xl border bg-background p-3 space-y-2">
          <div className="text-sm font-semibold">
            {session.role || 'Interview'}
            {session.company ? ` · ${session.company}` : ''}
          </div>
          <Progress value={progress} />
          <div className="text-xs text-muted-foreground">
            Question {Math.min(session.current + 1, session.questions.length)} of {session.questions.length} · {live ? 'Live AI interview' : 'Coach mode'} · {session.method === 'ai' ? 'AI interviewer' : 'rule-based interviewer'}
          </div>
          <div className="text-[11px] text-muted-foreground break-all">Saved to: {folderRoot ? `${folderRoot}\\${session.folder}` : session.folder}</div>
          <Button size="sm" variant="outline" className="w-full" onClick={() => download(`/interview-sessions/${session.id}/transcript.md`, `${session.folder}.md`).catch((e) => toast({ title: errMsg(e), variant: 'destructive' }))}>
            <Download className="w-4 h-4 mr-1.5" /> Download transcript
          </Button>
        </div>

        {phase === 'done' ? (
          <SummaryCard session={session} />
        ) : phase === 'idle' && live ? (
          <div className="rounded-xl border bg-background p-3 space-y-2 text-sm">
            <p>The interviewer will speak each question and listen to your answer. Speak naturally; after a few seconds of silence your answer is sent. Stay silent and you get a hint, then a suggested answer.</p>
            {!sttSupported && <p className="text-amber-700 dark:text-amber-400">This browser has no speech recognition — use Chrome or Edge, or answer by typing below.</p>}
            <Button className="w-full" onClick={begin}>
              <Play className="w-4 h-4 mr-1.5" /> Start interview
            </Button>
          </div>
        ) : (
          <div className="rounded-xl border bg-background p-3 space-y-3">
            {live && (
              <div className="flex items-center gap-2">
                <div className={cn('w-10 h-10 rounded-full flex items-center justify-center transition', speaking ? 'bg-emerald-500 text-white scale-110' : phase === 'listening' ? 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-200' : 'bg-muted text-muted-foreground')}>
                  {phase === 'thinking' ? <Loader2 className="w-5 h-5 animate-spin" /> : phase === 'listening' ? <Mic className="w-5 h-5" /> : phase === 'paused' ? <MicOff className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                </div>
                <div className="text-sm">
                  {phase === 'ai' && 'Interviewer is speaking…'}
                  {phase === 'listening' && (speaking ? 'You are speaking…' : timing.current.firstSpeech ? 'Listening… (pause to finish)' : 'Your turn — speak when ready')}
                  {phase === 'thinking' && 'Interviewer is thinking…'}
                  {phase === 'paused' && 'Paused'}
                </div>
              </div>
            )}
            {live && phase === 'listening' && (
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-emerald-500 transition-all" style={{ width: `${Math.round(mic.level * 100)}%` }} />
              </div>
            )}
            {(micError || mic.error) && <p className="text-xs text-destructive">{micError || mic.error}</p>}

            {(!live || !sttSupported || micError || mic.error) && (
              <>
                <Textarea rows={5} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type your answer…" disabled={phase === 'thinking'} />
                <Button className="w-full" disabled={!typed.trim() || phase === 'thinking'} onClick={() => submit(typed)}>
                  Send answer
                </Button>
              </>
            )}
            <div className="grid grid-cols-2 gap-2">
              {live && (
                <Button size="sm" variant="outline" disabled={phase !== 'listening' || !answerRef.current} onClick={() => submit(answerRef.current)}>
                  <Square className="w-4 h-4 mr-1.5" /> I'm done
                </Button>
              )}
              {live && (
                <Button size="sm" variant="outline" disabled={phase === 'thinking' || phase === 'ai'} onClick={pauseResume}>
                  {phase === 'paused' ? <Play className="w-4 h-4 mr-1.5" /> : <Pause className="w-4 h-4 mr-1.5" />} {phase === 'paused' ? 'Resume' : 'Pause'}
                </Button>
              )}
              <Button size="sm" variant="outline" disabled={phase === 'thinking' || phase === 'ai'} onClick={() => call(() => career.interviewHint(session.id))}>
                <Lightbulb className="w-4 h-4 mr-1.5" /> Hint
              </Button>
              <Button size="sm" variant="outline" disabled={phase === 'thinking' || phase === 'ai'} onClick={() => call(() => career.skipInterviewQuestion(session.id))}>
                <SkipForward className="w-4 h-4 mr-1.5" /> Skip
              </Button>
              {live && ttsSupported && (
                <Button size="sm" variant="ghost" onClick={() => (setMuted(!muted), stopSpeaking())}>
                  {muted ? <VolumeX className="w-4 h-4 mr-1.5" /> : <Volume2 className="w-4 h-4 mr-1.5" />} {muted ? 'Voice off' : 'Voice on'}
                </Button>
              )}
              <Button size="sm" variant="ghost" className="text-destructive" disabled={phase === 'thinking'} onClick={finish}>
                End interview
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">Speech is recognised by your browser (Chrome/Edge send audio to their speech service). The interviewer never invents facts about you; suggested answers use only your resume and what you said.</p>
          </div>
        )}
      </aside>
    </div>
  );
};
