import { z } from 'zod';
import type { CareerProfile, ProfileSkill, Seniority } from '../../../shared/careerTypes.js';
import type { ResumeData } from '../../../shared/resumeTypes.js';
import { experienceYears } from '../../../shared/ats.js';
import { collectSkills, resumeToPlainText } from '../../../shared/normalize.js';
import { canonicalKeyword } from '../../../shared/match.js';
import { profileFromResume, runPrompt } from '../ai/prompts/index.js';
import type { DocBase } from '../db/store.js';
import { logger } from '../logger.js';
import { type CareerContext, newId, now } from './context.js';

/**
 * Career Profile: one per owner. Feeds the job agent's search, the
 * application form filler and the career chat. Auto-filled from a resume
 * (AI when available, rules otherwise); auto-fill never overwrites values
 * you typed yourself.
 */

type ProfileDoc = CareerProfile & DocBase;

const s = (max = 200) => z.string().trim().max(max);
const list = (max = 50, len = 100) => z.array(s(len)).max(max).transform((a) => uniq(a.filter(Boolean)));

export const ProfileInput = z.object({
  basics: z.object({ fullName: s(), email: s(), phone: s(60), city: s(), country: s(), linkedin: s(300), github: s(300), portfolio: s(300) }).partial().optional(),
  career: z
    .object({
      targetRoles: list(10),
      yearsExperience: z.number().min(0).max(60).nullable(),
      seniority: z.enum(['intern', 'entry', 'mid', 'senior']),
      currentTitle: s(),
      currentCompany: s(),
      noticePeriod: s(100),
      currentSalary: s(100),
      expectedSalary: s(100),
      jobTypes: z.array(z.enum(['full-time', 'part-time', 'contract', 'internship'])).max(4),
      locations: list(20),
      workModes: z.array(z.enum(['remote', 'hybrid', 'onsite'])).max(3),
      earliestStart: s(100),
    })
    .partial()
    .optional(),
  skills: z
    .array(z.object({ name: s(80), source: z.enum(['resume', 'user', 'learned']) }))
    .max(200)
    .optional(),
  authorization: z.object({ countries: list(20), needsSponsorship: z.boolean().nullable(), willingToRelocate: z.boolean().nullable() }).partial().optional(),
  diversity: z.object({ gender: s(80), ethnicity: s(80), veteran: s(80), disability: s(80) }).partial().optional(),
  defaultResumeId: z.string().uuid().nullable().optional(),
});
export type ProfileInput = z.infer<typeof ProfileInput>;

export const SavedAnswerInput = z.object({ id: z.string().max(80).optional(), question: s(500).min(2), answer: s(4000) });

