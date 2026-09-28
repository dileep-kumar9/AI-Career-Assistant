import os from 'node:os';
import { logger } from '../logger.js';
import type { CareerModules } from './index.js';

/** Heartbeat and folder-sync spacing: keeps Firestore reads/writes low. */
const BEAT_MS = 60_000;
const FOLDER_SYNC_MS = 5 * 60_000;

/**
 * The runner: when the app is hosted (Vercel) it has no browser, so this
 * process on your computer does the browser work for the accounts listed in
 * RUNNER_OWNERS, using your logged-in Chrome profile:
 *
 *   - applications queued by the hosted app (apply, or read a login-only page)
 *   - the Auto Job Agent (ON/OFF and "Run once now" are switched in the hosted app)
 *   - interview practice folders (written to this computer's data folder)
 *
 * It writes a heartbeat so the hosted app can show whether it is online.
 */
export class Runner {
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private busy = new Set<string>();
  private lastFolderSync = new Map<string, string>();
  private lastBeat = new Map<string, number>();
  private lastFolderAt = new Map<string, number>();
  /** Owners whose whole queue was checked since start-up (a marker can be missed while the runner was off). */
  private scanned = new Set<string>();
  private host = os.hostname().slice(0, 60);

  constructor(private m: CareerModules) {}

  get owners() {
    return this.m.ctx.config.runner.owners;
  }

  start() {
    if (!this.owners.length) {
      logger.warn('runner.no_owners', { hint: 'Set RUNNER_OWNERS to your user id (shown on the Auto Job Agent page of the hosted app).' });
      return;
    }
    logger.info('runner.started', { owners: this.owners.length, pollMs: this.m.ctx.config.runner.pollMs });
    const loop = async () => {
      if (this.stopped) return;
      await this.tick().catch((e) => logger.warn('runner.tick.failed', { error: String(e?.message || e).slice(0, 200) }));
      if (!this.stopped) this.timer = setTimeout(loop, this.m.ctx.config.runner.pollMs);
    };
    void loop();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  /** One poll: heartbeat, agent switch, queued applications, interview folders. */
  async tick() {
    for (const owner of this.owners) {
      const t = Date.now();
      if (t - (this.lastBeat.get(owner) || 0) >= BEAT_MS) {
        await this.m.agent.beat(owner, this.host);
        this.lastBeat.set(owner, t);
      }
      await this.m.agent.syncSchedule(owner);
      await this.m.agent.takeRunRequest(owner);
      // The marker is only taken when free to act on it (work queued meanwhile waits for the next poll).
      if (!this.busy.has(owner) && (!this.scanned.has(owner) || (await this.m.apps.takeQueueMarker(owner)))) {
        this.scanned.add(owner);
        // Applying takes minutes: keep polling (and beating) while it runs.
        this.busy.add(owner);
        void this.m.apps
          .runQueued(owner, () => this.stopped)
          .then((n) => n && logger.info('runner.handled', { count: n }))
          .catch((e) => logger.warn('runner.queue.failed', { error: String(e?.message || e).slice(0, 200) }))
          .finally(() => this.busy.delete(owner));
      }
      if (t - (this.lastFolderAt.get(owner) || 0) >= FOLDER_SYNC_MS) {
        const started = new Date().toISOString();
        await this.m.sessions.syncFolders(owner, this.lastFolderSync.get(owner) || null);
        this.lastFolderSync.set(owner, started);
        this.lastFolderAt.set(owner, t);
      }
    }
  }
}
