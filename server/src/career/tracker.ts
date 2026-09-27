import type { JobApplication } from '../../../shared/careerTypes.js';
import { STAGE_LABELS, TRACKER_STAGES } from '../../../shared/careerTypes.js';
import { emailDraft, runPrompt } from '../ai/prompts/index.js';
import type { CareerContext } from './context.js';
import type { ApplicationService } from './applications.js';
import type { ProfileService } from './profile.js';

/** Tracker views on top of applications: stats, reminders, CSV export and email drafts. */

const RESPONDED = new Set(['interview', 'offer', 'rejected']);

export interface TrackerStats {
  total: number;
  byStage: Record<string, number>;
  appliedPerWeek: Array<{ week: string; applied: number }>;
  bySource: Array<{ source: string; applied: number; responses: number; interviews: number; responseRate: number }>;
  byMatch: Array<{ band: string; applied: number; responses: number; interviews: number; responseRate: number }>;
  responseRate: number;
  interviewRate: number;
}

function weekStart(iso: string): string {
  const d = new Date(iso);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}

export function computeStats(apps: JobApplication[]): TrackerStats {
  const byStage: Record<string, number> = {};
  for (const a of apps) byStage[a.stage] = (byStage[a.stage] || 0) + 1;
  const applied = apps.filter((a) => a.appliedAt && TRACKER_STAGES.includes(a.stage as any));
  const weeks = new Map<string, number>();
  for (const a of applied) weeks.set(weekStart(a.appliedAt!), (weeks.get(weekStart(a.appliedAt!)) || 0) + 1);
  const rate = (list: JobApplication[]) => ({
    applied: list.length,
    responses: list.filter((a) => RESPONDED.has(a.stage)).length,
    interviews: list.filter((a) => a.stage === 'interview' || a.stage === 'offer').length,
    responseRate: list.length ? Math.round((list.filter((a) => RESPONDED.has(a.stage)).length / list.length) * 100) : 0,
  });
  const sources = [...new Set(applied.map((a) => a.source))];
  const bands: Array<[string, (s: number | null) => boolean]> = [
    ['80–100', (s) => s !== null && s >= 80],
    ['60–79', (s) => s !== null && s >= 60 && s < 80],
    ['< 60', (s) => s !== null && s < 60],
    ['unknown', (s) => s === null],
  ];
  const total = rate(applied);
  return {
    total: apps.length,
    byStage,
    appliedPerWeek: [...weeks.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-12).map(([week, n]) => ({ week, applied: n })),
    bySource: sources.map((source) => ({ source, ...rate(applied.filter((a) => a.source === source)) })).sort((a, b) => b.applied - a.applied),
    byMatch: bands.map(([band, test]) => ({ band, ...rate(applied.filter((a) => test(a.atsAfter ?? a.matchScore))) })).filter((b) => b.applied > 0),
    responseRate: total.responseRate,
    interviewRate: total.applied ? Math.round((total.interviews / total.applied) * 100) : 0,
  };
}

/** Follow-ups due (applied, no response yet, follow-up date passed) and upcoming interviews. */
export function reminders(apps: JobApplication[], at = Date.now()) {
  return {
    followUps: apps
      .filter((a) => a.stage === 'applied' && a.followUpAt && Date.parse(a.followUpAt) <= at)
      .map((a) => ({ id: a.id, jobTitle: a.jobTitle, company: a.company, appliedAt: a.appliedAt, followUpAt: a.followUpAt })),
    interviews: apps
      .filter((a) => a.stage === 'interview' && a.interviewAt && Date.parse(a.interviewAt) >= at - 86_400_000)
      .sort((a, b) => Date.parse(a.interviewAt!) - Date.parse(b.interviewAt!))
      .map((a) => ({ id: a.id, jobTitle: a.jobTitle, company: a.company, interviewAt: a.interviewAt })),
    needsAttention: apps.filter((a) => a.stage === 'needs_attention').length,
    readyForReview: apps.filter((a) => a.stage === 'ready').length,
  };
}

/** CSV with spreadsheet-formula injection neutralised (job titles come from websites). */
export function toCsv(apps: JobApplication[]): string {
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ['Job title', 'Company', 'Location', 'Source', 'Stage', 'Applied at', 'Match', 'ATS before', 'ATS after', 'Interview at', 'Follow up at', 'Job link', 'Notes'];
  const rows = apps.map((a) => [a.jobTitle, a.company, a.location, a.source, STAGE_LABELS[a.stage], a.appliedAt?.slice(0, 10), a.matchScore, a.atsBefore, a.atsAfter, a.interviewAt, a.followUpAt?.slice(0, 10), a.jobUrl, a.notes]);
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
}

export class TrackerService {
  constructor(
    private ctx: CareerContext,
    private apps: ApplicationService,
    private profiles: ProfileService,
  ) {}

  async overview(owner: string) {
    const apps = await this.apps.list(owner);
    return { stats: computeStats(apps), reminders: reminders(apps) };
  }

  async csv(owner: string) {
    return toCsv(await this.apps.list(owner));
  }

  /** Follow-up / thank-you / withdrawal email for you to copy and send (nothing is sent automatically). */
  async emailDraft(owner: string, id: string, kind: 'follow_up' | 'thank_you' | 'withdraw'): Promise<{ subject: string; body: string; method: 'ai' | 'rule-based' }> {
    const a = await this.apps.get(owner, id);
    const p = await this.profiles.get(owner);
    const name = p.basics.fullName || '[Your name]';
    if (this.ctx.ai.available) {
      try {
        const { data } = await runPrompt(this.ctx.ai, emailDraft, { kind, candidateName: name, role: a.jobTitle, company: a.company, appliedAt: a.appliedAt?.slice(0, 10) || '', notes: a.notes });
        return { ...data, method: 'ai' };
      } catch {
        /* template */
      }
    }
    const role = a.jobTitle || 'the open role';
    const co = a.company || 'your company';
    const templates = {
      follow_up: { subject: `Following up on my application: ${role}`, body: `Dear [Name],\n\nI applied for the ${role} position at ${co}${a.appliedAt ? ` on ${a.appliedAt.slice(0, 10)}` : ''} and wanted to check whether there is any update on the next steps. I remain very interested in the role and would be glad to share anything else you need.\n\nThank you for your time.\n\nBest regards,\n${name}` },
      thank_you: { subject: `Thank you — ${role} interview`, body: `Dear [Name],\n\nThank you for taking the time to speak with me about the ${role} role at ${co}. I enjoyed learning more about the team and the work, and I am excited about the opportunity.\n\nPlease let me know if I can provide anything else.\n\nBest regards,\n${name}` },
      withdraw: { subject: `Withdrawing my application: ${role}`, body: `Dear [Name],\n\nThank you for considering me for the ${role} position at ${co}. I would like to withdraw my application at this time. I appreciate your time and hope our paths cross again.\n\nBest regards,\n${name}` },
    };
    return { ...templates[kind], method: 'rule-based' };
  }
}
