import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';

/** Your own resumes (not automation copies). Empty value = the default resume from your Career Profile. */
export function useMyResumes() {
  return useQuery({ queryKey: ['resumes', 'manual'], queryFn: () => api.listMine('manual').then((r) => r.resumes), retry: false });
}

export const ResumeSelect: React.FC<{ value: string | null; onChange: (id: string | null) => void; allowDefault?: boolean; className?: string }> = ({ value, onChange, allowDefault = true, className }) => {
  const { data = [], isLoading } = useMyResumes();
  return (
    <Select value={value || (allowDefault ? 'default' : '')} onValueChange={(v) => onChange(v === 'default' ? null : v)} disabled={isLoading}>
      <SelectTrigger className={className || 'w-64'}>
        <SelectValue placeholder={isLoading ? 'Loading resumes…' : data.length ? 'Choose a resume' : 'No resumes yet'} />
      </SelectTrigger>
      <SelectContent>
        {allowDefault && <SelectItem value="default">Default resume (Career Profile)</SelectItem>}
        {data.map((r) => (
          <SelectItem key={r.id} value={r.id}>
            {r.title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
