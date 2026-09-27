import React, { useEffect, useState } from 'react';
import { Link2, Loader2, Plus, Search, Sparkles, X } from 'lucide-react';
import type { JDAnalysis } from '../../../shared/jdAnalyzer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

type ListKey = 'requiredSkills' | 'preferredSkills' | 'atsKeywords' | 'certifications';

const EditableList: React.FC<{ label: string; items: string[]; onChange: (next: string[]) => void; disabled?: boolean; tone: string }> = ({ label, items, onChange, disabled, tone }) => {
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = draft.trim();
    if (v && !items.some((i) => i.toLowerCase() === v.toLowerCase())) onChange([...items, v]);
    setDraft('');
  };
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium">
        {label} <span className="text-muted-foreground">({items.length})</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((k) => (
          <span key={k} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${tone}`}>
            {k}
            {!disabled && (
              <button type="button" aria-label={`Remove ${k}`} onClick={() => onChange(items.filter((x) => x !== k))} className="opacity-60 hover:opacity-100">
                <X className="w-3 h-3" />
              </button>
            )}
          </span>
        ))}
        {!items.length && <span className="text-xs text-muted-foreground">None detected</span>}
      </div>
      {!disabled && (
        <div className="flex gap-1.5">
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} placeholder="Add keyword" className="h-7 text-xs" maxLength={80} />
          <Button type="button" size="sm" variant="outline" className="h-7 px-2" onClick={add} aria-label={`Add to ${label}`}>
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
};

export const JobDescriptionPanel: React.FC<{
  jobDescription: string;
  analysis: JDAnalysis | null;
  onAnalyze: (jd: string) => Promise<unknown>;
  /** Reads the job description from a link to the posting. */
  onImportUrl?: (url: string) => Promise<unknown>;
  analyzing: boolean;
  onUpdateAnalysis: (patch: Partial<JDAnalysis>) => void;
  onGenerate?: () => void;
  generating?: boolean;
  generated: boolean;
  readOnly?: boolean;
}> = ({ jobDescription, analysis, onAnalyze, onImportUrl, analyzing, onUpdateAnalysis, onGenerate, generating, generated, readOnly }) => {
  const [text, setText] = useState(jobDescription);
  const [url, setUrl] = useState('');
  const validUrl = /^https?:\/\/\S+\.\S+/i.test(url.trim());
  useEffect(() => setText(jobDescription), [jobDescription]);
  const dirty = text.trim() !== jobDescription.trim();

  const lists: Array<[ListKey, string, string]> = [
    ['requiredSkills', 'Required skills', 'bg-red-50 border-red-200 text-red-900 dark:bg-red-950/40 dark:text-red-200 dark:border-red-900'],
    ['preferredSkills', 'Preferred skills', 'bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900'],
    ['certifications', 'Certifications', 'bg-violet-50 border-violet-200 text-violet-900 dark:bg-violet-950/40 dark:text-violet-200 dark:border-violet-900'],
    ['atsKeywords', 'Important ATS keywords', 'bg-sky-50 border-sky-200 text-sky-900 dark:bg-sky-950/40 dark:text-sky-200 dark:border-sky-900'],
  ];

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="jd-input" className="text-sm font-medium">
          Job description
        </label>
        {onImportUrl && !readOnly && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (validUrl) onImportUrl(url.trim()).then(() => setUrl('')).catch(() => undefined);
            }}
          >
            <div className="relative flex-1">
              <Link2 className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="…or paste a link to the job posting" className="h-8 pl-7 text-sm" aria-label="Job posting link" />
            </div>
            <Button type="submit" size="sm" variant="outline" disabled={!validUrl || analyzing}>
              {analyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Import'}
            </Button>
          </form>
        )}
        <Textarea id="jd-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the complete job description here…" className="min-h-[180px] text-sm" maxLength={30000} disabled={readOnly} />
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => onAnalyze(text)} disabled={analyzing || readOnly || text.trim().length < 80 || (!dirty && !!analysis)} variant={analysis && !dirty ? 'outline' : 'default'} size="sm">
            {analyzing ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Search className="w-4 h-4 mr-1.5" />}
            {analysis ? (dirty ? 'Update & re-analyse' : 'Analysed') : 'Analyse job description'}
          </Button>
          {onGenerate && analysis && !dirty && (
            <Button size="sm" onClick={onGenerate} disabled={generating || readOnly}>
              {generating ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1.5" />}
              {generated ? 'Regenerate tailored resume' : 'Generate tailored resume'}
            </Button>
          )}
        </div>
        {text.trim().length > 0 && text.trim().length < 80 && <p className="text-xs text-muted-foreground">Paste the full job description for an accurate analysis.</p>}
      </div>

      {analysis && (
        <div className="space-y-4 rounded-lg border p-3">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Job title</div>
              <div className="font-medium">{analysis.jobTitle || '—'}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Company</div>
              <div className="font-medium">{analysis.company || '—'}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Experience</div>
              <div className="font-medium">{analysis.minYears ? `${analysis.minYears}+ years` : '—'}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Education</div>
              <div className="font-medium">{['—', 'Associate / diploma', "Bachelor's", "Master's", 'Doctorate'][analysis.educationLevel] || '—'}</div>
            </div>
          </div>
          {lists.map(([key, label, tone]) => (
            <EditableList key={key} label={label} items={analysis[key]} tone={tone} disabled={readOnly} onChange={(next) => onUpdateAnalysis({ [key]: next })} />
          ))}
          {analysis.tools.length > 0 && (
            <div className="text-xs">
              <span className="font-medium">Tools & technologies:</span> <span className="text-muted-foreground">{analysis.tools.join(', ')}</span>
            </div>
          )}
          {analysis.industryKeywords.length > 0 && (
            <div className="text-xs">
              <span className="font-medium">Industry keywords:</span> <span className="text-muted-foreground">{analysis.industryKeywords.join(', ')}</span>
            </div>
          )}
          {analysis.responsibilities.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer font-medium">Key responsibilities ({analysis.responsibilities.length})</summary>
              <ul className="list-disc pl-4 mt-1 space-y-0.5 text-muted-foreground">
                {analysis.responsibilities.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </details>
          )}
          {analysis.education.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer font-medium">Education & experience requirements</summary>
              <ul className="list-disc pl-4 mt-1 space-y-0.5 text-muted-foreground">
                {[...analysis.education, ...analysis.experienceRequirements].map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </details>
          )}
          <p className="text-[11px] text-muted-foreground">
            Extracted {analysis.source === 'ai+deterministic' ? 'with AI and rule-based matching' : 'with rule-based matching'}
            {analysis.userEdited ? ' · edited by you' : ''}. Removing a keyword excludes it from the ATS score.
          </p>
        </div>
      )}
    </div>
  );
};
