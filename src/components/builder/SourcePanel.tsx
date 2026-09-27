import React, { useEffect, useState } from 'react';
import { ExternalLink, FileText, Loader2, Lock, RefreshCw } from 'lucide-react';
import type { SessionView } from '../../../shared/apiTypes';
import { collectSkills } from '../../../shared/normalize';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { toast } from '@/hooks/use-toast';

export const SourcePanel: React.FC<{ session: SessionView; onReparse: (text: string) => Promise<unknown>; reparsing: boolean; onEditOriginal: () => void }> = ({ session, onReparse, reparsing, onEditOriginal }) => {
  const [text, setText] = useState(session.originalText);
  useEffect(() => setText(session.originalText), [session.originalText]);
  const o = session.original;

  const openFile = async () => {
    try {
      const url = await api.originalFileUrl(session.id);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      toast({ title: 'Could not open the original file', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-3 space-y-1 text-sm">
        <div className="flex items-center gap-2 font-medium">
          <FileText className="w-4 h-4" /> {session.originalFile?.name || 'Pasted resume text'}
        </div>
        {session.originalFile && <div className="text-xs text-muted-foreground">{(session.originalFile.size / 1024).toFixed(0)} KB · stored privately in this session</div>}
        <div className="text-xs text-muted-foreground">
          {o.experience.length} roles · {o.projects.length} projects · {o.education.length} education · {collectSkills(o).length} skills · {o.certifications?.length || 0} certifications
        </div>
        {session.originalFile && (
          <Button size="sm" variant="outline" className="mt-2" onClick={openFile}>
            <ExternalLink className="w-3.5 h-3.5 mr-1.5" /> Open original file
          </Button>
        )}
      </div>

      {session.originalLocked ? (
        <div className="rounded-md bg-muted p-2.5 text-xs flex gap-2">
          <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          The original resume is locked as the source of truth. All AI edits are checked against it. Edit the current version instead.
        </div>
      ) : (
        <div className="rounded-md bg-sky-50 dark:bg-sky-950/40 p-2.5 text-xs">Check the extraction before generating. Fix mistakes in the text and re-parse, or edit the structured fields directly.</div>
      )}

      <div className="space-y-2">
        <label htmlFor="original-text" className="text-sm font-medium">
          Extracted text
        </label>
        <Textarea id="original-text" value={text} onChange={(e) => setText(e.target.value)} readOnly={session.originalLocked} className="min-h-[260px] font-mono text-xs" />
        {!session.originalLocked && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => onReparse(text)} disabled={reparsing || text.trim() === session.originalText.trim()}>
              {reparsing ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />} Re-parse corrected text
            </Button>
            <Button size="sm" variant="outline" onClick={onEditOriginal}>
              Edit structured fields
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
