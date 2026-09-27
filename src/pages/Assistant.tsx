import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Loader2, MessageSquare, Send, ShieldCheck } from 'lucide-react';
import type { AssistantMessage, ProposedAction } from '../../shared/careerTypes';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { errMsg } from '@/components/career/bits';
import { toast } from '@/hooks/use-toast';
import { career } from '@/lib/careerApi';
import { cn } from '@/lib/utils';

const KEY = 'aca-assistant-chat';
const SUGGESTIONS = ['How many jobs did I apply to this week?', 'Which applications need my attention?', 'What skills should I learn next?', 'When is my next interview?', 'Compare my resume with my latest application'];

/** Minimal, safe Markdown: **bold**, `code`, "- " lists, paragraphs. Builds React nodes (no HTML injection). */
function Md({ text }: { text: string }) {
  const inline = (s: string, k: string) =>
    s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? <strong key={`${k}-${i}`}>{part.slice(2, -2)}</strong> : part.startsWith('`') && part.endsWith('`') ? <code key={`${k}-${i}`} className="rounded bg-muted px-1">{part.slice(1, -1)}</code> : <React.Fragment key={`${k}-${i}`}>{part}</React.Fragment>,
    );
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-2">
      {blocks.map((b, i) => {
        const lines = b.split('\n');
        if (lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l))) return <ul key={i} className="list-disc pl-5 space-y-0.5">{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*([-*]|\d+\.)\s+/, ''), `${i}-${j}`)}</li>)}</ul>;
        return <p key={i} className="whitespace-pre-wrap">{lines.map((l, j) => <React.Fragment key={j}>{j > 0 && <br />}{inline(l, `${i}-${j}`)}</React.Fragment>)}</p>;
      })}
    </div>
  );
}

export const Assistant: React.FC = () => {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<AssistantMessage[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(KEY) || '[]');
    } catch {
      return [];
    }
  });
  const [draft, setDraft] = useState('');
  const [done, setDone] = useState<Record<number, string>>({});
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(messages.slice(-40)));
    } catch {
      /* private mode */
    }
    end.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = useMutation({
    mutationFn: (text: string) => career.chat(text, messages.slice(-10).map((m) => ({ role: m.role, content: m.content }))),
    onMutate: (text) => setMessages((m) => [...m, { role: 'user', content: text, citations: [], action: null, method: 'ai', at: new Date().toISOString() }]),
    onSuccess: (reply) => setMessages((m) => [...m, reply]),
    onError: (e) => setMessages((m) => [...m, { role: 'assistant', content: `Sorry — ${errMsg(e)}`, citations: [], action: null, method: 'rule-based', at: new Date().toISOString() }]),
  });
  const run = useMutation({
    mutationFn: ({ action }: { action: ProposedAction; index: number }) => career.runAction(action),
    onSuccess: (res, { index }) => {
      setDone((d) => ({ ...d, [index]: res.message }));
      toast({ title: res.message });
      if (res.navigate) setTimeout(() => navigate(res.navigate!), 600);
    },
    onError: (e) => toast({ title: 'Could not do that', description: errMsg(e), variant: 'destructive' }),
  });
  const submit = (text: string) => {
    const t = text.trim();
    if (!t || send.isPending) return;
    setDraft('');
    send.mutate(t);
  };

  return (
    <AppShell
      title="Career Assistant"
      subtitle="Answers from your own records — resume, profile, applications, interviews, learning"
      actions={
        messages.length > 0 ? (
          <Button size="sm" variant="ghost" onClick={() => setMessages([])}>
            Clear
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col h-[calc(100vh-9rem)]">
        <div className="flex-1 overflow-y-auto space-y-3 pb-3">
          {!messages.length && (
            <div className="rounded-xl border border-dashed bg-background p-6 text-center">
              <MessageSquare className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
              <p className="font-medium">Ask about your job search, or tell me what to do</p>
              <p className="text-sm text-muted-foreground mb-3">e.g. “apply to https://…”, “pause the agent”, “I got an interview at Acme on Friday”.</p>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <Button key={s} size="sm" variant="outline" onClick={() => submit(s)}>
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div className={cn('max-w-[85%] rounded-2xl px-4 py-2.5 text-sm', m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-background border')}>
                {m.role === 'user' ? <p className="whitespace-pre-wrap">{m.content}</p> : <Md text={m.content} />}
                {m.role === 'assistant' && m.citations.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {m.citations.map((c) => (
                      <span key={c.id} className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground" title={c.source}>
                        {c.label}
                      </span>
                    ))}
                  </div>
                )}
                {m.role === 'assistant' && m.action && (
                  <div className="mt-2 rounded-lg border bg-muted/40 p-2 flex flex-wrap items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-primary" />
                    <span className="flex-1 text-xs">{done[i] || m.action.summary}</span>
                    {!done[i] && (
                      <Button size="sm" disabled={run.isPending} onClick={() => run.mutate({ action: m.action!, index: i })}>
                        Confirm
                      </Button>
                    )}
                  </div>
                )}
                {m.role === 'assistant' && m.method === 'rule-based' && <p className="mt-1 text-[10px] text-muted-foreground">rule-based answer</p>}
              </div>
            </div>
          ))}
          {send.isPending && (
            <div className="flex">
              <div className="rounded-2xl border bg-background px-4 py-2.5">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
            </div>
          )}
          <div ref={end} />
        </div>
        <form
          className="flex gap-2 border-t pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit(draft);
          }}
        >
          <Textarea
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit(draft);
              }
            }}
            placeholder="Ask anything about your applications, resume or skills…"
          />
          <Button type="submit" disabled={!draft.trim() || send.isPending} className="self-end">
            <Send className="w-4 h-4" />
          </Button>
        </form>
      </div>
    </AppShell>
  );
};
