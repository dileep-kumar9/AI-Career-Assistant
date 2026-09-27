import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Bot, HelpCircle, Loader2, Paperclip, Send, User } from 'lucide-react';
import type { ChatMessage } from '../../../shared/apiTypes';
import { wordDiff } from '../../../shared/diff';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

export const SUGGESTED_COMMANDS = [
  'Analyse my resume and tell me its strengths and weaknesses.',
  'Why is my ATS score low?',
  'How can I increase my ATS score?',
  'Suggest some projects for this role.',
  'Tailor my resume for this job: <paste the job link>',
  'Make my resume fit on one page.',
  'Improve my resume.',
  'Tailor my resume to the job description.',
  'Remove the line below my name.',
  'Make my professional summary shorter.',
  'Rewrite my experience using stronger action verbs.',
  'Improve the ATS score without adding fake skills.',
  'Highlight my AWS experience.',
  'Reduce this resume to one page.',
  'Add a projects section.',
  'Remove the objective section.',
  'Show me what changed in the latest version.',
  'Undo the last change.',
  'Restore the previous version.',
  'Change the resume template to a clean professional design.',
];

/** Minimal markdown: **bold** and "- " bullets (rendered as •). Text only — no HTML injection. */
function formatText(text: string): React.ReactNode {
  return text.split('\n').map((line, i, all) => {
    const bullet = /^\s*[-*]\s+/.test(line);
    const body = line.replace(/^\s*[-*]\s+/, '').replace(/^#{1,4}\s+/, '');
    const parts = body.split(/\*\*(.+?)\*\*/g).map((p, j) => (j % 2 ? <strong key={j}>{p}</strong> : p));
    return (
      <React.Fragment key={i}>
        {bullet ? <span className="pl-1">• {parts}</span> : parts}
        {i < all.length - 1 ? '\n' : null}
      </React.Fragment>
    );
  });
}

const ScoreChange: React.FC<{ before?: number | null; after?: number | null }> = ({ before, after }) => {
  if (after === null || after === undefined) return null;
  if (before === null || before === undefined) return <span className="text-xs text-muted-foreground">ATS score: {after}</span>;
  const d = after - before;
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      ATS {before} <ArrowRight className="w-3 h-3" /> {after}
      <span className={cn('font-semibold tabular-nums', d > 0 ? 'text-emerald-600' : d < 0 ? 'text-red-600' : 'text-muted-foreground')}>
        ({d > 0 ? '+' : ''}
        {d})
      </span>
    </span>
  );
};

/** Quick replies for an offer, shown only on the latest assistant message. */
const OfferActions: React.FC<{ offer: NonNullable<ChatMessage['meta']['offer']>; onReply: (text: string) => void; disabled?: boolean }> = ({ offer, onReply, disabled }) => {
  const skills = offer.skills || [];
  const projects = offer.projects || [];
  const chip = 'rounded-full border bg-background px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-50';
  return (
    <div className="space-y-2 pt-1">
      {skills.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {skills.map((s) => (
            <button key={s} type="button" className={chip} disabled={disabled} onClick={() => onReply(`add ${s}`)}>
              + {s}
            </button>
          ))}
          {skills.length > 1 && (
            <button type="button" className={cn(chip, 'font-medium')} disabled={disabled} onClick={() => onReply('yes, add all skills')}>
              Add all
            </button>
          )}
        </div>
      )}
      {projects.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {projects.map((p, i) => (
            <button key={p.title} type="button" className={cn(chip, 'rounded-lg text-left')} disabled={disabled} onClick={() => onReply(`add project ${i + 1}`)} title={p.description}>
              + {i + 1}. {p.title}
              {p.technologies.length > 0 && <span className="text-muted-foreground"> — {p.technologies.join(', ')}</span>}
            </button>
          ))}
        </div>
      )}
      <button type="button" className={cn(chip, 'text-muted-foreground')} disabled={disabled} onClick={() => onReply('no, skip them')}>
        No thanks
      </button>
    </div>
  );
};