function uniq(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((v) => {
    const k = v.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function blankProfile(): CareerProfile {
  return {
    basics: { fullName: '', email: '', phone: '', city: '', country: '', linkedin: '', github: '', portfolio: '' },
    career: {
      targetRoles: [],
      yearsExperience: null,
      seniority: 'entry',
      currentTitle: '',
      currentCompany: '',
      noticePeriod: '',
      currentSalary: '',
      expectedSalary: '',
      jobTypes: ['full-time'],
      locations: [],
      workModes: ['onsite', 'hybrid', 'remote'],
      earliestStart: '',
    },
    skills: [],
    authorization: { countries: [], needsSponsorship: null, willingToRelocate: null },
    diversity: { gender: '', ethnicity: '', veteran: '', disability: '' },
    savedAnswers: [],
    confirmedFacts: [],
    defaultResumeId: null,
    autofilledFrom: null,
    updatedAt: new Date(0).toISOString(),
  };
}

export function seniorityFor(years: number, r: ResumeData): Seniority {
  const allIntern = r.experience.length > 0 && r.experience.every((e) => /\bintern(ship)?\b/i.test(`${e.jobTitle} ${e.company}`));
  if (!r.experience.length || allIntern) return years < 0.5 ? 'intern' : 'entry';
  if (years < 3) return 'entry';
  if (years < 7) return 'mid';
  return 'senior';
}

/** Rule-based profile suggestions from a resume (used without AI and as the base for AI). */
export function profileFromResumeRules(r: ResumeData) {
  const years = experienceYears(r);
  const titles = uniq([r.personalInfo.jobTitle, ...r.experience.map((e) => e.jobTitle)].map((t) => (t || '').replace(/\b(intern(ship)?|trainee)\b/gi, '').replace(/\s+/g, ' ').trim()).filter((t) => t.length > 2)).slice(0, 4);
  const current = r.experience.find((e) => e.current) || r.experience[0];
  const cityCountry = (r.personalInfo.location || '').split(',').map((x) => x.trim()).filter(Boolean);
  return {
    basics: {
      fullName: r.personalInfo.fullName || '',
      email: r.personalInfo.email || '',
      phone: r.personalInfo.phone || '',
      city: cityCountry[0] || '',
      country: cityCountry.length > 1 ? cityCountry[cityCountry.length - 1] : '',
      linkedin: r.personalInfo.linkedin || '',
      github: r.personalInfo.github || '',
      portfolio: r.personalInfo.website || '',
    },
    targetRoles: titles,
    skills: uniq(collectSkills(r)).slice(0, 60),
    yearsExperience: years,
    seniority: seniorityFor(years, r),
    currentTitle: current?.current ? current.jobTitle : '',
    currentCompany: current?.current ? current.company : '',
  };
}

export class ProfileService {
  constructor(private ctx: CareerContext) {}

  async get(owner: string): Promise<CareerProfile> {
    const doc = await this.ctx.store.docGet<ProfileDoc>('profiles', owner);
    if (!doc || doc.ownerUid !== owner) return blankProfile();
    const { id: _id, ownerUid: _o, ...profile } = doc;
    // Fill fields added in later versions.
    const base = blankProfile();
    return { ...base, ...profile, basics: { ...base.basics, ...profile.basics }, career: { ...base.career, ...profile.career }, authorization: { ...base.authorization, ...profile.authorization }, diversity: { ...base.diversity, ...profile.diversity } };
  }

  private async save(owner: string, profile: CareerProfile): Promise<CareerProfile> {
    const updatedAt = now();
    const doc: ProfileDoc = { ...profile, updatedAt, id: owner, ownerUid: owner };
    await this.ctx.store.docPut('profiles', doc);
    return { ...profile, updatedAt };
  }

  async update(owner: string, input: ProfileInput): Promise<CareerProfile> {
    const p = await this.get(owner);
    if (input.basics) p.basics = { ...p.basics, ...input.basics };
    if (input.career) p.career = { ...p.career, ...input.career };
    if (input.authorization) p.authorization = { ...p.authorization, ...input.authorization };
    if (input.diversity) p.diversity = { ...p.diversity, ...input.diversity };
    if (input.skills) p.skills = dedupeSkills(input.skills);
    if (input.defaultResumeId !== undefined) {
      if (input.defaultResumeId) await this.ctx.resumes.get(input.defaultResumeId, { uid: owner }); // must be yours
      p.defaultResumeId = input.defaultResumeId;
    }
    return this.save(owner, p);
  }

  async saveAnswer(owner: string, input: z.infer<typeof SavedAnswerInput>): Promise<CareerProfile> {
    const p = await this.get(owner);
    const key = normQuestion(input.question);
    const existing = p.savedAnswers.find((a) => (input.id && a.id === input.id) || normQuestion(a.question) === key);
    if (existing) Object.assign(existing, { question: input.question, answer: input.answer, updatedAt: now() });
    else p.savedAnswers.unshift({ id: newId(), question: input.question, answer: input.answer, updatedAt: now() });
    p.savedAnswers = p.savedAnswers.slice(0, 500);
    return this.save(owner, p);
  }

  async deleteAnswer(owner: string, id: string): Promise<CareerProfile> {
    const p = await this.get(owner);
    p.savedAnswers = p.savedAnswers.filter((a) => a.id !== id);
    return this.save(owner, p);
  }

  /** Records a statement you confirmed (e.g. a finished learning plan) and the skill as "learned". */
  async addConfirmedFact(owner: string, statement: string, skill?: string): Promise<CareerProfile> {
    const p = await this.get(owner);
    if (!p.confirmedFacts.includes(statement)) p.confirmedFacts.push(statement.slice(0, 600));
    if (skill && !p.skills.some((x) => x.name.toLowerCase() === skill.toLowerCase())) p.skills.push({ name: skill, source: 'learned' });
    else if (skill) p.skills = p.skills.map((x) => (x.name.toLowerCase() === skill.toLowerCase() && x.source === 'user' ? { ...x, source: 'learned' } : x));
    return this.save(owner, p);
  }

  /**
   * Fills the profile from one of your resumes. Only empty fields are filled;
   * resume skills are refreshed (skills you added or learned are kept).
   */
  async autofill(owner: string, resumeId: string): Promise<{ profile: CareerProfile; method: 'ai' | 'rule-based' }> {
    const view = await this.ctx.resumes.get(resumeId, { uid: owner });
    const resume = view.current;
    const rules = profileFromResumeRules(resume);
    let method: 'ai' | 'rule-based' = 'rule-based';
    let roles = rules.targetRoles;
    let seniority = rules.seniority;
    if (this.ctx.ai.available) {
      try {
        const text = resumeToPlainText(resume, { visibleOnly: true });
        const { data } = await runPrompt(this.ctx.ai, profileFromResume, { resumeText: text }, (d) => {
          if (!d.targetRoles.length) throw new Error('No target roles returned.');
        });
        roles = uniq([...data.targetRoles, ...rules.targetRoles]).slice(0, 5);
        seniority = data.seniority;
        method = 'ai';
      } catch (e) {
        logger.warn('profile.autofill.fallback', { reason: String((e as Error).message).slice(0, 120) });
      }
    }
    const p = await this.get(owner);
    const fill = <T extends Record<string, any>>(target: T, source: Partial<T>) => {
      for (const [k, v] of Object.entries(source)) if (v && !target[k]) (target as any)[k] = v;
    };
    fill(p.basics, rules.basics);
    if (!p.career.targetRoles.length) p.career.targetRoles = roles;
    if (p.career.yearsExperience === null) p.career.yearsExperience = rules.yearsExperience;
    if (!p.autofilledFrom) p.career.seniority = seniority;
    fill(p.career, { currentTitle: rules.currentTitle, currentCompany: rules.currentCompany });
    if (!p.career.locations.length && p.basics.city) p.career.locations = [p.basics.city];
    const kept = p.skills.filter((x) => x.source !== 'resume');
    p.skills = dedupeSkills([...rules.skills.map((name): ProfileSkill => ({ name, source: 'resume' })), ...kept]);
    if (!p.defaultResumeId) p.defaultResumeId = resumeId;
    p.autofilledFrom = { resumeId, at: now(), method };
    return { profile: await this.save(owner, p), method };
  }
}

function dedupeSkills(skills: ProfileSkill[]): ProfileSkill[] {
  const rank = { learned: 3, resume: 2, user: 1 } as const;
  const byKey = new Map<string, ProfileSkill>();
  for (const sk of skills) {
    const name = sk.name.trim();
    if (!name) continue;
    const key = canonicalKeyword(name);
    const prev = byKey.get(key);
    if (!prev || rank[sk.source] > rank[prev.source]) byKey.set(key, { name, source: sk.source });
  }
  return [...byKey.values()].slice(0, 200);
}

export function normQuestion(q: string): string {
  return q.toLowerCase().replace(/\*|\(required\)|\?/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Profile as plain text for prompts (no internal ids). */
export function profileToText(p: CareerProfile): string {
  const yn = (v: boolean | null) => (v === null ? 'not stated' : v ? 'yes' : 'no');
  return [
    `Name: ${p.basics.fullName}`,
    `Email: ${p.basics.email}`,
    `Phone: ${p.basics.phone}`,
    `Location: ${[p.basics.city, p.basics.country].filter(Boolean).join(', ')}`,
    `LinkedIn: ${p.basics.linkedin}`,
    `GitHub: ${p.basics.github}`,
    `Portfolio: ${p.basics.portfolio}`,
    `Target roles: ${p.career.targetRoles.join(', ')}`,
    `Years of professional experience: ${p.career.yearsExperience ?? 'not stated'}`,
    `Current title/company: ${[p.career.currentTitle, p.career.currentCompany].filter(Boolean).join(' at ') || 'not stated'}`,
    `Notice period: ${p.career.noticePeriod || 'not stated'}`,
    `Current salary: ${p.career.currentSalary || 'not stated'}`,
    `Expected salary: ${p.career.expectedSalary || 'not stated'}`,
    `Earliest start date: ${p.career.earliestStart || 'not stated'}`,
    `Preferred locations: ${p.career.locations.join(', ') || 'not stated'}`,
    `Work modes: ${p.career.workModes.join(', ')}`,
    `Authorised to work in: ${p.authorization.countries.join(', ') || 'not stated'}`,
    `Needs visa sponsorship: ${yn(p.authorization.needsSponsorship)}`,
    `Willing to relocate: ${yn(p.authorization.willingToRelocate)}`,
    `Confirmed facts: ${p.confirmedFacts.join(' | ') || 'none'}`,
  ].join('\n');
}
