import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3, Briefcase, Check, CheckCircle2, Circle, CloudOff, FileText, FolderOpen, History, LayoutTemplate, ListOrdered, Loader2, Lock, MessageSquare, Pencil, Redo2, Sparkles, Undo2, Wrench, X,
} from 'lucide-react';
import type { SessionView } from '../../shared/apiTypes';
import type { ResumeData } from '../../shared/resumeTypes';
import { improvementPlan } from '../../shared/improve';
import { changedTexts } from '../../shared/diff';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ThemeToggle } from '@/components/ThemeToggle';
import { UserMenu } from '@/components/auth/UserMenu';
import { ScaledResume } from '@/components/resume/ResumeDocument';
import { AtsPanel, ScoreRing } from '@/components/builder/AtsPanel';
import { ChatPanel } from '@/components/builder/ChatPanel';
import { JobDescriptionPanel } from '@/components/builder/JobDescriptionPanel';
import { VersionsPanel } from '@/components/builder/VersionsPanel';
import { SectionsPanel, TemplatePanel } from '@/components/builder/DesignPanels';
import { SourcePanel } from '@/components/builder/SourcePanel';
import { ManualEditor } from '@/components/builder/ManualEditor';
import { FinalReviewDialog } from '@/components/builder/FinalReviewDialog';
import { useResumeSession, useSaving, useSessionMutation } from '@/hooks/useResumeSession';
import { ApiError, api } from '@/lib/api';
import { sessionStore } from '@/lib/sessions';
import { cn } from '@/lib/utils';

type Tool = 'source' | 'job' | 'sections' | 'ats' | 'versions' | 'template';
const TOOLS: Array<[Tool, string, React.ComponentType<{ className?: string }>]> = [
  ['job', 'Job', Briefcase],
  ['ats', 'ATS', BarChart3],
  ['versions', 'Versions', History],
  ['template', 'Template', LayoutTemplate],
  ['sections', 'Sections', ListOrdered],
  ['source', 'Source', FileText],
];

export const BuilderWorkspace: React.FC = () => {
  const { sessionId = '' } = useParams();
  const navigate = useNavigate();
  const hasToken = !!sessionStore.token(sessionId);
  const { data: session, error, isLoading } = useResumeSession(hasToken ? sessionId : undefined);

  useEffect(() => {
    if (session) sessionStore.setLast(session.id);
  }, [session]);

  if (!hasToken || (error instanceof ApiError && [401, 404].includes(error.status))) {
    return (
      <CenteredMessage title="Resume session not available" action={<Button onClick={() => navigate('/builder')}>Start a new resume</Button>}>
        {error instanceof ApiError && error.status === 404 ? 'This session has expired or was deleted.' : 'This browser does not have access to that resume session. Sessions are private to the browser that created them.'}
      </CenteredMessage>
    );
  }
  if (isLoading || !session) {
    return error ? (
      <CenteredMessage title="Could not load your resume" action={<Button onClick={() => window.location.reload()}>Retry</Button>}>
        {error instanceof Error ? error.message : 'Please try again.'}
      </CenteredMessage>
    ) : (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-5 h-5 mr-2 animate-spin" /> Restoring your resume session…
      </div>
    );
  }
  return <Workspace session={session} />;
};

const CenteredMessage: React.FC<{ title: string; children: React.ReactNode; action?: React.ReactNode }> = ({ title, children, action }) => (
  <div className="min-h-screen flex items-center justify-center p-6">
    <div className="max-w-md text-center space-y-3">
      <CloudOff className="w-10 h-10 mx-auto text-muted-foreground" />
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">{children}</p>
      <div className="flex justify-center gap-2">
        {action}
        <Button variant="outline" asChild>
          <Link to="/resumes">My resumes</Link>
        </Button>
      </div>
    </div>
  </div>
);