const Message: React.FC<{ m: ChatMessage; onAsk: (text: string) => void; latest?: boolean; onReply?: (text: string) => void; busy?: boolean }> = ({ m, onAsk, latest, onReply, busy }) => {
  const isUser = m.role === 'user';
  const meta = m.meta || {};
  return (
    <div className={cn('flex gap-2', isUser && 'flex-row-reverse')}>
      <div className={cn('w-7 h-7 rounded-full flex items-center justify-center shrink-0', isUser ? 'bg-primary text-primary-foreground' : 'bg-muted')}>{isUser ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}</div>
      <div className={cn('max-w-[88%] rounded-2xl px-3 py-2 text-sm space-y-2', isUser ? 'bg-primary text-primary-foreground rounded-tr-sm' : meta.kind === 'error' ? 'bg-red-50 text-red-900 border border-red-200 dark:bg-red-950/40 dark:text-red-200 dark:border-red-900 rounded-tl-sm' : 'bg-muted rounded-tl-sm')}>
        <div className="whitespace-pre-wrap break-words">{formatText(m.content)}</div>
        {!!meta.changes?.length && meta.kind !== 'diff' && (
          <ul className="list-disc pl-4 text-xs opacity-90 space-y-0.5">
            {meta.changes.slice(0, 8).map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        )}
        {meta.kind === 'diff' && !!meta.diff?.length && (
          <div className="space-y-2">
            {meta.diff.slice(0, 10).map((d, i) => (
              <div key={i} className="rounded-md bg-background/70 p-2 text-xs">
                <div className="font-medium mb-1">
                  {d.type === 'added' ? 'Added' : d.type === 'removed' ? 'Removed' : 'Updated'} · {d.label}
                  {d.item ? ` (${d.item})` : ''}
                </div>
                {d.type === 'modified' && d.before !== undefined && d.after !== undefined ? (
                  <div className="whitespace-pre-wrap leading-relaxed">
                    {wordDiff(d.before, d.after).map((t, j) => (
                      <span key={j} className={t.type === 'add' ? 'bg-emerald-200/70 dark:bg-emerald-800/60' : t.type === 'del' ? 'bg-red-200/70 line-through dark:bg-red-900/60' : ''}>
                        {t.text}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap text-muted-foreground line-clamp-4">{d.after || d.before}</div>
                )}
              </div>
            ))}
          </div>
        )}
        {!!meta.warnings?.length && (
          <div className="rounded-md bg-amber-50 text-amber-900 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900 p-2 text-xs space-y-1">
            <div className="flex items-center gap-1 font-medium">
              <AlertTriangle className="w-3.5 h-3.5" /> {meta.kind === 'generate' || meta.kind === 'edit' ? 'Fact check' : 'Note'}
            </div>
            {meta.warnings.slice(0, 5).map((w, i) => (
              <div key={i}>{w}</div>
            ))}
          </div>
        )}
        {!!meta.skillGaps?.length && (
          <div className="text-xs">
            <span className="font-medium">Skill gaps (not added):</span> {meta.skillGaps.join(', ')}
          </div>
        )}
        {!!meta.questions?.length && (
          <div className="text-xs flex gap-1">
            <HelpCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            {meta.questions.join(' ')}
          </div>
        )}
        {(meta.scoreAfter !== undefined && meta.scoreAfter !== null) && <ScoreChange before={meta.scoreBefore} after={meta.scoreAfter} />}
        {latest && onReply && (meta.offer?.skills?.length || meta.offer?.projects?.length) ? (
          <OfferActions offer={meta.offer!} onReply={onReply} disabled={busy} />
        ) : (
          meta.kind === 'question' &&
          latest && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onAsk('')}>
              Answer in the box below
            </Button>
          )
        )}
      </div>
    </div>
  );
};

export const ChatPanel: React.FC<{
  messages: ChatMessage[];
  onSend: (instruction: string) => Promise<unknown>;
  /** Attach a project report, README, internship letter or code file. */
  onAttach?: (file: File, message: string) => Promise<unknown>;
  sending: boolean;
  disabled?: boolean;
  disabledReason?: string;
}> = ({ messages, onSend, onAttach, sending, disabled, disabledReason }) => {
  const fileInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, sending]);

  const attachFile = async (file: File) => {
    if (!onAttach || sending || disabled) return;
    const message = text.trim();
    setPending(`📎 ${file.name}${message ? ` — ${message}` : ''}`);
    setText('');
    try {
      await onAttach(file, message);
    } catch {
      setText(message);
    } finally {
      setPending(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const submit = async (value = text) => {
    const instruction = value.trim();
    if (!instruction || sending || disabled) return;
    setPending(instruction);
    setText('');
    try {
      await onSend(instruction);
    } catch {
      setText(instruction); // keep the instruction so the user can retry
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scroller} className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3" aria-live="polite">
        {messages.map((m) => (
          <Message key={m.id} m={m} onAsk={() => input.current?.focus()} latest={m.id === lastAssistantId} onReply={disabled ? undefined : (t) => submit(t)} busy={sending} />
        ))}
        {pending && (
          <div className="flex gap-2 flex-row-reverse opacity-70">
            <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 bg-primary text-primary-foreground">
              <User className="w-3.5 h-3.5" />
            </div>
            <div className="max-w-[88%] rounded-2xl rounded-tr-sm px-3 py-2 text-sm bg-primary text-primary-foreground">{pending}</div>
          </div>
        )}
        {sending && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="w-4 h-4 animate-spin" /> Updating your resume…
          </div>
        )}
      </div>
      <div className="border-t p-3 space-y-2">
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin" aria-label="Suggested commands">
          {SUGGESTED_COMMANDS.map((c) => (
            <button key={c} type="button" disabled={sending || disabled} onClick={() => submit(c)} className="shrink-0 rounded-full border bg-background px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-50">
              {c.replace(/\.$/, '')}
            </button>
          ))}
        </div>
        {disabled && disabledReason && <div className="text-xs text-muted-foreground">{disabledReason}</div>}
        <div className="flex items-end gap-2">
          {onAttach && (
            <>
              <input
                ref={fileInput}
                type="file"
                className="hidden"
                accept=".pdf,.docx,.txt,.md,.markdown,.py,.js,.jsx,.ts,.tsx,.java,.ipynb,.html,.css,.json,.sql,.c,.cpp,.cs,.go,.kt,.rb,.php,.r,.dart"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) attachFile(f);
                }}
              />
              <Button type="button" variant="outline" size="icon" className="shrink-0" disabled={sending || disabled} onClick={() => fileInput.current?.click()} aria-label="Attach a project or internship file" title="Attach a project report, README, internship letter or code file — I will add it to the right section">
                <Paperclip className="w-4 h-4" />
              </Button>
            </>
          )}
          <Textarea
            ref={input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={2}
            maxLength={30000}
            placeholder="Ask anything: analyse, improve, rewrite, or paste a job description to tailor your resume…"
            aria-label="Editing instruction"
            className="min-h-[60px] max-h-40 resize-none text-sm"
            disabled={disabled}
          />
          <Button onClick={() => submit()} disabled={!text.trim() || sending || disabled} className="shrink-0" aria-label="Apply changes">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            <span className="ml-1.5 hidden sm:inline">Apply</span>
          </Button>
        </div>
      </div>
    </div>
  );
};
