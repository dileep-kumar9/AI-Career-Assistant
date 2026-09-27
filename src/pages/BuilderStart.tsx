import React, { useCallback, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, ClipboardPaste, FileUp, History, Loader2, ShieldCheck, Sparkles, UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ThemeToggle } from '@/components/ThemeToggle';
import { UserMenu } from '@/components/auth/UserMenu';
import { api } from '@/lib/api';
import { sessionStore } from '@/lib/sessions';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';

const MAX_MB = 5;

export const BuilderStart: React.FC = () => {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'upload' | 'paste'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const last = sessionStore.last();

  const pick = useCallback((f: File | undefined | null) => {
    setError(null);
    if (!f) return;
    if (!/\.(pdf|docx)$/i.test(f.name)) return setError('Please choose a PDF or DOCX file.');
    if (f.size > MAX_MB * 1024 * 1024) return setError(`The file is larger than ${MAX_MB} MB.`);
    setFile(f);
  }, []);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = mode === 'upload' && file ? await api.upload(file) : await api.paste(text);
      for (const w of r.extraction.warnings) toast({ title: 'Please review the extraction', description: w });
      navigate(`/builder/${r.session.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const ready = mode === 'upload' ? !!file : text.trim().length >= 80;

  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-50 to-background dark:from-slate-900 dark:to-background">
      <header className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-4">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <span className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center">
            <Sparkles className="w-4 h-4" />
          </span>
          AI Career Assistant
        </Link>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/resumes">
              <History className="w-4 h-4 mr-1.5" /> My resumes
            </Link>
          </Button>
          <ThemeToggle compact />
          <UserMenu />
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-16">
        {last && (
          <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border bg-background p-4 shadow-sm">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">Continue where you left off</div>
              <div className="truncate text-xs text-muted-foreground">
                {last.title} · {last.status === 'finalized' ? 'Finalized' : 'Draft'} · updated {new Date(last.updatedAt).toLocaleString()}
              </div>
            </div>
            <Button size="sm" onClick={() => navigate(`/builder/${last.id}`)}>
              Open <ArrowRight className="w-4 h-4 ml-1.5" />
            </Button>
          </div>
        )}

        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Start with your current resume</h1>
        <p className="mt-2 text-muted-foreground">Upload it once. Every edit after this works on the stored copy — you will not be asked to upload it again.</p>

        <div className="mt-6 rounded-2xl border bg-background p-4 md:p-6 shadow-sm">
          <div className="mb-4 inline-grid grid-cols-2 gap-1 rounded-lg bg-muted p-1" role="tablist">
            {(['upload', 'paste'] as const).map((m) => (
              <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={cn('flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm', mode === m ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground')}>
                {m === 'upload' ? <FileUp className="w-4 h-4" /> : <ClipboardPaste className="w-4 h-4" />}
                {m === 'upload' ? 'Upload file' : 'Paste text'}
              </button>
            ))}
          </div>

          {mode === 'upload' ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                pick(e.dataTransfer.files?.[0]);
              }}
              onClick={() => input.current?.click()}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
              role="button"
              tabIndex={0}
              aria-label="Choose a resume file"
              className={cn('flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-12 text-center transition', dragging ? 'border-primary bg-primary/5' : 'hover:border-primary/60 hover:bg-muted/40')}
            >
              <UploadCloud className="w-10 h-10 text-primary mb-3" />
              {file ? (
                <>
                  <div className="font-medium">{file.name}</div>
                  <div className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB · click to choose another file</div>
                </>
              ) : (
                <>
                  <div className="font-medium">Drop your resume here or click to browse</div>
                  <div className="text-xs text-muted-foreground mt-1">PDF or DOCX · up to {MAX_MB} MB · text-based (not scanned)</div>
                </>
              )}
              <input ref={input} type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
            </div>
          ) : (
            <div className="space-y-2">
              <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the full text of your resume…" className="min-h-[280px] text-sm" maxLength={60000} aria-label="Resume text" />
              <div className="text-xs text-muted-foreground">{text.trim().length < 80 ? 'Paste your complete resume (at least a few lines).' : `${text.trim().split(/\s+/).length} words`}</div>
            </div>
          )}

          {error && (
            <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-2.5 text-sm text-red-900 dark:bg-red-950/40 dark:text-red-200 dark:border-red-900" role="alert">
              {error}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button size="lg" onClick={submit} disabled={!ready || busy}>
              {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ArrowRight className="w-4 h-4 mr-2" />}
              {busy ? 'Extracting your resume…' : 'Continue'}
            </Button>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="w-4 h-4" /> Stored privately; only this browser holds the access key.
            </span>
          </div>
        </div>

        <ol className="mt-8 grid gap-3 sm:grid-cols-3 text-sm">
          {[
            ['1. Upload once', 'We extract your experience, skills, projects and education. You can correct anything.'],
            ['2. Add the job', 'Paste the job description. We pull out required skills and ATS keywords.'],
            ['3. Tailor & chat', 'Generate a tailored resume, then refine it by chatting — as many times as you like.'],
          ].map(([t, d]) => (
            <li key={t} className="rounded-xl border bg-background p-4">
              <div className="font-medium">{t}</div>
              <div className="text-muted-foreground text-xs mt-1">{d}</div>
            </li>
          ))}
        </ol>
      </main>
    </div>
  );
};