const Workspace: React.FC<{ session: SessionView }> = ({ session }) => {
  const id = session.id;
  const saving = useSaving(id);
  const finalized = session.status === 'finalized';
  const generated = session.originalLocked;
  const [tool, setTool] = useState<Tool>(() => (session.jdAnalysis ? 'ats' : 'job'));
  const [toolsOpen, setToolsOpen] = useState(false);
  const [mobileView, setMobileView] = useState<'resume' | 'chat'>('resume');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [editing, setEditing] = useState<null | 'current' | 'original'>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [pageCount, setPageCount] = useState(1);
  const [lastError, setLastError] = useState<string | null>(null);

  const edit = useSessionMutation(id, (instruction: string) => api.edit(id, instruction), { silent: true });
  const attach = useSessionMutation(id, (a: { file: File; message: string }) => api.attach(id, a.file, a.message), { silent: true });
  const setJd = useSessionMutation(id, (jd: string) => api.setJobDescription(id, jd));
  const setJdUrl = useSessionMutation(id, (url: string) => api.setJobDescriptionFromUrl(id, url), { successMessage: 'Job description imported from the link' });
  const patchJd = useSessionMutation(id, (patch: Parameters<typeof api.updateJdAnalysis>[1]) => api.updateJdAnalysis(id, patch));
  const generate = useSessionMutation(id, (_: void) => api.generate(id), { successMessage: 'Tailored resume generated' });
  const design = useSessionMutation(id, (patch: Parameters<typeof api.design>[1]) => api.design(id, patch));
  const undo = useSessionMutation(id, (_: void) => api.undo(id));
  const redo = useSessionMutation(id, (_: void) => api.redo(id));
  const restore = useSessionMutation(id, (versionId: string) => api.restore(id, versionId), { successMessage: 'Version restored' });
  const recalc = useSessionMutation(id, (_: void) => api.recalculate(id));
  const saveCurrent = useSessionMutation(id, (r: ResumeData) => api.saveCurrent(id, r, 'Manual edit'), { successMessage: 'Changes saved as a new version' });
  const correct = useSessionMutation(id, (input: { text?: string; resume?: ResumeData }) => api.correctOriginal(id, input), { successMessage: 'Original resume updated' });
  const finish = useSessionMutation(id, (_: void) => api.finish(id), { successMessage: 'Resume finalized' });
  const reopen = useSessionMutation(id, (_: void) => api.reopen(id), { successMessage: 'Reopened for editing' });
  const rename = useSessionMutation(id, (title: string) => api.rename(id, title));

  const preview = useQuery({ queryKey: ['version', id, previewId], queryFn: () => api.version(id, previewId!), enabled: !!previewId, staleTime: Infinity });
  const shownResume = previewId && preview.data ? preview.data.resume : session.current;
  // While previewing, highlight what that version changed compared with its parent (view only).
  const parentId = previewId && preview.data ? preview.data.parentId : null;
  const parent = useQuery({ queryKey: ['version', id, parentId], queryFn: () => api.version(id, parentId!), enabled: !!parentId, staleTime: Infinity });
  const [showChanges, setShowChanges] = useState(true);
  const changed = useMemo(
    () => (previewId && showChanges && preview.data && parent.data ? changedTexts(parent.data.resume, preview.data.resume) : undefined),
    [previewId, showChanges, preview.data, parent.data],
  );
  const busy = saving;

  const sendInstruction = async (instruction: string) => {
    setLastError(null);
    setPreviewId(null);
    try {
      await edit.mutateAsync(instruction);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : 'The edit failed. Your resume was not changed.');
      throw e;
    }
  };

  const sendAttachment = async (file: File, message: string) => {
    setLastError(null);
    setPreviewId(null);
    try {
      await attach.mutateAsync({ file, message });
    } catch (e) {
      setLastError(e instanceof Error ? e.message : 'The file could not be added. Your resume was not changed.');
      throw e;
    }
  };

  const plan = useMemo(() => {
    try {
      return improvementPlan(session.current, session.jdAnalysis, session.ats, { weights: session.weights, original: session.original, pages: pageCount });
    } catch {
      return null;
    }
  }, [session.current, session.jdAnalysis, session.ats, session.weights, session.original, pageCount]);
  const matched = useMemo(() => (session.ats ? session.ats.keywords.filter((k) => k.status === 'matched').map((k) => k.keyword) : []), [session.ats]);
  const [highlight, setHighlight] = useState(false);

  const toolPanel = (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-1" role="tablist" aria-label="Resume tools">
        {TOOLS.map(([key, label, Icon]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tool === key}
            onClick={() => setTool(key)}
            className={cn('flex flex-col items-center gap-0.5 rounded-lg px-1 py-2 text-[11px] transition', tool === key ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-muted')}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tool === 'job' && (
          <JobDescriptionPanel
            jobDescription={session.jobDescription}
            analysis={session.jdAnalysis}
            onAnalyze={(jd) => setJd.mutateAsync(jd)}
            onImportUrl={(url) => setJdUrl.mutateAsync(url)}
            analyzing={setJd.isPending || setJdUrl.isPending}
            onUpdateAnalysis={(p) => patchJd.mutate(p)}
            onGenerate={() => generate.mutate()}
            generating={generate.isPending}
            generated={generated}
            readOnly={finalized}
          />
        )}
        {tool === 'ats' && <AtsPanel ats={session.ats} plan={plan} previousScore={session.previousScore} onRecalculate={() => recalc.mutate()} recalculating={recalc.isPending} onAsk={finalized ? undefined : (t) => sendInstruction(t).catch(() => undefined)} busy={busy} />}
        {tool === 'versions' && (
          <VersionsPanel
            sessionId={id}
            versions={session.versions}
            currentId={session.currentVersion.id}
            previewId={previewId}
            canUndo={session.canUndo}
            canRedo={session.canRedo}
            onPreview={setPreviewId}
            onRestore={(v) => {
              setPreviewId(null);
              restore.mutate(v);
            }}
            onUndo={() => undo.mutate()}
            onRedo={() => redo.mutate()}
            busy={busy}
            readOnly={finalized}
          />
        )}
        {tool === 'template' && <TemplatePanel resume={session.current} onChange={(p) => design.mutate(p)} busy={busy} readOnly={finalized} pageCount={pageCount} />}
        {tool === 'sections' && (
          <SectionsPanel
            resume={session.current}
            onChange={(p) => design.mutate(p)}
            onHeadline={(jobTitle) => saveCurrent.mutate({ ...session.current, personalInfo: { ...session.current.personalInfo, jobTitle } })}
            busy={busy}
            readOnly={finalized}
          />
        )}
        {tool === 'source' && <SourcePanel session={session} onReparse={(text) => correct.mutateAsync({ text })} reparsing={correct.isPending} onEditOriginal={() => setEditing('original')} />}
      </div>
    </div>
  );

  const chat = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <MessageSquare className="w-4 h-4" />
        <span className="text-sm font-semibold">AI editor</span>
        {!session.ai.available && <span className="ml-auto rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-900">Offline mode</span>}
      </div>
      {lastError && (
        <div className="mx-3 mt-2 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-900 dark:bg-red-950/40 dark:text-red-200 dark:border-red-900" role="alert">
          <span className="flex-1">{lastError}</span>
          <button onClick={() => setLastError(null)} aria-label="Dismiss error">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      <div className="flex-1 min-h-0">
        <ChatPanel
          messages={session.messages}
          onSend={sendInstruction}
          onAttach={sendAttachment}
          sending={edit.isPending || attach.isPending}
          disabled={finalized}
          disabledReason={finalized ? 'This resume is finalized. Reopen it to keep editing.' : undefined}
        />
      </div>
    </div>
  );

  return (
    <div className="flex h-[100dvh] flex-col bg-muted/30">
      {/* Header */}
      <header className="flex items-center gap-2 border-b bg-background px-3 py-2 md:px-4" style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}>
        <Link to="/" className="flex items-center gap-2 shrink-0" aria-label="Resume Creator AI home">
          <div className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center">
            <Sparkles className="w-4 h-4" />
          </div>
          <span className="hidden lg:inline font-semibold">Resume Creator AI</span>
        </Link>
        <TitleEditor title={session.title} onSave={(t) => rename.mutate(t)} />
        <span className={cn('hidden sm:inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', finalized ? 'bg-emerald-100 text-emerald-800' : 'bg-sky-100 text-sky-800')}>
          {finalized ? <Lock className="w-3 h-3" /> : <Pencil className="w-3 h-3" />}
          {finalized ? 'Finalized' : 'Draft'}
        </span>
        <span className="hidden md:inline-flex items-center gap-1 text-xs text-muted-foreground" aria-live="polite">
          {saving ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" /> Saving…
            </>
          ) : (
            <>
              <Check className="w-3 h-3" /> Saved · v{session.currentVersion.number}
            </>
          )}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {session.ats && (
            <button className="hidden sm:flex items-center gap-1.5 rounded-lg px-2 py-1 hover:bg-muted" onClick={() => setTool('ats')} title="ATS score details">
              <ScoreRing score={session.ats.total} size={32} stroke={4} />
            </button>
          )}
          <Button size="icon" variant="ghost" onClick={() => undo.mutate()} disabled={!session.canUndo || busy || finalized} aria-label="Undo">
            <Undo2 className="w-4 h-4" />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => redo.mutate()} disabled={!session.canRedo || busy || finalized} aria-label="Redo">
            <Redo2 className="w-4 h-4" />
          </Button>
          <Button size="icon" variant="ghost" asChild className="hidden sm:inline-flex">
            <Link to="/resumes" aria-label="My resumes">
              <FolderOpen className="w-4 h-4" />
            </Link>
          </Button>
          <ThemeToggle compact />
          <UserMenu />
          <Button size="sm" variant="outline" className="xl:hidden" onClick={() => setToolsOpen(true)}>
            <Wrench className="w-4 h-4 sm:mr-1.5" />
            <span className="hidden sm:inline">Tools</span>
          </Button>
          {finalized ? (
            <Button size="sm" onClick={() => reopen.mutate()} disabled={reopen.isPending}>
              Reopen
            </Button>
          ) : (
            <Button size="sm" onClick={() => setReviewOpen(true)} disabled={busy}>
              <CheckCircle2 className="w-4 h-4 sm:mr-1.5" />
              <span className="hidden sm:inline">Finish Resume</span>
            </Button>
          )}
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Left sidebar (desktop) */}
        <aside className="hidden xl:block w-[340px] shrink-0 overflow-y-auto border-r bg-background p-3">{toolPanel}</aside>

        {/* Main preview */}
        <main className={cn('flex-1 min-w-0 overflow-y-auto', mobileView !== 'resume' && 'hidden lg:block')}>
          <div className="mx-auto max-w-[900px] p-3 md:p-5 space-y-3">
            {!generated && (
              <SetupSteps
                session={session}
                onGo={(t) => {
                  setTool(t);
                  if (window.innerWidth < 1280) setToolsOpen(true);
                }}
                onGenerate={() => generate.mutate()}
                generating={generate.isPending}
              />
            )}
            {finalized && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-900">
                <Lock className="w-4 h-4" /> This resume is finalized. Your versions and original resume are kept.
                <div className="ml-auto flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setReviewOpen(true)}>Download</Button>
                  <Button size="sm" onClick={() => reopen.mutate()}>Reopen for edits</Button>
                </div>
              </div>
            )}
            {previewId && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 p-2.5 text-sm text-sky-900 dark:bg-sky-950/40 dark:text-sky-200 dark:border-sky-900">
                {preview.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Previewing version {preview.data?.number ?? '…'} {preview.data ? `(“${preview.data.label}”)` : ''} {previewId === session.currentVersion.id ? '— the current version.' : '— not the current version.'}
                {preview.data?.parentId && (
                  <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
                    <input type="checkbox" checked={showChanges} onChange={(e) => setShowChanges(e.target.checked)} />
                    <span className="rounded-sm px-1" style={{ background: '#fef08a', color: '#422006' }}>Highlight changes</span>
                    {changed ? 'vs the previous version · view only, not saved or exported' : ''}
                  </label>
                )}
                <div className="ml-auto flex gap-2">
                  {!finalized && previewId !== session.currentVersion.id && (
                    <Button size="sm" onClick={() => { restore.mutate(previewId); setPreviewId(null); }} disabled={busy}>
                      Restore this version
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => setPreviewId(null)}>
                    Back to current
                  </Button>
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>
                v{previewId ? preview.data?.number : session.currentVersion.number} · {pageCount} page{pageCount === 1 ? '' : 's'}
              </span>
              {matched.length > 0 && (
                <label className="inline-flex items-center gap-1 cursor-pointer">
                  <input type="checkbox" checked={highlight} onChange={(e) => setHighlight(e.target.checked)} /> Highlight matched keywords
                </label>
              )}
              <div className="ml-auto flex gap-1.5">
                {!finalized && !previewId && (
                  <Button size="sm" variant="outline" onClick={() => setEditing('current')} disabled={busy}>
                    <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit content
                  </Button>
                )}
              </div>
            </div>
            <div className={cn('rounded-xl bg-background p-2 shadow-sm transition-opacity', (edit.isPending || generate.isPending) && 'opacity-60')} aria-busy={edit.isPending || generate.isPending}>
              <ScaledResume resume={shownResume} highlight={highlight ? matched : []} changed={changed} onPageCount={previewId ? undefined : setPageCount} />
            </div>
          </div>
        </main>

        {/* Chat (desktop/tablet) */}
        <aside className={cn('w-full lg:w-[380px] shrink-0 border-l bg-background', mobileView === 'chat' ? 'block' : 'hidden lg:block')}>{chat}</aside>
      </div>

      {/* Mobile bottom navigation */}
      <nav className="lg:hidden grid grid-cols-3 border-t bg-background" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }} aria-label="Workspace views">
        {([['resume', 'Resume', FileText], ['chat', 'AI chat', MessageSquare]] as const).map(([key, label, Icon]) => (
          <button key={key} onClick={() => setMobileView(key)} className={cn('flex flex-col items-center gap-0.5 py-2 text-[11px]', mobileView === key ? 'text-primary font-medium' : 'text-muted-foreground')}>
            <Icon className="w-5 h-5" />
            {label}
          </button>
        ))}
        <button onClick={() => setToolsOpen(true)} className="flex flex-col items-center gap-0.5 py-2 text-[11px] text-muted-foreground">
          <Wrench className="w-5 h-5" />
          Tools
        </button>
      </nav>

      <Sheet open={toolsOpen} onOpenChange={setToolsOpen}>
        <SheetContent side="left" className="w-[92vw] max-w-[380px] overflow-y-auto p-3 xl:hidden">
          <SheetHeader className="mb-2">
            <SheetTitle>Resume tools</SheetTitle>
          </SheetHeader>
          {toolPanel}
        </SheetContent>
      </Sheet>

      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent side="right" className="w-full sm:max-w-2xl p-0">
          {editing && (
            <ManualEditor
              title={editing === 'original' ? 'Correct the extracted resume' : 'Edit resume content'}
              resume={editing === 'original' ? session.original : session.current}
              saving={saveCurrent.isPending || correct.isPending}
              onClose={() => setEditing(null)}
              onSave={async (r) => {
                if (editing === 'original') await correct.mutateAsync({ resume: r });
                else await saveCurrent.mutateAsync(r);
                setEditing(null);
              }}
            />
          )}
        </SheetContent>
      </Sheet>

      <FinalReviewDialog
        sessionId={id}
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        finalized={finalized}
        finishing={finish.isPending}
        onFinish={async () => {
          await finish.mutateAsync();
          setReviewOpen(false);
        }}
      />
    </div>
  );
};

