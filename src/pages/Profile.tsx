import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, Trash2, Wand2 } from 'lucide-react';
import type { CareerProfile, JobType, WorkMode } from '../../shared/careerTypes';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChipsInput, errMsg, fmtDate } from '@/components/career/bits';
import { ResumeSelect } from '@/components/career/ResumeSelect';
import { toast } from '@/hooks/use-toast';
import { career } from '@/lib/careerApi';

function F({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-sm">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function YesNo({ value, onChange }: { value: boolean | null; onChange: (v: boolean | null) => void }) {
  return (
    <Select value={value === null ? 'unset' : value ? 'yes' : 'no'} onValueChange={(v) => onChange(v === 'unset' ? null : v === 'yes')}>
      <SelectTrigger className="w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="unset">Not stated (ask me)</SelectItem>
        <SelectItem value="yes">Yes</SelectItem>
        <SelectItem value="no">No</SelectItem>
      </SelectContent>
    </Select>
  );
}

export const Profile: React.FC = () => {
  const qc = useQueryClient();
  const { data: saved } = useQuery({ queryKey: ['profile'], queryFn: career.profile });
  const [p, setP] = useState<CareerProfile | null>(null);
  const [fillFrom, setFillFrom] = useState<string | null>(null);
  const [qa, setQa] = useState({ question: '', answer: '' });
  useEffect(() => {
    if (saved) setP(saved);
  }, [saved]);
  const onSaved = (next: CareerProfile) => {
    qc.setQueryData(['profile'], next);
    setP(next);
  };
  const save = useMutation({
    mutationFn: () => career.saveProfile({ basics: p!.basics, career: p!.career, skills: p!.skills, authorization: p!.authorization, diversity: p!.diversity, defaultResumeId: p!.defaultResumeId }),
    onSuccess: (n) => {
      onSaved(n);
      toast({ title: 'Career Profile saved' });
    },
    onError: (e) => toast({ title: 'Could not save', description: errMsg(e), variant: 'destructive' }),
  });
  const autofill = useMutation({
    mutationFn: (id: string) => career.autofill(id),
    onSuccess: (r) => {
      onSaved(r.profile);
      toast({ title: 'Filled from your resume', description: r.method === 'ai' ? 'AI suggested your target roles; check everything below.' : 'Rule-based fill; check everything below.' });
    },
    onError: (e) => toast({ title: 'Could not fill from the resume', description: errMsg(e), variant: 'destructive' }),
  });
  const addAnswer = useMutation({ mutationFn: () => career.saveAnswer(qa), onSuccess: (n) => (onSaved(n), setQa({ question: '', answer: '' })), onError: (e) => toast({ title: errMsg(e), variant: 'destructive' }) });
  const delAnswer = useMutation({ mutationFn: (id: string) => career.deleteAnswer(id), onSuccess: onSaved });

  if (!p) return <AppShell title="Career Profile">Loading…</AppShell>;
  const dirty = JSON.stringify({ ...p, savedAnswers: 0, updatedAt: 0 }) !== JSON.stringify({ ...saved, savedAnswers: 0, updatedAt: 0 });
  const b = (k: keyof CareerProfile['basics']) => ({ value: p.basics[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setP({ ...p, basics: { ...p.basics, [k]: e.target.value } }) });
  const c = <K extends keyof CareerProfile['career']>(k: K, v: CareerProfile['career'][K]) => setP({ ...p, career: { ...p.career, [k]: v } });
  const byName = (src: string) => p.skills.filter((s) => s.source === src).map((s) => s.name);

  return (
    <AppShell
      title="Career Profile"
      subtitle="Used to search jobs and to answer application forms — only what you enter here is ever submitted"
      actions={
        <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
          <Save className="w-4 h-4 mr-1.5" /> Save
        </Button>
      }
    >
      <div className="space-y-5">
        <section className="rounded-xl border bg-background p-4 flex flex-wrap items-end gap-3">
          <F label="Fill from a resume" hint={p.autofilledFrom ? `Last filled ${fmtDate(p.autofilledFrom.at)} (${p.autofilledFrom.method}). Only empty fields are filled; resume skills are refreshed.` : 'Only empty fields are filled.'}>
            <ResumeSelect value={fillFrom} onChange={setFillFrom} allowDefault={false} />
          </F>
          <Button variant="outline" disabled={!fillFrom || autofill.isPending} onClick={() => fillFrom && autofill.mutate(fillFrom)}>
            {autofill.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Wand2 className="w-4 h-4 mr-1.5" />} Fill
          </Button>
          <div className="ml-auto">
            <F label="Default resume for applying">
              <ResumeSelect value={p.defaultResumeId} onChange={(v) => setP({ ...p, defaultResumeId: v })} allowDefault={false} />
            </F>
          </div>
        </section>

        <section className="rounded-xl border bg-background p-4 grid gap-4 sm:grid-cols-2">
          <h2 className="font-semibold sm:col-span-2">Basics</h2>
          <F label="Full name"><Input {...b('fullName')} /></F>
          <F label="Email"><Input type="email" {...b('email')} /></F>
          <F label="Phone"><Input {...b('phone')} /></F>
          <div className="grid grid-cols-2 gap-2">
            <F label="City"><Input {...b('city')} /></F>
            <F label="Country"><Input {...b('country')} /></F>
          </div>
          <F label="LinkedIn"><Input {...b('linkedin')} /></F>
          <F label="GitHub"><Input {...b('github')} /></F>
          <F label="Portfolio / website"><Input {...b('portfolio')} /></F>
        </section>

        <section className="rounded-xl border bg-background p-4 grid gap-4 sm:grid-cols-2">
          <h2 className="font-semibold sm:col-span-2">Career</h2>
          <div className="sm:col-span-2">
            <F label="Target roles"><ChipsInput value={p.career.targetRoles} onChange={(v) => c('targetRoles', v)} placeholder="SOC Analyst…" max={10} /></F>
          </div>
          <F label="Years of professional experience"><Input type="number" min={0} max={60} value={p.career.yearsExperience ?? ''} onChange={(e) => c('yearsExperience', e.target.value === '' ? null : Number(e.target.value))} /></F>
          <F label="Seniority">
            <Select value={p.career.seniority} onValueChange={(v) => c('seniority', v as CareerProfile['career']['seniority'])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {['intern', 'entry', 'mid', 'senior'].map((x) => <SelectItem key={x} value={x} className="capitalize">{x}</SelectItem>)}
              </SelectContent>
            </Select>
          </F>
          <F label="Current title"><Input value={p.career.currentTitle} onChange={(e) => c('currentTitle', e.target.value)} /></F>
          <F label="Current company"><Input value={p.career.currentCompany} onChange={(e) => c('currentCompany', e.target.value)} /></F>
          <F label="Notice period"><Input value={p.career.noticePeriod} onChange={(e) => c('noticePeriod', e.target.value)} placeholder="Immediate / 30 days" /></F>
          <F label="Earliest start date"><Input value={p.career.earliestStart} onChange={(e) => c('earliestStart', e.target.value)} placeholder="Immediately / 2026-11-01" /></F>
          <F label="Current salary / CTC"><Input value={p.career.currentSalary} onChange={(e) => c('currentSalary', e.target.value)} /></F>
          <F label="Expected salary / CTC"><Input value={p.career.expectedSalary} onChange={(e) => c('expectedSalary', e.target.value)} /></F>
          <F label="Preferred locations"><ChipsInput value={p.career.locations} onChange={(v) => c('locations', v)} placeholder="Hyderabad…" max={20} /></F>
          <div className="space-y-3">
            <F label="Work modes">
              <div className="flex gap-3">
                {(['onsite', 'hybrid', 'remote'] as WorkMode[]).map((m) => (
                  <label key={m} className="flex items-center gap-1.5 text-sm capitalize">
                    <Checkbox checked={p.career.workModes.includes(m)} onCheckedChange={(v) => c('workModes', v ? [...p.career.workModes, m] : p.career.workModes.filter((x) => x !== m))} /> {m}
                  </label>
                ))}
              </div>
            </F>
            <F label="Job types">
              <div className="flex flex-wrap gap-3">
                {(['full-time', 'part-time', 'contract', 'internship'] as JobType[]).map((m) => (
                  <label key={m} className="flex items-center gap-1.5 text-sm capitalize">
                    <Checkbox checked={p.career.jobTypes.includes(m)} onCheckedChange={(v) => c('jobTypes', v ? [...p.career.jobTypes, m] : p.career.jobTypes.filter((x) => x !== m))} /> {m}
                  </label>
                ))}
              </div>
            </F>
          </div>
        </section>

        <section className="rounded-xl border bg-background p-4 space-y-3">
          <h2 className="font-semibold">Skills</h2>
          <F label="From your resume" hint="Refreshed when you fill from a resume.">
            <ChipsInput value={byName('resume')} onChange={(v) => setP({ ...p, skills: [...v.map((name) => ({ name, source: 'resume' as const })), ...p.skills.filter((s) => s.source !== 'resume')] })} />
          </F>
          <F label="Added by you" hint="Used for job search only — never written into a resume unless you confirm them (Skills & Learning).">
            <ChipsInput value={byName('user')} onChange={(v) => setP({ ...p, skills: [...p.skills.filter((s) => s.source !== 'user'), ...v.map((name) => ({ name, source: 'user' as const }))] })} placeholder="Add a skill…" />
          </F>
          {byName('learned').length > 0 && (
            <F label="Learned and confirmed">
              <ChipsInput value={byName('learned')} onChange={(v) => setP({ ...p, skills: [...p.skills.filter((s) => s.source !== 'learned'), ...v.map((name) => ({ name, source: 'learned' as const }))] })} />
            </F>
          )}
          {p.confirmedFacts.length > 0 && (
            <div>
              <div className="text-sm font-medium">Confirmed facts (resumes may use these)</div>
              <ul className="list-disc pl-5 text-sm text-muted-foreground">{p.confirmedFacts.map((f) => <li key={f}>{f}</li>)}</ul>
            </div>
          )}
        </section>

        <section className="rounded-xl border bg-background p-4 grid gap-4 sm:grid-cols-3">
          <h2 className="font-semibold sm:col-span-3">Work authorisation</h2>
          <F label="Authorised to work in"><ChipsInput value={p.authorization.countries} onChange={(v) => setP({ ...p, authorization: { ...p.authorization, countries: v } })} placeholder="India…" max={20} /></F>
          <F label="Needs visa sponsorship"><YesNo value={p.authorization.needsSponsorship} onChange={(v) => setP({ ...p, authorization: { ...p.authorization, needsSponsorship: v } })} /></F>
          <F label="Willing to relocate"><YesNo value={p.authorization.willingToRelocate} onChange={(v) => setP({ ...p, authorization: { ...p.authorization, willingToRelocate: v } })} /></F>
        </section>

        <section className="rounded-xl border bg-background p-4 grid gap-4 sm:grid-cols-4">
          <div className="sm:col-span-4">
            <h2 className="font-semibold">Voluntary self-identification (optional)</h2>
            <p className="text-xs text-muted-foreground">Leave empty to always answer “Decline to self-identify”.</p>
          </div>
          {(['gender', 'ethnicity', 'veteran', 'disability'] as const).map((k) => (
            <F key={k} label={k[0].toUpperCase() + k.slice(1)}>
              <Input value={p.diversity[k]} onChange={(e) => setP({ ...p, diversity: { ...p.diversity, [k]: e.target.value } })} placeholder="Decline" />
            </F>
          ))}
        </section>

        <section className="rounded-xl border bg-background p-4 space-y-3">
          <div>
            <h2 className="font-semibold">Saved answers</h2>
            <p className="text-xs text-muted-foreground">Reused whenever an application asks the same question.</p>
          </div>
          <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
            <Input placeholder="Question, e.g. Why do you want to work in security?" value={qa.question} onChange={(e) => setQa({ ...qa, question: e.target.value })} />
            <Textarea rows={1} placeholder="Your answer" value={qa.answer} onChange={(e) => setQa({ ...qa, answer: e.target.value })} />
            <Button disabled={qa.question.trim().length < 2 || !qa.answer.trim() || addAnswer.isPending} onClick={() => addAnswer.mutate()}>
              Add
            </Button>
          </div>
          <ul className="divide-y rounded-lg border">
            {p.savedAnswers.map((a) => (
              <li key={a.id} className="flex gap-3 px-3 py-2 text-sm">
                <div className="flex-1">
                  <div className="font-medium">{a.question}</div>
                  <div className="text-muted-foreground whitespace-pre-wrap">{a.answer}</div>
                </div>
                <Button size="icon" variant="ghost" aria-label="Delete answer" onClick={() => delAnswer.mutate(a.id)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </li>
            ))}
            {!p.savedAnswers.length && <li className="px-3 py-2 text-sm text-muted-foreground">None yet.</li>}
          </ul>
        </section>
        {dirty && (
          <div className="sticky bottom-3 flex justify-end">
            <Button className="shadow-lg" disabled={save.isPending} onClick={() => save.mutate()}>
              <Save className="w-4 h-4 mr-1.5" /> Save profile
            </Button>
          </div>
        )}
      </div>
    </AppShell>
  );
};
