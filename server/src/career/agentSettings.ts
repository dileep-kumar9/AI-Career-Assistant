import { z } from 'zod';
import type { AgentSettings } from '../../../shared/careerTypes.js';
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
    minMatch: 60,
    autoSubmitMin: 75,
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
  return next;
}