const TitleEditor: React.FC<{ title: string; onSave: (t: string) => void }> = ({ title, onSave }) => {
  const [value, setValue] = useState(title);
  const [editing, setEditing] = useState(false);
  useEffect(() => setValue(title), [title]);
  if (!editing)
    return (
      <button className="min-w-0 truncate text-sm font-medium hover:underline max-w-[40vw] md:max-w-xs" onClick={() => setEditing(true)} title="Rename resume">
        {title}
      </button>
    );
  return (
    <form
      className="min-w-0"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim() && value !== title) onSave(value.trim());
        setEditing(false);
      }}
    >
      <Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} onBlur={() => setEditing(false)} className="h-8 w-48 md:w-64" maxLength={120} aria-label="Resume name" />
    </form>
  );
};

const SetupSteps: React.FC<{ session: SessionView; onGo: (t: Tool) => void; onGenerate: () => void; generating: boolean }> = ({ session, onGo, onGenerate, generating }) => {
  const steps = [
    { done: true, label: 'Resume stored in this session', action: null },
    { done: true, label: 'Review the extracted content', action: <Button size="sm" variant="ghost" onClick={() => onGo('source')}>Review</Button> },
    { done: !!session.jdAnalysis, label: 'Paste the job description', action: <Button size="sm" variant={session.jdAnalysis ? 'ghost' : 'default'} onClick={() => onGo('job')}>{session.jdAnalysis ? 'Edit' : 'Add JD'}</Button> },
    {
      done: false,
      label: 'Generate your ATS-tailored resume',
      action: (
        <Button size="sm" onClick={onGenerate} disabled={!session.jdAnalysis || generating}>
          {generating ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1.5" />} Generate
        </Button>
      ),
    },
  ];
  return (
    <div className="rounded-xl border bg-background p-4">
      <h2 className="font-semibold mb-1">Set up your tailored resume</h2>
      <p className="text-xs text-muted-foreground mb-3">Your resume is saved — you will never need to upload it again for this session.</p>
      <ol className="space-y-2">
        {steps.map((s, i) => (
          <li key={i} className="flex items-center gap-2 text-sm">
            {s.done ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <Circle className="w-4 h-4 text-muted-foreground shrink-0" />}
            <span className={cn('flex-1', s.done && 'text-muted-foreground')}>{s.label}</span>
            {s.action}
          </li>
        ))}
      </ol>
      {generating && <p className="mt-3 text-xs text-muted-foreground">Tailoring your resume using only facts from your original resume… this can take up to a minute.</p>}
    </div>
  );
};
