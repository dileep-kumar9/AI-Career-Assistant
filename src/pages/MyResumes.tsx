import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckSquare, FilePlus2, FileText, Lock, Pencil, Sparkles, Square, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { ThemeToggle } from '@/components/ThemeToggle';
import { UserMenu } from '@/components/auth/UserMenu';
import { api } from '@/lib/api';
import { sessionStore, type StoredSession } from '@/lib/sessions';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';

export const MyResumes: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [list, setList] = useState<StoredSession[]>(() => (user ? [] : sessionStore.list()));
  const [loadingList, setLoadingList] = useState(!!user);

  // Signed in: the account's resumes (any device). Guest: resumes created in this browser.
  const reload = useCallback(async () => {
    if (!user) {
      await reload();
      return;
    }
    setLoadingList(true);
    try {
      for (const s of sessionStore.list()) await api.claim(s.id).catch(() => undefined);
      const { resumes } = await api.listMine();
      setList(resumes.map((r) => ({ id: r.id, token: sessionStore.token(r.id) || '', title: r.title, status: r.status, updatedAt: r.updatedAt, score: r.atsScore })));
    } catch (e) {
      toast({ title: 'Could not load your resumes', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setLoadingList(false);
    }
  }, [user]);
  useEffect(() => {
    reload();
  }, [reload]);
  // Resumes waiting for delete confirmation (one, or a multi-selection).
  const [confirm, setConfirm] = useState<StoredSession[] | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const exitSelect = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const remove = async (items: StoredSession[]) => {
    setDeleting(true);
    for (const s of items) {
      try {
        await api.remove(s.id);
      } catch {
        sessionStore.remove(s.id); // already gone on the server
      }
    }
    setDeleting(false);
    setList(sessionStore.list());
    exitSelect();
    toast({ title: items.length === 1 ? 'Resume deleted' : `${items.length} resumes deleted` });
  };

  const chosen = list.filter((s) => selected.has(s.id));

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="mx-auto flex max-w-4xl items-center gap-2 px-4 py-4">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <span className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center">
            <Sparkles className="w-4 h-4" />
          </span>
          Resume Creator AI
        </Link>
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle compact />
          <UserMenu />
          <Button size="sm" onClick={() => navigate('/builder?new=1')}>
            <FilePlus2 className="w-4 h-4 mr-1.5" /> New resume
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 pb-12">
        <div className="flex flex-wrap items-end gap-2 mb-5">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold mb-1">My resumes</h1>
            <p className="text-sm text-muted-foreground">{user ? `Saved to your account (${user.email}) — open them on any device.` : 'Sessions created in this browser.'} Open any of them to keep editing — no re-upload needed.</p>
          </div>
          {list.length > 0 &&
            (selecting ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">{selected.size} selected</span>
                <Button size="sm" variant="outline" onClick={() => setSelected(selected.size === list.length ? new Set() : new Set(list.map((s) => s.id)))}>
                  {selected.size === list.length ? 'Clear all' : 'Select all'}
                </Button>
                <Button size="sm" variant="destructive" disabled={!selected.size || deleting} onClick={() => setConfirm(chosen)}>
                  <Trash2 className="w-4 h-4 mr-1.5" /> Delete selected
                </Button>
                <Button size="sm" variant="ghost" onClick={exitSelect} aria-label="Cancel selection">
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setSelecting(true)}>
                <CheckSquare className="w-4 h-4 mr-1.5" /> Select to delete
              </Button>
            ))}
        </div>
        {loadingList && !list.length ? (
          <div className="text-sm text-muted-foreground">Loading your resumes…</div>
        ) : list.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-background p-10 text-center">
            <FileText className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground mb-3">No resumes yet.</p>
            <Button onClick={() => navigate('/builder?new=1')}>Build your first resume</Button>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {list.map((s) => {
              const isSel = selected.has(s.id);
              return (
                <li
                  key={s.id}
                  className={cn('rounded-xl border bg-background p-4 flex flex-col gap-3 transition', selecting && 'cursor-pointer hover:border-primary/60', isSel && 'border-destructive ring-2 ring-destructive/30')}
                  onClick={selecting ? () => toggle(s.id) : undefined}
                >
                  <div className="flex items-start gap-3">
                    {selecting ? (
                      <button type="button" role="checkbox" aria-checked={isSel} aria-label={`Select ${s.title}`} className="mt-0.5 shrink-0 text-primary" onClick={(e) => { e.stopPropagation(); toggle(s.id); }}>
                        {isSel ? <CheckSquare className="w-5 h-5 text-destructive" /> : <Square className="w-5 h-5 text-muted-foreground" />}
                      </button>
                    ) : (
                      <FileText className="w-5 h-5 mt-0.5 text-primary shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{s.title}</div>
                      <div className="text-xs text-muted-foreground">Updated {new Date(s.updatedAt).toLocaleString()}</div>
                    </div>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${s.status === 'finalized' ? 'bg-emerald-100 text-emerald-800' : 'bg-sky-100 text-sky-800'}`}>
                      {s.status === 'finalized' ? <Lock className="w-3 h-3" /> : <Pencil className="w-3 h-3" />}
                      {s.status === 'finalized' ? 'Finalized' : 'Draft'}
                    </span>
                  </div>
                  {s.score !== undefined && s.score !== null && <div className="text-xs text-muted-foreground">Last ATS score: <span className="font-semibold text-foreground">{s.score}/100</span></div>}
                  {!selecting && (
                    <div className="flex gap-2 mt-auto">
                      <Button size="sm" className="flex-1" onClick={() => navigate(`/builder/${s.id}`)}>
                        Open
                      </Button>
                      <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" aria-label={`Delete ${s.title}`} onClick={() => setConfirm([s])}>
                        <Trash2 className="w-4 h-4 mr-1" /> Delete
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </main>
      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm && confirm.length > 1 ? `Delete ${confirm.length} resumes?` : 'Delete this resume?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm && confirm.length > 1 ? (
                <>
                  This permanently deletes these resumes, their original uploads, every version and the chat history from the server:
                  <span className="mt-2 block max-h-40 overflow-auto text-foreground">
                    {confirm.map((s) => (
                      <span key={s.id} className="block truncate">• {s.title}</span>
                    ))}
                  </span>
                </>
              ) : (
                <>This permanently deletes “{confirm?.[0]?.title}”, its original upload, every version and the chat history from the server.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => confirm && remove(confirm)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
