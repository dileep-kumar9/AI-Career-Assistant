import React, { useEffect, useState } from 'react';
import { MessageCircleQuestion, Send } from 'lucide-react';
import type { JobApplication } from '../../../shared/careerTypes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/**
 * The questions an application paused on: ones only you can answer, or
 * remembered / AI answers to confirm before submitting. Your answers are
 * remembered (unless unticked) and the application continues.
 */
export const QuestionsPanel: React.FC<{ app: JobApplication; busy: boolean; onSubmit: (answers: Array<{ question: string; answer: string; remember: boolean }>) => void }> = ({ app, busy, onSubmit }) => {
  const [values, setValues] = useState<Record<string, { answer: string; remember: boolean }>>({});
  useEffect(() => {
    setValues(Object.fromEntries(app.pendingQuestions.map((q) => [q.question, { answer: q.suggested || '', remember: true }])));
  }, [app.id, app.updatedAt, app.pendingQuestions]);
  if (!app.waitingFor || !app.pendingQuestions.length) return null;
  const review = app.waitingFor === 'review';
  const set = (q: string, v: Partial<{ answer: string; remember: boolean }>) => setValues((prev) => ({ ...prev, [q]: { ...prev[q], ...v } }));
  const missing = app.pendingQuestions.filter((q) => q.required && !values[q.question]?.answer.trim());
  return (
    <div className="rounded-xl border-2 border-sky-300 bg-sky-50/60 dark:bg-sky-950/30 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <MessageCircleQuestion className="w-5 h-5 text-sky-600" />
        <div className="font-semibold text-sm">{review ? 'Check these answers before it submits' : 'The application needs your answers'}</div>
      </div>
      <p className="text-xs text-muted-foreground">{review ? 'These came from your saved answers or AI. Edit anything that is not right.' : 'Answer truthfully — the agent never guesses these.'} Answers you tick are remembered and filled in automatically next time (you can still review them).</p>
      {app.pendingQuestions.map((q) => {
        const v = values[q.question] || { answer: '', remember: true };
        return (
          <div key={q.question} className="space-y-1">
            <div className="text-sm font-medium">
              {q.question}
              {q.required && <span className="text-destructive"> *</span>}
              {q.source !== 'none' && <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-normal">{q.source === 'saved' ? 'remembered' : q.source === 'ai' ? 'AI suggestion' : q.source}</span>}
            </div>
            {q.options.length ? (
              <Select value={v.answer || undefined} onValueChange={(a) => set(q.question, { answer: a })}>
                <SelectTrigger className="bg-background">
                  <SelectValue placeholder="Choose…" />
                </SelectTrigger>
                <SelectContent>
                  {q.options.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : q.kind === 'textarea' || (v.answer || '').length > 80 ? (
              <Textarea rows={3} className="bg-background" value={v.answer} onChange={(e) => set(q.question, { answer: e.target.value })} />
            ) : (
              <Input className="bg-background" value={v.answer} onChange={(e) => set(q.question, { answer: e.target.value })} />
            )}
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Checkbox checked={v.remember} onCheckedChange={(c) => set(q.question, { remember: !!c })} /> Remember this answer
            </label>
          </div>
        );
      })}
      <Button
        className="w-full"
        disabled={busy || missing.length > 0}
        onClick={() => onSubmit(app.pendingQuestions.map((q) => ({ question: q.question, answer: values[q.question]?.answer || '', remember: values[q.question]?.remember ?? true })))}
      >
        <Send className="w-4 h-4 mr-1.5" /> {review ? 'Confirm and continue' : 'Save answers and continue applying'}
      </Button>
    </div>
  );
};
