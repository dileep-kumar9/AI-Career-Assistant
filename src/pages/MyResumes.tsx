import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, CheckSquare, ExternalLink, FilePlus2, FileText, Lock, Pencil, Square, Trash2, X } from 'lucide-react';
import type { ResumeListItem } from '../../shared/apiTypes';
import { STAGE_LABELS } from '../../shared/careerTypes';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { AppShell } from '@/components/layout/AppShell';
import { Empty, StageBadge, fmtDate } from '@/components/career/bits';
import { api } from '@/lib/api';
import { career } from '@/lib/careerApi';
import { sessionStore } from '@/lib/sessions';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

/**
 * My resumes, in two separate lists:
 *  - My resumes: the ones you created in the Resume Builder;
 *  - Automation resumes: copies tailored by Single Job Apply / the job agent,
 *    named "<Role> – <Company>", with the application's status.
 */
export const MyResumes: React.FC = () => {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'automation' ? 'automation' : 'manual';
  const { data: list = [], isLoading, error } = useQuery({ queryKey: ['resumes', tab], queryFn: () => api.listMine(tab).then((r) => r.resumes) });
  const { data: apps = [] } = useQuery({ queryKey: ['applications'], queryFn: career.applications, enabled: tab === 'automation' });
  const [confirm, setConfirm] = useState<ResumeListItem[] | null>(null);
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
  const remove = async (items: ResumeListItem[]) => {
    setDeleting(true);
    for (const s of items) {
      try {
        await api.remove(s.id);
      } catch {
        sessionStore.remove(s.id);
      }
    }
    setDeleting(false);
    exitSelect();
    qc.invalidateQueries({ queryKey: ['resumes'] });
    toast({ title: items.length === 1 ? 'Resume deleted' : `${items.length} resumes deleted` });
  };
  const chosen = list.filter((s) => selected.has(s.id));
  const appFor = (r: ResumeListItem) => (r.job?.applicationId ? apps.find((a) => a.id === r.job!.applicationId) : undefined);

  return (
    <AppShell
      title="My resumes"
      subtitle="Your own resumes and the ones tailored by the automation, kept apart"
      actions={
        <Button size="sm" onClick={() => navigate('/builder?new=1')}>
          <FilePlus2 className="w-4 h-4 mr-1.5" /> New resume
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Tabs value={tab} onValueChange={(v) => (exitSelect(), setParams(v === 'automation' ? { tab: 'automation' } : {}))}>
          <TabsList>
            <TabsTrigger value="manual">
              <FileText className="w-4 h-4 mr-1.5" /> My resumes
            </TabsTrigger>
            <TabsTrigger value="automation">
              <Bot className="w-4 h-4 mr-1.5" /> Automation resumes
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="ml-auto">
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
      </div>
      {tab === 'automation' && <p className="mb-3 text-sm text-muted-foreground">Created by Single Job Apply and the job agent — one per job, named “Role – Company”. Each is a copy; your own resumes are never changed.</p>}

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading your resumes…</div>
      ) : error ? (
        <div className="text-sm text-destructive">{error instanceof Error ? error.message : 'Could not load your resumes.'}</div>
      ) : list.length === 0 ? (
        tab === 'manual' ? (
          <Empty icon={FileText} title="No resumes yet">
            <Button className="mt-2" onClick={() => navigate('/builder?new=1')}>
              Build your first resume
            </Button>
          </Empty>
        ) : (
          <Empty icon={Bot} title="No automation resumes yet">
            Paste a job link in <Link to="/apply" className="underline">Single Job Apply</Link> or switch on the <Link to="/agent" className="underline">job agent</Link>.
          </Empty>
        )
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {list.map((s) => {
            const isSel = selected.has(s.id);
            const app = appFor(s);
            return (
              <li
                key={s.id}
                className={cn('rounded-xl border bg-background p-4 flex flex-col gap-3 transition', selecting && 'cursor-pointer hover:border-primary/60', isSel && 'border-destructive ring-2 ring-destructive/30')}
                onClick={selecting ? () => toggle(s.id) : undefined}
              >
                <div className="flex items-start gap-3">
                  {selecting ? (
                    <button type="button" role="checkbox" aria-checked={isSel} aria-label={`Select ${s.title}`} className="mt-0.5 shrink-0" onClick={(e) => { e.stopPropagation(); toggle(s.id); }}>
                      {isSel ? <CheckSquare className="w-5 h-5 text-destructive" /> : <Square className="w-5 h-5 text-muted-foreground" />}
                    </button>
                  ) : s.origin === 'automation' ? (
                    <Bot className="w-5 h-5 mt-0.5 text-primary shrink-0" />
                  ) : (
                    <FileText className="w-5 h-5 mt-0.5 text-primary shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{s.title}</div>
                    <div className="text-xs text-muted-foreground">Updated {fmtDate(s.updatedAt, true)}</div>
                  </div>
                  {s.origin === 'automation' && app ? (
                    <StageBadge stage={app.stage} />
                  ) : (
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${s.status === 'finalized' ? 'bg-emerald-100 text-emerald-800' : 'bg-sky-100 text-sky-800'}`}>
                      {s.status === 'finalized' ? <Lock className="w-3 h-3" /> : <Pencil className="w-3 h-3" />}
                      {s.status === 'finalized' ? 'Finalized' : 'Draft'}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3">
                  {s.atsScore !== null && (
                    <span>
                      ATS score: <span className="font-semibold text-foreground">{s.atsScore}/100</span>
                    </span>
                  )}
                  {app?.appliedAt && <span>{STAGE_LABELS.applied} {fmtDate(app.appliedAt)}</span>}
                  {s.job?.url && (
                    <a href={s.job.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 hover:underline" onClick={(e) => e.stopPropagation()}>
                      Job <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
                {!selecting && (
                  <div className="flex gap-2 mt-auto">
                    <Button size="sm" className="flex-1" onClick={() => navigate(`/builder/${s.id}`)}>
                      Open
                    </Button>
                    {app && (
                      <Button size="sm" variant="outline" onClick={() => navigate(`/tracker?id=${app.id}`)}>
                        Application
                      </Button>
                    )}
                    <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" aria-label={`Delete ${s.title}`} onClick={() => setConfirm([s])}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm && confirm.length > 1 ? `Delete ${confirm.length} resumes?` : 'Delete this resume?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm && confirm.length > 1 ? (
                <>
                  This permanently deletes these resumes, every version and the chat history:
                  <span className="mt-2 block max-h-40 overflow-auto text-foreground">
                    {confirm.map((s) => (
                      <span key={s.id} className="block truncate">• {s.title}</span>
                    ))}
                  </span>
                </>
              ) : (
                <>This permanently deletes “{confirm?.[0]?.title}”, every version and the chat history.</>
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
    </AppShell>
  );
};
