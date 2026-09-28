import React, { useState } from 'react';
import { Check, Copy, Laptop } from 'lucide-react';
import type { RunnerInfo } from '../../../shared/careerTypes';
import { Button } from '@/components/ui/button';
import { fmtDate } from '@/components/career/bits';
import { cn } from '@/lib/utils';

/**
 * Hosted app (Vercel): browser work — applying, login-only job pages and the
 * job agent — runs on the user's own computer via `npm run runner`. Shows
 * whether that runner is online and how to set it up.
 */
export const RunnerBanner: React.FC<{ info: RunnerInfo | undefined; className?: string }> = ({ info, className }) => {
  const [copied, setCopied] = useState(false);
  if (!info || info.mode !== 'runner') return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(info.ownerId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the id is shown to copy by hand */
    }
  };
  return (
    <section className={cn('rounded-xl border p-4 space-y-2', info.online ? 'border-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/30' : 'border-amber-300 bg-amber-50/60 dark:bg-amber-950/30', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Laptop className={cn('w-5 h-5', info.online ? 'text-emerald-600' : 'text-amber-600')} />
        <h2 className="font-semibold flex-1">
          {info.online ? `Runner online${info.host ? ` on ${info.host}` : ''}` : 'Runner offline'}
        </h2>
        <span className="text-xs text-muted-foreground">
          {info.lastSeen ? `last seen ${fmtDate(info.lastSeen, true)}` : 'never seen'}
          {info.queued ? ` · ${info.queued} waiting` : ''}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        This hosted app has no browser. Applying, reading login-only job pages and the Auto Job Agent run on your own computer with your logged-in Chrome. Everything you queue here waits until the runner picks it up.
      </p>
      {!info.online && (
        <ol className="text-sm list-decimal pl-5 space-y-1">
          <li>
            On your computer, in the project folder, put the same <code>FIREBASE_*</code> and <code>DATABASE_URL=firestore</code> values as on Vercel into <code>.env</code>, plus{' '}
            <code className="break-all">RUNNER_OWNERS={info.ownerId}</code>
            <Button type="button" size="sm" variant="ghost" className="h-6 px-1.5 ml-1" onClick={copy} aria-label="Copy your user id">
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            </Button>
          </li>
          <li>
            Run <code>npm run runner</code>, then log in to job sites once at <code>http://localhost:8790</code> → Settings → Automation browser.
          </li>
        </ol>
      )}
    </section>
  );
};
