import React, { useState } from 'react';
import { Eye, GitCompare, History, Loader2, Redo2, RotateCcw, Undo2 } from 'lucide-react';
import type { VersionSummary } from '../../../shared/apiTypes';
import { wordDiff, type ResumeChange } from '../../../shared/diff';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

const SOURCE_LABEL: Record<string, string> = { original: 'Original', generate: 'Tailored', edit: 'AI edit', manual: 'Manual', restore: 'Restore', template: 'Design', correction: 'Correction' };

export const VersionsPanel: React.FC<{
  sessionId: string;
  versions: VersionSummary[];
  currentId: string;
  previewId: string | null;
  canUndo: boolean;
  canRedo: boolean;
  onPreview: (id: string | null) => void;
  onRestore: (id: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  busy: boolean;
  readOnly?: boolean;
}> = ({ sessionId, versions, currentId, previewId, canUndo, canRedo, onPreview, onRestore, onUndo, onRedo, busy, readOnly }) => {
  const [selected, setSelected] = useState<string[]>([]);
  const [compare, setCompare] = useState<{ title: string; changes: ResumeChange[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s.slice(-1), id]));

  const runCompare = async () => {
    if (selected.length !== 2) return;
    const [a, b] = [...selected].sort((x, y) => (versions.find((v) => v.id === x)?.number || 0) - (versions.find((v) => v.id === y)?.number || 0));
    setLoading(true);
    try {
      const r = await api.compare(sessionId, a, b);
      setCompare({ title: `Version ${r.from.number} → Version ${r.to.number}`, changes: r.changes });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button size="sm" variant="outline" className="flex-1" onClick={onUndo} disabled={!canUndo || busy || readOnly}>
          <Undo2 className="w-3.5 h-3.5 mr-1.5" /> Undo
        </Button>
        <Button size="sm" variant="outline" className="flex-1" onClick={onRedo} disabled={!canRedo || busy || readOnly}>
          <Redo2 className="w-3.5 h-3.5 mr-1.5" /> Redo
        </Button>
      </div>
      <Button size="sm" variant="secondary" className="w-full" disabled={selected.length !== 2 || loading} onClick={runCompare}>
        {loading ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <GitCompare className="w-3.5 h-3.5 mr-1.5" />}
        Compare selected ({selected.length}/2)
      </Button>
      <ol className="space-y-1.5">
        {[...versions].reverse().map((v) => {
          const isCurrent = v.id === currentId;
          const isPreview = v.id === previewId;
          return (
            <li key={v.id} className={cn('rounded-lg border p-2 text-sm', isCurrent && 'border-primary bg-primary/5', isPreview && 'ring-2 ring-sky-400')}>
              <div className="flex items-start gap-2">
                <input type="checkbox" className="mt-1" checked={selected.includes(v.id)} onChange={() => toggle(v.id)} aria-label={`Select version ${v.number} for comparison`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold tabular-nums">v{v.number}</span>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide">{SOURCE_LABEL[v.source] || v.source}</span>
                    {isCurrent && <span className="text-[10px] font-semibold text-primary">CURRENT</span>}
                    {v.atsScore !== null && <span className="ml-auto text-xs tabular-nums text-muted-foreground">ATS {v.atsScore}</span>}
                  </div>
                  <div className="truncate text-xs" title={v.instruction || v.label}>
                    {v.label}
                  </div>
                  <div className="text-[10px] text-muted-foreground">{new Date(v.createdAt).toLocaleString()}</div>
                </div>
              </div>
              <div className="mt-1.5 flex gap-1.5 pl-6">
                {(!isCurrent || v.parentId) && (
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onPreview(isPreview ? null : v.id)}>
                    <Eye className="w-3 h-3 mr-1" /> {isPreview ? 'Close preview' : isCurrent ? 'Show changes' : 'Preview'}
                  </Button>
                )}
                {!isCurrent && (
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onRestore(v.id)} disabled={busy || readOnly}>
                    <RotateCcw className="w-3 h-3 mr-1" /> Restore
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {!versions.length && (
        <div className="text-sm text-muted-foreground flex gap-2">
          <History className="w-4 h-4" /> No versions yet.
        </div>
      )}
      <CompareDialog open={!!compare} onOpenChange={(o) => !o && setCompare(null)} title={compare?.title || ''} changes={compare?.changes || []} />
    </div>
  );
};

export const CompareDialog: React.FC<{ open: boolean; onOpenChange: (o: boolean) => void; title: string; changes: ResumeChange[] }> = ({ open, onOpenChange, title, changes }) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{changes.length ? `${changes.length} change${changes.length === 1 ? '' : 's'}` : 'These versions are identical.'}</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        {changes.map((c, i) => (
          <div key={i} className="rounded-lg border p-3 text-sm">
            <div className="mb-1.5 font-medium">
              <span className={cn('mr-2 rounded px-1.5 py-0.5 text-[10px] uppercase', c.type === 'added' ? 'bg-emerald-100 text-emerald-800' : c.type === 'removed' ? 'bg-red-100 text-red-800' : 'bg-sky-100 text-sky-800')}>{c.type}</span>
              {c.label}
              {c.item ? ` — ${c.item}` : ''}
            </div>
            {c.type === 'modified' && c.before !== undefined && c.after !== undefined ? (
              <div className="whitespace-pre-wrap leading-relaxed text-xs">
                {wordDiff(c.before, c.after).map((t, j) => (
                  <span key={j} className={t.type === 'add' ? 'bg-emerald-200/70 dark:bg-emerald-800/60' : t.type === 'del' ? 'bg-red-200/70 line-through dark:bg-red-900/60' : ''}>
                    {t.text}
                  </span>
                ))}
              </div>
            ) : (
              <div className="whitespace-pre-wrap text-xs text-muted-foreground">{c.after || c.before}</div>
            )}
          </div>
        ))}
      </div>
    </DialogContent>
  </Dialog>
);
