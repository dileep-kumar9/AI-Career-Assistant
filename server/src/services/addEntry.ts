import crypto from 'node:crypto';
import type { ResumeData } from '../../../shared/resumeTypes.js';
import { collectSkills, normalizeResume, normalizeSections } from '../../../shared/normalize.js';
import { findKeyword } from '../../../shared/match.js';
import { humanizeLine } from '../../../shared/humanize.js';
import { toIsoMonth } from '../../../shared/heuristicParser.js';
import type { EntryOutput } from '../ai/schemas.js';
import { novelWords, unsupportedNumbers } from './factGuard.js';

/**
 * Adds a project / internship / certification built from the user's own brief
 * or file. The new entry copies the format of the entries already in that
 * section (number of points, technologies line, dates, links), keeps only
 * points supported by the source, and never touches other entries.
 */

export interface SectionProfile {
  projectPoints: number;
  experiencePoints: number;
  projectsShowTech: boolean;
  projectsShowDates: boolean;
}

const median = (xs: number[], fallback: number) => {
  if (!xs.length) return fallback;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

export function sectionProfile(r: ResumeData): SectionProfile {
  const projLines = r.projects.map((p) => p.description.split(/\n+/).filter((l) => l.trim()).length).filter((n) => n > 0);
  return {
    projectPoints: Math.min(5, Math.max(2, median(projLines, 3))),
    experiencePoints: Math.min(6, Math.max(2, median(r.experience.map((e) => e.bulletPoints.length).filter((n) => n > 0), 4))),
    projectsShowTech: !r.projects.length || r.projects.filter((p) => p.technologies.length).length >= r.projects.length / 2,
    projectsShowDates: r.projects.some((p) => p.startDate || p.endDate),
  };
}

/** Existing entries as short text examples for the prompt. */
export function formatExamples(r: ResumeData) {
  return {
    projects: r.projects.slice(0, 2).map((p) => `${p.title}${p.technologies.length ? ` | ${p.technologies.join(', ')}` : ''}\n${p.description}`),
    experience: r.experience.slice(0, 2).map((e) => `${e.jobTitle} | ${e.company}\n${e.bulletPoints.map((b) => `- ${b}`).join('\n')}`),
  };
}

export interface EntryResult {
  resume: ResumeData;
  label: string;
  changes: string[];
  dropped: string[];
  facts: string[];
  question: string;
}

const clean = (s: string) => s.replace(/^[\s•\-*]+/, '').replace(/\s+/g, ' ').trim();
const month = (s: string) => (/^present$/i.test(s.trim()) ? '' : toIsoMonth(s) || '');
/** Dates are kept only when the source states a year (never inferred from "last month"). */
const statedMonth = (s: string, source: string) => (/\b(19|20)\d{2}\b/.test(source) ? month(s) : '');

export function applyEntry(current: ResumeData, out: EntryOutput, source: string, instruction: string): EntryResult | null {
  const r = normalizeResume(structuredClone(current));
  const profile = sectionProfile(r);
  const scope = `${source}\n${instruction}`;
  const dropped: string[] = [];
  const keepPoint = (p: string) => {
    const text = humanizeLine(clean(p));
    if (!text) return null;
    const nums = unsupportedNumbers(text, scope);
    const { fresh, ratio } = novelWords(text, scope);
    // The source is the user's own description, so rewording is expected; only a point
    // that is mostly new material (or adds numbers) is treated as invented.
    if (nums.length || (fresh.length >= 6 && ratio > 0.5)) {
      dropped.push(text);
      return null;
    }
    return text;
  };
  const skills = out.skillsUsed.map(clean).filter((s) => s && s.length <= 40 && findKeyword(scope, s));
  const facts: string[] = [];
  const changes: string[] = [];

  if (out.kind === 'project' && out.project.title.trim()) {
    const p = out.project;
    const points = p.points.map(keepPoint).filter((x): x is string => !!x).slice(0, profile.projectPoints + 1);
    if (!points.length) return null;
    const title = clean(p.title).slice(0, 120);
    const tech = p.technologies.map(clean).filter((t) => t && findKeyword(scope, t)).slice(0, 8);
    r.projects = [
      {
        id: `proj-${crypto.randomUUID().slice(0, 8)}`,
        title,
        description: points.join('\n'),
        technologies: profile.projectsShowTech ? tech : [],
        liveUrl: /^https?:\/\//i.test(p.liveUrl) ? p.liveUrl : '',
        githubUrl: /github\.com\//i.test(p.githubUrl) ? p.githubUrl : '',
        startDate: profile.projectsShowDates ? statedMonth(p.startDate, scope) : '',
        endDate: profile.projectsShowDates ? statedMonth(p.endDate, scope) : '',
      },
      ...r.projects,
    ];
    r.sections = normalizeSections(r.sections).map((s) => (s.id === 'projects' ? { ...s, visible: true } : s));
    facts.push(`User project: ${title}. ${points.join(' ')} Technologies: ${tech.join(', ')}`);
    changes.push(`Added project: ${title} (${points.length} point${points.length === 1 ? '' : 's'}, same format as your other projects)`);
  } else if (out.kind === 'experience' && out.experience.company.trim() && out.experience.jobTitle.trim()) {
    const e = out.experience;
    const points = e.points.map(keepPoint).filter((x): x is string => !!x).slice(0, profile.experiencePoints + 1);
    if (!points.length) return null;
    const entry = {
      id: `exp-${crypto.randomUUID().slice(0, 8)}`,
      jobTitle: clean(e.jobTitle).slice(0, 120),
      company: clean(e.company).slice(0, 120),
      location: clean(e.location).slice(0, 80),
      startDate: statedMonth(e.startDate, scope),
      endDate: e.current ? '' : statedMonth(e.endDate, scope),
      current: !!e.current,
      description: '',
      bulletPoints: points,
    };
    // Newest first when roles are dated; otherwise add on top.
    const all = [entry, ...r.experience];
    const key = (x: typeof entry) => (x.current ? '9999-99' : x.endDate || x.startDate || '');
    r.experience = all.every((x) => key(x)) ? all.sort((a, b) => key(b).localeCompare(key(a))) : all;
    r.sections = normalizeSections(r.sections).map((s) => {
      if (s.id !== 'experience') return { ...s };
      const intern = r.experience.every((x) => /\bintern(ship)?\b|\btrainee\b/i.test(x.jobTitle));
      return { ...s, visible: true, title: intern ? 'Internship Experience' : /internship/i.test(s.title) ? 'Experience' : s.title };
    });
    facts.push(`User experience: ${entry.jobTitle} at ${entry.company}. ${points.join(' ')}`);
    changes.push(`Added ${/intern/i.test(entry.jobTitle) ? 'internship' : 'experience'}: ${entry.jobTitle} at ${entry.company} (${points.length} bullet${points.length === 1 ? '' : 's'})`);
  } else if (out.kind === 'certification' && out.certification.name.trim()) {
    const c = out.certification;
    r.certifications = [...(r.certifications || []), { id: `cert-${crypto.randomUUID().slice(0, 8)}`, name: clean(c.name), issuer: clean(c.issuer), date: statedMonth(c.date, scope) }];
    r.sections = normalizeSections(r.sections).map((s) => (s.id === 'certifications' ? { ...s, visible: true } : s));
    facts.push(`User certification: ${clean(c.name)} ${clean(c.issuer)}`);
    changes.push(`Added certification: ${clean(c.name)}`);
  } else {
    return null;
  }

  // Skills the source says were used and the resume does not list yet.
  const have = new Set(collectSkills(r).map((s) => s.toLowerCase()));
  const newSkills = [...new Set(skills)].filter((s) => !have.has(s.toLowerCase())).slice(0, 8);
  if (newSkills.length) {
    if (r.skills.mode === 'simple' && !r.skills.categorized.length) r.skills.simple.push(...newSkills);
    else {
      const extra = r.skills.categorized.find((c) => /additional|other/i.test(c.name));
      if (extra) extra.skills.push(...newSkills);
      else r.skills.categorized.push({ id: `skills-${crypto.randomUUID().slice(0, 8)}`, name: 'Additional Skills', skills: newSkills });
      r.skills.mode = 'categorized';
    }
    changes.push(`Added to skills (used in it): ${newSkills.join(', ')}`);
    facts.push(...newSkills.map((s) => `User confirmed experience with ${s}.`));
  }
  return { resume: normalizeResume(r), label: changes[0].slice(0, 80), changes, dropped, facts, question: out.question.trim() };
}

/** "add this project: …", "here are my internship details …", a long brief naming a project/internship. */
export function isAddEntryRequest(text: string): boolean {
  if (/\bfrom my (existing|original|current)\b|\bfrom (the|my) resume\b/i.test(text)) return false;
  const verb = /\b(add|include|put|insert|here (is|are)|here's|this is|these are|attached|details of|brief)\b/i.test(text);
  const noun = /\b(project|internship|intern|work experience|job experience|experience at|worked at|certificat(e|ion))\b/i.test(text);
  return verb && noun && (text.length >= 140 || /\n/.test(text.trim()));
}
