import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileDown, Loader2, Pencil } from 'lucide-react';
import type { ReviewData } from '../../../shared/apiTypes';
import { TEMPLATE_STYLES } from '../../../shared/templates';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScaledResume } from '@/components/resume/ResumeDocument';
import { ScoreRing } from './AtsPanel';
import { api } from '@/lib/api';
import { toast } from '@/hooks/use-toast';

export const FinalReviewDialog: React.FC<{
  sessionId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onFinish: () => Promise<unknown>;
  finishing: boolean;
  finalized: boolean;
}> = ({ sessionId, open, onOpenChange, onFinish, finishing, finalized }) => {
  const [review, setReview] = useState<ReviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<'pdf' | 'docx' | null>(null);

  useEffect(() => {
    if (!open) return;
    setReview(null);
    setError(null);
    api.review(sessionId).then(setReview, (e) => setError(e instanceof Error ? e.message : 'Could not load the review.'));
  }, [open, sessionId]);

  const download = async (format: 'pdf' | 'docx') => {
    setDownloading(format);
    try {
      const r = await api.download(sessionId, format);
      toast({ title: `Downloaded ${r.name}` });
    } catch (e) {
      toast({ title: 'Download failed', description: e instanceof Error ? e.message : 'Please try again.', variant: 'destructive' });
    } finally {
      setDownloading(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[calc(100vw-2rem)] max-h-[92vh] overflow-hidden p-0 flex flex-col">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle>Final review</DialogTitle>
          <DialogDescription>Check your resume before downloading. You can return to editing at any time — nothing is locked.</DialogDescription>
        </DialogHeader>
        {!review && !error && (
          <div className="flex-1 flex items-center justify-center p-10 text-muted-foreground">
            <Loader2 className="w-5 h-5 mr-2 animate-spin" /> Preparing final review…
          </div>
        )}
        {error && <div className="p-5 text-sm text-destructive">{error}</div>}
        {review && (
          <div className="grid flex-1 min-h-0 gap-4 overflow-y-auto px-5 pb-2 md:grid-cols-[minmax(0,1fr)_300px]">
            <div className="rounded-lg bg-muted/60 p-3 min-w-0">
              <ScaledResume resume={review.resume} maxScale={0.9} />
            </div>
            <aside className="space-y-4 text-sm">
              {review.ats ? (
                <div className="flex items-center gap-3">
                  <ScoreRing score={review.ats.total} size={84} stroke={8} />
                  <div className="text-xs text-muted-foreground">Estimated ATS compatibility for this job description.</div>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">No job description — no ATS score.</div>
              )}
              <dl className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-md bg-muted p-2">
                  <dt className="text-muted-foreground">Template</dt>
                  <dd className="font-medium">{TEMPLATE_STYLES[review.template as keyof typeof TEMPLATE_STYLES]?.name || review.template}</dd>
                </div>
                <div className="rounded-md bg-muted p-2">
                  <dt className="text-muted-foreground">Page count</dt>
                  <dd className="font-medium">{review.pageCount}</dd>
                </div>
              </dl>
              {review.missingKeywords.length > 0 && (
                <div>
                  <div className="font-medium text-xs mb-1">Important missing keywords</div>
                  <div className="flex flex-wrap gap-1">
                    {review.missingKeywords.slice(0, 16).map((k) => (
                      <span key={k} className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] text-red-800 dark:bg-red-950/40 dark:text-red-200 dark:border-red-900">
                        {k}
                      </span>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">Only add these if you genuinely have the experience.</p>
                </div>
              )}
              <div>
                <div className="font-medium text-xs mb-1">Formatting warnings</div>
                {review.warnings.length ? (
                  <ul className="space-y-1">
                    {review.warnings.map((w, i) => (
                      <li key={i} className="flex gap-1.5 text-xs">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                        {w}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="flex gap-1.5 text-xs text-emerald-700">
                    <CheckCircle2 className="w-3.5 h-3.5" /> No formatting issues found.
                  </div>
                )}
              </div>
              <div className="grid gap-2">
                <Button onClick={() => download('pdf')} disabled={!!downloading}>
                  {downloading === 'pdf' ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Download className="w-4 h-4 mr-1.5" />} Download PDF
                </Button>
                <Button variant="outline" onClick={() => download('docx')} disabled={!!downloading}>
                  {downloading === 'docx' ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <FileDown className="w-4 h-4 mr-1.5" />} Download DOCX
                </Button>
              </div>
            </aside>
          </div>
        )}
        <DialogFooter className="border-t px-5 py-3 gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            <Pencil className="w-4 h-4 mr-1.5" /> Return to Editing
          </Button>
          <Button onClick={() => onFinish()} disabled={finishing || finalized || !review}>
            {finishing && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
            {finalized ? 'Finalized' : 'Finish and Close'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
