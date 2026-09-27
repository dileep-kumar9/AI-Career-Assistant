import type { AgentRun, AgentSettings, AgentStatus, CareerProfile, JobApplication, LogEntry } from '../../../shared/careerTypes.js';
import type { ResumeData } from '../../../shared/resumeTypes.js';
import type { JDAnalysis } from '../../../shared/jdAnalyzer.js';
import { collectSkills } from '../../../shared/normalize.js';
import type { DocBase } from '../db/store.js';
import { conflict } from '../errors.js';
import { logger } from '../logger.js';
import { type CareerContext, hashOf, newId, now } from './context.js';
import type { ProfileService } from './profile.js';
import type { ApplicationService } from './applications.js';
import { type AgentSettingsInput, getAgentSettings, mergeAgentSettings, saveAgentSettings } from './agentSettings.js';
import { matchResume } from './matching.js';
import { API_SOURCES, linkedinPosting } from './jobs/apiSources.js';
import { searchIndeed, searchNaukri } from './jobs/browserSources.js';
import { readJobLink } from './jobs/readers.js';
import { type JobPosting, type SearchQuery, dedupeKeys } from './jobs/types.js';
import type { BrowserManager } from './automation/browser.js';

/**
 * The Auto Job Agent. While ON it runs every `runEveryMinutes`:
 *   search enabled sources → drop seen/applied/excluded jobs → read each JD →
 *   match against your resume → tailor matches → apply (auto mode, within the
 *   daily limits) or leave them "Ready for review" → record everything.
 * Every JD it reads is kept (aca_jobs_seen) for the skill-gap report.
 */

type RunDoc = AgentRun & DocBase;

export interface SeenJob extends DocBase {
  key: string;
  fuzzy: string;
  source: string;
  title: string;
  company: string;
  url: string;
  score: number | null;
  analysis: Pick<JDAnalysis, 'jobTitle' | 'requiredSkills' | 'preferredSkills' | 'atsKeywords' | 'certifications' | 'minYears' | 'educationLevel' | 'tools' | 'responsibilities' | 'experienceRequirements' | 'education' | 'industryKeywords' | 'company' | 'source'> | null;
  applicationId: string | null;
  seenAt: string;
}

const MAX_NEW_PER_RUN = 30;
const SEEN_RETENTION_DAYS = 60;

/** Search keywords: target roles (settings → profile → resume titles), skills per "Search by". */
export function buildQuery(settings: AgentSettings, profile: CareerProfile, resume: ResumeData | null): SearchQuery {
  const resumeSkills = resume ? collectSkills(resume) : profile.skills.filter((s) => s.source !== 'user').map((s) => s.name);
  const ownSkills = [...settings.skills, ...profile.skills.filter((s) => s.source !== 'resume').map((s) => s.name)];
  const skills = settings.searchBy === 'resume' ? resumeSkills : settings.searchBy === 'skills' ? ownSkills : [...new Set([...ownSkills, ...resumeSkills])];
  let keywords = settings.targetRoles.length ? settings.targetRoles : profile.career.targetRoles;
  if (!keywords.length && resume) keywords = [resume.personalInfo.jobTitle, ...resume.experience.map((e) => e.jobTitle)].filter(Boolean).slice(0, 3);
  if (!keywords.length) keywords = skills.slice(0, 3);
  return {
    keywords: [...new Set(keywords.map((k) => k.trim()).filter(Boolean))].slice(0, 5),
    skills: [...new Set(skills)].slice(0, 30),
    locations: settings.locations.length ? settings.locations : profile.career.locations,
    remoteOk: settings.remoteOk,
    postedWithinDays: settings.postedWithinDays,
  };
}

