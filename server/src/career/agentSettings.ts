import { z } from 'zod';
import type { AgentSettings } from '../../../shared/careerTypes.js';
import type { ExperienceRange } from '../../../shared/experience.js';
import type { DocBase, Store } from '../db/store.js';
import { now } from './context.js';

/** Job-agent settings (one document per owner). Defaults are deliberately conservative. */

export type AgentSettingsDoc = AgentSettings & DocBase;

export function defaultAgentSettings(): AgentSettings {
  return {
    enabled: false,
    searchBy: 'resume',
    resumeId: null,
    skills: [],
    targetRoles: [],
    locations: [],
    remoteOk: true,
    experienceMin: null,
    experienceMax: null,
    jobTypes: ['full-time'],
    postedWithinDays: 7,
    sources: {
      greenhouse: { enabled: true, boards: [] },
      lever: { enabled: true, companies: [] },
      ashby: { enabled: true, orgs: [] },
      workday: { enabled: false, sites: [] },
      arbeitnow: { enabled: false },
      remoteok: { enabled: false },
      naukri: { enabled: false },
      indeed: { enabled: false, domain: 'in.indeed.com' },
      // Off by default: automating LinkedIn is against its terms and can get accounts restricted.
      linkedin: { enabled: false },
    },
    excludeCompanies: [],
    excludeTitleWords: ['senior', 'sr.', 'lead', 'principal', 'director', 'manager'],
    mode: 'review',
    minMatch: 50,
    autoSubmitMin: 70,
    autoApprove: true,
    reviewAnswers: true,
    dailyLimit: 25,
    linkedinDailyLimit: 10,
    runEveryMinutes: 60,
    dryRun: false,
    coverLetters: true,
    updatedAt: new Date(0).toISOString(),
  };
}

const s = (max = 120) => z.string().trim().max(max);
const list = (max: number, len = 120) => z.array(s(len)).max(max).transform((a) => [...new Set(a.filter(Boolean))]);
const slugList = (max: number) => z.array(z.string().trim().max(300)).max(max).transform((a) => [...new Set(a.filter(Boolean))]);

export const AgentSettingsInput = z
  .object({
    searchBy: z.enum(['resume', 'skills', 'both']),
    resumeId: z.string().uuid().nullable(),
    skills: list(60, 80),
    targetRoles: list(10),
    locations: list(15),
    remoteOk: z.boolean(),
    experienceMin: z.number().int().min(0).max(40).nullable(),
    experienceMax: z.number().int().min(0).max(40).nullable(),
    jobTypes: z.array(z.enum(['full-time', 'part-time', 'contract', 'internship'])).max(4),
    postedWithinDays: z.number().int().min(0).max(60),
    sources: z
      .object({
        greenhouse: z.object({ enabled: z.boolean(), boards: slugList(40) }),
        lever: z.object({ enabled: z.boolean(), companies: slugList(40) }),
        ashby: z.object({ enabled: z.boolean(), orgs: slugList(40) }),
        workday: z.object({ enabled: z.boolean(), sites: slugList(15) }),
        arbeitnow: z.object({ enabled: z.boolean() }),
        remoteok: z.object({ enabled: z.boolean() }),
        naukri: z.object({ enabled: z.boolean() }),
        indeed: z.object({ enabled: z.boolean(), domain: z.string().trim().regex(/^([a-z]{2}\.)?indeed\.[a-z.]{2,10}$/i, 'Use a domain like in.indeed.com') }),
        linkedin: z.object({ enabled: z.boolean() }),
      })
      .partial(),
    excludeCompanies: list(100),
    excludeTitleWords: list(50, 40),
    mode: z.enum(['review', 'auto']),
    minMatch: z.number().int().min(0).max(100),
    autoSubmitMin: z.number().int().min(0).max(100),
    autoApprove: z.boolean(),
    reviewAnswers: z.boolean(),
    dailyLimit: z.number().int().min(1).max(100),
    linkedinDailyLimit: z.number().int().min(0).max(25),
    runEveryMinutes: z.number().int().min(15).max(24 * 60),
    dryRun: z.boolean(),
    coverLetters: z.boolean(),
  })
  .partial();
export type AgentSettingsInput = z.infer<typeof AgentSettingsInput>;

export async function getAgentSettings(store: Store, owner: string): Promise<AgentSettings> {
  const doc = await store.docGet<AgentSettingsDoc>('agent_settings', owner);
  const base = defaultAgentSettings();
  if (!doc || doc.ownerUid !== owner) return base;
  const { id: _id, ownerUid: _o, ...rest } = doc;
  return { ...base, ...rest, sources: { ...base.sources, ...rest.sources } };
}

export async function saveAgentSettings(store: Store, owner: string, settings: AgentSettings): Promise<AgentSettings> {
  const updatedAt = now();
  await store.docPut<AgentSettingsDoc>('agent_settings', { ...settings, updatedAt, id: owner, ownerUid: owner });
  return { ...settings, updatedAt };
}

export function mergeAgentSettings(current: AgentSettings, input: AgentSettingsInput): AgentSettings {
  const next: AgentSettings = { ...current, ...input, sources: { ...current.sources } } as AgentSettings;
  for (const [k, v] of Object.entries(input.sources || {})) (next.sources as any)[k] = { ...(current.sources as any)[k], ...v };
  if (next.autoSubmitMin < next.minMatch) next.autoSubmitMin = next.minMatch;
  if (next.experienceMin !== null && next.experienceMax !== null && next.experienceMin > next.experienceMax) [next.experienceMin, next.experienceMax] = [next.experienceMax, next.experienceMin];
  if (next.experienceMax === null) next.experienceMin = null;
  return next;
}

/** The experience range to search with: the agent setting, else derived from the Career Profile. */
export function effectiveRange(s: AgentSettings, profileYears: number | null): ExperienceRange | null {
  if (s.experienceMax !== null) return { min: s.experienceMin ?? 0, max: s.experienceMax };
  if (profileYears === null) return null;
  const y = Math.floor(profileYears);
  return y <= 0 ? { min: 0, max: 0 } : { min: Math.max(0, y - 1), max: y + 1 };
}

/**
 * What to do with a tailored job:
 *  skip   — match or tailored ATS below minMatch (default 50)
 *  apply  — auto mode, or both scores >= autoSubmitMin (default 70) with auto-approve on
 *  review — everything else waits for your approval
 */
export function decide(s: Pick<AgentSettings, 'minMatch' | 'autoSubmitMin' | 'autoApprove' | 'mode'>, match: number | null, ats: number | null, forceMode?: 'review' | 'auto'): 'skip' | 'apply' | 'review' {
  const m = match ?? 0;
  const a = ats ?? m;
  if (m < s.minMatch || a < s.minMatch) return 'skip';
  if ((forceMode ?? s.mode) === 'auto') return 'apply';
  if (s.autoApprove && m >= s.autoSubmitMin && a >= s.autoSubmitMin) return 'apply';
  return 'review';
}
