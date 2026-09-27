import React, { useRef, useState } from 'react';
import { Loader2, Plus, Save, Trash2, X } from 'lucide-react';
import type { ResumeData } from '../../../shared/resumeTypes';
import { newId } from '../../../shared/normalize';
import { ResumeProvider, useResume } from '@/contexts/ResumeContext';
// Import the section forms directly: the legacy ResumeForm also pulls in the
// PDF.js-based AI tailor panel, which the builder does not need.
import { PersonalInfoForm } from '@/components/form/sections/PersonalInfoForm';
import { SummaryForm } from '@/components/form/sections/SummaryForm';
import { ExperienceForm } from '@/components/form/sections/ExperienceForm';
import { ProjectsForm } from '@/components/form/sections/ProjectsForm';
import { EducationForm } from '@/components/form/sections/EducationForm';
import { SkillsForm } from '@/components/form/sections/SkillsForm';
import { CustomSectionsForm } from '@/components/form/sections/CustomSectionsForm';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** Certifications and achievements are builder-only fields, edited here. */
const ExtraSections: React.FC = () => {
  const { state, importResumeData } = useResume();
  const r = state.resumeData;
  const certs = r.certifications || [];
  const achievements = r.achievements || [];
  const set = (patch: Partial<ResumeData>) => importResumeData({ ...r, ...patch });
  return (
    <div className="space-y-5 p-3 border-t">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Certifications</h3>
          <Button size="sm" variant="outline" onClick={() => set({ certifications: [...certs, { id: newId('cert'), name: '', issuer: '', date: '' }] })}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Add
          </Button>
        </div>
        {certs.map((c, i) => (
          <div key={c.id} className="grid grid-cols-[1fr_1fr_90px_auto] gap-1.5">
            <Input aria-label="Certification name" placeholder="Name" value={c.name} onChange={(e) => set({ certifications: certs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
            <Input aria-label="Issuer" placeholder="Issuer" value={c.issuer} onChange={(e) => set({ certifications: certs.map((x, j) => (j === i ? { ...x, issuer: e.target.value } : x)) })} />
            <Input aria-label="Date" placeholder="YYYY-MM" value={c.date} onChange={(e) => set({ certifications: certs.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)) })} />
            <Button size="icon" variant="ghost" aria-label="Remove certification" onClick={() => set({ certifications: certs.filter((_, j) => j !== i) })}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Achievements</h3>
          <Button size="sm" variant="outline" onClick={() => set({ achievements: [...achievements, { id: newId('ach'), text: '' }] })}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Add
          </Button>
        </div>
        {achievements.map((a, i) => (
          <div key={a.id} className="flex gap-1.5">
            <Input aria-label="Achievement" value={a.text} onChange={(e) => set({ achievements: achievements.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
            <Button size="icon" variant="ghost" aria-label="Remove achievement" onClick={() => set({ achievements: achievements.filter((_, j) => j !== i) })}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
};

export const ManualEditor: React.FC<{ resume: ResumeData; onSave: (r: ResumeData) => Promise<unknown>; onClose: () => void; saving: boolean; title?: string }> = ({ resume, onSave, onClose, saving, title = 'Edit resume content' }) => {
  const draft = useRef<ResumeData>(resume);
  const [dirty, setDirty] = useState(false);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div>
          <div className="text-sm font-semibold">{title}</div>
          <div className="text-xs text-muted-foreground">Saving creates a new version; you can undo it at any time.</div>
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" variant="ghost" onClick={onClose} disabled={saving}>
            <X className="w-4 h-4 mr-1" /> Cancel
          </Button>
          <Button size="sm" onClick={() => onSave(draft.current)} disabled={saving || !dirty}>
            {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />} Save
          </Button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <ResumeProvider
          initialData={structuredClone(resume)}
          onChange={(d) => {
            if (d !== draft.current) {
              setDirty(JSON.stringify(d) !== JSON.stringify(resume));
              draft.current = d;
            }
          }}
        >
          <Tabs defaultValue="personal" className="p-3">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="personal">Profile</TabsTrigger>
              <TabsTrigger value="work">Work</TabsTrigger>
              <TabsTrigger value="education">Skills & edu</TabsTrigger>
              <TabsTrigger value="more">More</TabsTrigger>
            </TabsList>
            <TabsContent value="personal" className="space-y-4">
              <PersonalInfoForm />
              <SummaryForm />
            </TabsContent>
            <TabsContent value="work" className="space-y-4">
              <ExperienceForm />
              <ProjectsForm />
            </TabsContent>
            <TabsContent value="education" className="space-y-4">
              <SkillsForm />
              <EducationForm />
            </TabsContent>
            <TabsContent value="more" className="space-y-4">
              <ExtraSections />
              <CustomSectionsForm />
            </TabsContent>
          </Tabs>
        </ResumeProvider>
      </div>
    </div>
  );
};
