import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe, Loader2, Power, ShieldCheck } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { errMsg } from '@/components/career/bits';
import { toast } from '@/hooks/use-toast';
import { career } from '@/lib/careerApi';

const SITES = [
  { id: 'linkedin' as const, label: 'LinkedIn', note: 'Needed for Easy Apply (off by default; against LinkedIn’s terms).' },
  { id: 'naukri' as const, label: 'Naukri', note: 'Needed for Naukri search and apply.' },
  { id: 'indeed' as const, label: 'Indeed', note: 'Needed for Indeed Apply.' },
  { id: 'google' as const, label: 'Google', note: 'Optional: “Sign in with Google” on some career sites.' },
];

export const Settings: React.FC = () => {
  const qc = useQueryClient();
  const { data: cfg } = useQuery({ queryKey: ['config'], queryFn: career.config });
  const { data: browser } = useQuery({ queryKey: ['browser'], queryFn: career.browserStatus, refetchInterval: 5000 });
  const { data: prompts } = useQuery({ queryKey: ['prompts'], queryFn: career.prompts });
  const open = useMutation({
    mutationFn: career.browserOpen,
    onSuccess: (s) => {
      qc.setQueryData(['browser'], s);
      toast({ title: 'Opened in the automation browser', description: 'Log in there once; the session is remembered in the app’s own Chrome profile.' });
    },
    onError: (e) => toast({ title: 'Could not open the browser', description: errMsg(e), variant: 'destructive' }),
  });
  const close = useMutation({ mutationFn: career.browserClose, onSuccess: (s) => qc.setQueryData(['browser'], s) });

  return (
    <AppShell title="Settings" subtitle="Automation browser, AI providers and how your data is handled">
      <div className="space-y-5">
        <section className="rounded-xl border bg-background p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Globe className="w-5 h-5 text-primary" />
            <h2 className="font-semibold flex-1">Automation browser</h2>
            <span className="text-xs text-muted-foreground">
              {browser?.open ? 'Open' : 'Closed'} · {browser?.channel}
            </span>
            {browser?.open && (
              <Button size="sm" variant="outline" onClick={() => close.mutate()}>
                <Power className="w-4 h-4 mr-1.5" /> Close
              </Button>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            A separate Chrome window with its own profile. Log in to job sites here once; the app uses these sessions to search and apply, and never sees or stores your passwords. CAPTCHAs and questions it cannot answer are left open in this window for you.
          </p>
          {browser?.error && <p className="text-sm text-destructive">{browser.error}</p>}
          <div className="grid gap-2 sm:grid-cols-2">
            {SITES.map((s) => (
              <div key={s.id} className="flex items-center gap-3 rounded-lg border p-3">
                <div className="flex-1">
                  <div className="text-sm font-medium">{s.label}</div>
                  <div className="text-xs text-muted-foreground">{s.note}</div>
                </div>
                <Button size="sm" variant="outline" disabled={open.isPending} onClick={() => open.mutate(s.id)}>
                  {open.isPending && open.variables === s.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Open to log in'}
                </Button>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border bg-background p-4 space-y-2">
          <h2 className="font-semibold">AI providers</h2>
          <p className="text-sm">
            {cfg?.ai.available ? (
              <>
                Active, tried in order with automatic fallback: <span className="font-medium">{cfg.ai.providers.join(' → ')}</span>
              </>
            ) : (
              'No AI key configured — every feature still works with clearly labelled rule-based fallbacks. Add GEMINI_API_KEY (free) or another key to .env.'
            )}
          </p>
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">Prompt library ({prompts?.prompts.length ?? 0} versioned prompts)</summary>
            <ul className="mt-2 divide-y rounded-lg border">
              {prompts?.prompts.map((p) => (
                <li key={p.id} className="flex gap-3 px-3 py-1.5">
                  <code className="text-xs">{p.id}@v{p.version}</code>
                  <span className="text-muted-foreground text-xs">{p.purpose}</span>
                </li>
              ))}
            </ul>
          </details>
        </section>

        <section className="rounded-xl border bg-background p-4 space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            <h2 className="font-semibold">Safety and your data</h2>
          </div>
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>{cfg?.localMode ? 'Single-user local mode: data is stored on this computer (no sign-in).' : 'Signed-in mode: your data is stored in your Firebase project under collections starting with “aca_”, separate from Resume Creator AI.'}</li>
            <li>Resumes are never given skills, employers, dates or numbers you did not provide; missing skills become learning suggestions instead.</li>
            <li>Job pages are treated as untrusted data; text on them that tries to instruct the AI is ignored and flagged.</li>
            <li>Submitting, switching the agent on, auto mode and every chat action need your confirmation. Daily limits and dry run keep the agent in check.</li>
            <li>The server only listens on this computer (127.0.0.1). Secrets stay in the local .env file.</li>
          </ul>
        </section>
      </div>
    </AppShell>
  );
};