/** Title / company / job-type / experience filters. Returns a reason when the job should be skipped. */
export function excludeReason(p: Pick<JobPosting, 'title' | 'company'>, s: AgentSettings): string | null {
  const title = p.title.toLowerCase();
  const company = p.company.toLowerCase();
  const co = s.excludeCompanies.find((c) => c && company.includes(c.toLowerCase()));
  if (co) return `Excluded company (${co})`;
  const word = s.excludeTitleWords.find((w) => w && new RegExp(`(^|[^a-z])${w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(title));
  if (word) return `Title contains “${word}”`;
  const intern = /\bintern(ship)?\b|\btrainee\b|\bapprentice/i.test(p.title);
  if (intern && !s.jobTypes.includes('internship')) return 'Internship (not in your job types)';
  if (!intern && s.jobTypes.length === 1 && s.jobTypes[0] === 'internship') return 'Not an internship';
  return null;
}

export class AgentService {
  private timers = new Map<string, NodeJS.Timeout>();
  private nextRun = new Map<string, number>();
  private running = new Map<string, { stop: boolean; phase: string; runId: string }>();

  constructor(
    private ctx: CareerContext,
    private apps: ApplicationService,
    private profiles: ProfileService,
    private browser: BrowserManager,
  ) {}

  /** Re-schedules agents that were ON when the server stopped. */
  async init() {
    const all = await this.ctx.store.docListAll<AgentSettings & DocBase>('agent_settings').catch(() => []);
    for (const s of all) if (s.enabled) this.schedule(s.ownerUid, 60_000);
  }

  shutdown() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    for (const r of this.running.values()) r.stop = true;
  }

  settings(owner: string) {
    return getAgentSettings(this.ctx.store, owner);
  }

  async updateSettings(owner: string, input: AgentSettingsInput): Promise<AgentSettings> {
    const cur = await this.settings(owner);
    if (input.resumeId) await this.ctx.resumes.get(input.resumeId, { uid: owner });
    const next = await saveAgentSettings(this.ctx.store, owner, mergeAgentSettings(cur, input));
    if (next.enabled) this.schedule(owner, Math.max(this.msUntilNext(owner), 5_000));
    return next;
  }

  async start(owner: string): Promise<AgentStatus> {
    const s = await this.settings(owner);
    const sources = Object.values(s.sources).filter((x) => x.enabled);
    if (!sources.length) throw conflict('Turn on at least one job source first.');
    await saveAgentSettings(this.ctx.store, owner, { ...s, enabled: true });
    this.schedule(owner, 1_000);
    return this.status(owner);
  }

  async stop(owner: string): Promise<AgentStatus> {
    const s = await this.settings(owner);
    await saveAgentSettings(this.ctx.store, owner, { ...s, enabled: false });
    clearTimeout(this.timers.get(owner));
    this.timers.delete(owner);
    this.nextRun.delete(owner);
    const r = this.running.get(owner);
    if (r) r.stop = true;
    return this.status(owner);
  }

  async runNow(owner: string): Promise<AgentStatus> {
    if (this.running.has(owner)) throw conflict('The agent is already running.');
    void this.run(owner, 'manual');
    await new Promise((r) => setTimeout(r, 200));
    return this.status(owner);
  }

  private msUntilNext(owner: string) {
    const t = this.nextRun.get(owner);
    return t ? t - Date.now() : 0;
  }

  private schedule(owner: string, delayMs: number) {
    clearTimeout(this.timers.get(owner));
    this.nextRun.set(owner, Date.now() + delayMs);
    const t = setTimeout(async () => {
      this.timers.delete(owner);
      const s = await this.settings(owner).catch(() => null);
      if (!s?.enabled) return;
      if (!this.running.has(owner)) await this.run(owner, 'schedule').catch((e) => logger.warn('agent.run.failed', { error: String(e?.message || e).slice(0, 200) }));
      const again = await this.settings(owner).catch(() => null);
      if (again?.enabled) this.schedule(owner, again.runEveryMinutes * 60_000);
    }, delayMs);
    t.unref?.();
    this.timers.set(owner, t);
  }

  async status(owner: string): Promise<AgentStatus> {
    const [s, runs, apps] = await Promise.all([this.settings(owner), this.runs(owner, 1), this.apps.list(owner)]);
    const today = await this.apps.todayCounts(owner, apps);
    const r = this.running.get(owner);
    return {
      enabled: s.enabled,
      running: !!r,
      phase: r?.phase || (s.enabled ? 'Waiting for the next run' : 'Off'),
      nextRunAt: s.enabled && this.nextRun.get(owner) ? new Date(this.nextRun.get(owner)!).toISOString() : null,
      lastRun: runs[0] || null,
      today: { applied: today.applied, linkedin: today.linkedin, limit: s.dailyLimit, linkedinLimit: s.linkedinDailyLimit },
      browser: this.browser.status(),
    };
  }

  async runs(owner: string, limit = 20): Promise<AgentRun[]> {
    const docs = await this.ctx.store.docList<RunDoc>('agent_runs', owner, limit);
    return docs.map(({ ownerUid: _o, ...r }) => r);
  }

  async seen(owner: string, days = 30): Promise<SeenJob[]> {
    const since = Date.now() - days * 86_400_000;
    return (await this.ctx.store.docList<SeenJob>('jobs_seen', owner, 5000)).filter((j) => Date.parse(j.seenAt) >= since);
  }

  // ------------------------------------------------------------------ one run

  async run(owner: string, trigger: AgentRun['trigger']): Promise<AgentRun> {
    const state = { stop: false, phase: 'Starting', runId: newId() };
    this.running.set(owner, state);
    const run: RunDoc = { id: state.runId, ownerUid: owner, trigger, startedAt: now(), finishedAt: null, status: 'running', counts: { searched: 0, found: 0, new: 0, matched: 0, prepared: 0, applied: 0, needsAttention: 0, skipped: 0 }, log: [], updatedAt: now() };
    const say = async (message: string, level: LogEntry['level'] = 'info') => {
      run.log.push({ at: now(), level, message: message.slice(0, 400) });
      state.phase = message.slice(0, 120);
      run.updatedAt = now();
      await this.ctx.store.docPut('agent_runs', { ...run, log: run.log.slice(-300) }).catch(() => undefined);
    };
    const stopped = () => state.stop;
    try {
      const settings = await this.settings(owner);
      const profile = await this.profiles.get(owner);
      const resumeId = await this.apps.baseResumeId(owner, settings.resumeId);
      if (!resumeId) {
        await say('No resume to apply with. Upload one in the Resume Builder or pick one in the agent settings.', 'error');
        run.status = 'failed';
        return this.finish(run);
      }
      const base = await this.ctx.resumes.get(resumeId, { uid: owner });
      const q = buildQuery(settings, profile, base.current);
      await say(`Searching for ${q.keywords.join(', ') || 'your skills'}${q.locations.length ? ` in ${q.locations.join(', ')}` : ''}${q.remoteOk ? ' (remote OK)' : ''}.`);

      // 1. search
      const found: JobPosting[] = [];
      const src = settings.sources;
      const tasks: Array<[string, () => Promise<JobPosting[]>]> = [];
      if (src.greenhouse.enabled && src.greenhouse.boards.length) tasks.push(['Greenhouse', () => API_SOURCES.greenhouse.search(q, src.greenhouse, { stopped })]);
      if (src.lever.enabled && src.lever.companies.length) tasks.push(['Lever', () => API_SOURCES.lever.search(q, src.lever, { stopped })]);
      if (src.ashby.enabled && src.ashby.orgs.length) tasks.push(['Ashby', () => API_SOURCES.ashby.search(q, src.ashby, { stopped })]);
      if (src.workday.enabled && src.workday.sites.length) tasks.push(['Workday', () => API_SOURCES.workday.search(q, src.workday, { stopped })]);
      if (src.arbeitnow.enabled) tasks.push(['Arbeitnow', () => API_SOURCES.arbeitnow.search(q, {}, { stopped })]);
      if (src.remoteok.enabled) tasks.push(['Remote OK', () => API_SOURCES.remoteok.search(q, {}, { stopped })]);
      if (src.linkedin.enabled) tasks.push(['LinkedIn', () => API_SOURCES.linkedin.search(q, {}, { stopped })]);
      if (src.naukri.enabled) tasks.push(['Naukri', () => searchNaukri(this.browser, q, stopped)]);
      if (src.indeed.enabled) tasks.push(['Indeed', () => searchIndeed(this.browser, q, src.indeed.domain, stopped)]);
      if (!tasks.length) await say('No sources with companies/boards configured. Add Greenhouse boards, Lever companies, Ashby orgs or turn on a portal.', 'warn');
      for (const [name, fn] of tasks) {
        if (stopped()) break;
        state.phase = `Searching ${name}…`;
        try {
          const jobs = await fn();
          run.counts.searched++;
          found.push(...jobs);
          await say(`${name}: ${jobs.length} matching job${jobs.length === 1 ? '' : 's'}.`);
        } catch (e) {
          await say(`${name}: ${String((e as Error).message).slice(0, 200)}`, 'warn');
        }
      }
      run.counts.found = found.length;

      // 2. dedupe + filters
      const apps = await this.apps.list(owner);
      const seenDocs = await this.ctx.store.docList<SeenJob>('jobs_seen', owner, 10_000);
      const seenKeys = new Set(seenDocs.flatMap((d) => [d.key, d.fuzzy]));
      const fresh: JobPosting[] = [];
      const batchKeys = new Set<string>();
      for (const p of found) {
        const k = dedupeKeys(p);
        if (seenKeys.has(k.primary) || seenKeys.has(k.fuzzy) || batchKeys.has(k.primary) || batchKeys.has(k.fuzzy)) continue;
        if (await this.apps.findDuplicate(owner, p, apps)) continue;
        batchKeys.add(k.primary);
        batchKeys.add(k.fuzzy);
        const why = excludeReason(p, settings);
        if (why) {
          run.counts.skipped++;
          await this.remember(owner, p, null, null, null);
          continue;
        }
        fresh.push(p);
      }
      run.counts.new = fresh.length;
      await say(`${fresh.length} new job${fresh.length === 1 ? '' : 's'} after removing ones already seen, applied or excluded.`);

      // 3. read → match → tailor → apply

      for (const p of fresh.slice(0, MAX_NEW_PER_RUN)) {
        if (stopped()) break;
        let posting = p;
        try {
          if (posting.description.length < 200) {
            state.phase = `Reading ${posting.title} at ${posting.company}…`;
            const full = posting.source === 'linkedin' ? await linkedinPosting(posting.externalId) : await readJobLink(posting.jobUrl, (u) => this.browser.readPage(u));
            if (full) posting = { ...posting, ...full, source: posting.source, externalId: posting.externalId, company: full.company || posting.company, title: full.title || posting.title };
          }
        } catch {
          /* keep the short version */
        }
        if (posting.description.length < 200) {
          run.counts.skipped++;
          await this.remember(owner, posting, null, null, null);
          continue;
        }
        const m = matchResume(base.current, posting.description, { weights: this.ctx.config.atsWeights, original: base.original });
        const years = m.analysis.minYears;
        const tooSenior = settings.experienceMax !== null && typeof years === 'number' && years > settings.experienceMax + 1;
        if (m.score < settings.minMatch || tooSenior) {
          run.counts.skipped++;
          await this.remember(owner, posting, m.score, m.analysis, null);
          continue;
        }
        run.counts.matched++;
        const app = await this.apps.createFromPosting(owner, posting, { mode: settings.mode, match: { score: m.score, matched: m.matched, missing: m.missing, analysis: m.analysis } });
        await this.remember(owner, posting, m.score, m.analysis, app.id);
        await say(`Match ${m.score}: ${posting.title} at ${posting.company}. Tailoring…`);
        const prepared = await this.apps.prepare(owner, app.id, resumeId);
        if (prepared.stage !== 'ready') {
          run.counts.needsAttention++;
          continue;
        }
        run.counts.prepared++;
        const fresh2 = await this.settings(owner);
        if (fresh2.mode === 'auto' && (prepared.atsAfter ?? prepared.matchScore ?? 0) >= fresh2.autoSubmitMin && !stopped()) {
          state.phase = `Applying: ${posting.title} at ${posting.company}…`;
          const done = await this.apps.apply(owner, app.id, { submit: true, trigger: 'agent' });
          if (done.stage === 'applied') {
            run.counts.applied++;

            await say(`Applied: ${posting.title} at ${posting.company}.`);
          } else if (done.stage === 'ready') {
            await say(done.reason, 'warn');
            if (/daily limit/i.test(done.reason) && !/LinkedIn/.test(done.reason)) break;
          } else {
            run.counts.needsAttention++;
            await say(`Needs you: ${posting.title} at ${posting.company} — ${done.reason}`, 'warn');
          }
        }
      }
      await this.cleanupSeen(owner, seenDocs);
      run.status = stopped() ? 'stopped' : 'done';
      await say(
        `Finished: ${run.counts.new} new, ${run.counts.matched} matched, ${run.counts.prepared} tailored, ${run.counts.applied} applied${settings.mode === 'review' && run.counts.prepared ? ' (waiting for your review)' : ''}, ${run.counts.needsAttention} need you.`,
      );
      return this.finish(run);
    } catch (e) {
      run.status = 'failed';
      await say(`The run failed: ${String((e as Error).message).slice(0, 300)}`, 'error');
      return this.finish(run);
    } finally {
      this.running.delete(owner);
    }
  }

  private async finish(run: RunDoc): Promise<AgentRun> {
    run.finishedAt = now();
    run.updatedAt = now();
    await this.ctx.store.docPut('agent_runs', run).catch(() => undefined);
    const { ownerUid: _o, ...r } = run;
    return r;
  }

  private async remember(owner: string, p: JobPosting, score: number | null, analysis: JDAnalysis | null, applicationId: string | null) {
    const k = dedupeKeys(p);
    const doc: SeenJob = {
      id: `${hashOf(owner)}_${k.primary.replace(/[^A-Za-z0-9]/g, '')}`,
      ownerUid: owner,
      key: k.primary,
      fuzzy: k.fuzzy,
      source: p.source,
      title: p.title,
      company: p.company,
      url: p.jobUrl,
      score,
      analysis: analysis
        ? {
            jobTitle: analysis.jobTitle,
            company: analysis.company,
            requiredSkills: analysis.requiredSkills,
            preferredSkills: analysis.preferredSkills,
            atsKeywords: analysis.atsKeywords,
            certifications: analysis.certifications,
            minYears: analysis.minYears,
            educationLevel: analysis.educationLevel,
            tools: analysis.tools,
            responsibilities: analysis.responsibilities.slice(0, 12),
            experienceRequirements: analysis.experienceRequirements.slice(0, 6),
            education: analysis.education,
            industryKeywords: analysis.industryKeywords,
            source: analysis.source,
          }
        : null,
      applicationId,
      seenAt: now(),
      updatedAt: now(),
    };
    await this.ctx.store.docPut('jobs_seen', doc);
  }

  private async cleanupSeen(owner: string, docs: SeenJob[]) {
    const cutoff = Date.now() - SEEN_RETENTION_DAYS * 86_400_000;
    for (const d of docs) if (Date.parse(d.seenAt) < cutoff && d.ownerUid === owner) await this.ctx.store.docDelete('jobs_seen', d.id).catch(() => undefined);
  }
}

export type { JobApplication };
