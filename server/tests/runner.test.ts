import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { JD_TEXT, PASTED_RESUME, makeApp } from './helpers.js';
import { loadConfig } from '../src/config.js';
import { Runner } from '../src/career/runner.js';
import type { JobPosting } from '../src/career/jobs/types.js';

const as = (uid: string) => ({ 'X-Firebase-Auth': `user:${uid}` });
const post: JobPosting = { source: 'greenhouse', externalId: 'n/9', title: 'Cloud Support Engineer', company: 'Northwind Systems', location: '', remote: false, description: JD_TEXT, jobUrl: 'https://job-boards.greenhouse.io/n/jobs/9', applyUrl: 'https://job-boards.greenhouse.io/n/jobs/9', postedAt: null };

describe('hosted (Vercel) config', () => {
  it('detects Vercel, keeps data in /tmp and only runs a runner outside serverless', () => {
    const hosted = loadConfig({ VERCEL: '1', FIREBASE_PROJECT_ID: 'p' } as any);
    expect(hosted.serverless).toBe(true);
    expect(hosted.dataDir.replace(/\\/g, '/')).toMatch(/\/tmp\/aca-data$/);
    expect(loadConfig({ VERCEL: '1', ACA_RUNNER: 'true' } as any).runner.enabled).toBe(false);
    const runner = loadConfig({ ACA_RUNNER: 'true', RUNNER_OWNERS: ' uid1, uid2 ' } as any);
    expect(runner.runner).toMatchObject({ enabled: true, owners: ['uid1', 'uid2'] });
  });
});

describe('runner queue', () => {
  it('hosted app queues applying for the runner; the runner picks it up, and only for its owners', async () => {
    const t = await makeApp();
    await request(t.app).post('/api/resumes/paste').set(as('carol')).send({ text: PASTED_RESUME }).expect(201);
    const app = await t.career.apps.createFromPosting('carol', post, { mode: 'review' });
    await t.career.apps.prepare('carol', app.id, null, { force: true });

    // Hosted: approving queues the work instead of opening a browser.
    t.config.serverless = true;
    const approved = (await request(t.app).post(`/api/applications/${app.id}/approve`).set(as('carol')).send({ submit: true }).expect(202)).body;
    expect(approved.stage).toBe('applying');
    let a = (await request(t.app).get(`/api/applications/${app.id}`).set(as('carol'))).body;
    for (let i = 0; i < 40 && !a.queuedForRunner; i++) {
      await new Promise((r) => setTimeout(r, 50));
      a = (await request(t.app).get(`/api/applications/${app.id}`).set(as('carol'))).body;
    }
    expect(a.queuedForRunner).toBe('apply');
    expect(a.stage).toBe('applying');
    expect(a.log.at(-1).message).toMatch(/runner/);
    // Queued work is not "interrupted": you can still remove or move it.
    const status = (await request(t.app).get('/api/agent/status').set(as('carol'))).body;
    expect(status.execution).toMatchObject({ mode: 'runner', online: false, queued: 1, ownerId: 'carol' });
    expect(status.phase).toBe('Off');

    // "Run once now" in the hosted app leaves a request for the runner (not started here: a run searches the web).
    await request(t.app).post('/api/agent/run').set(as('carol')).expect(202);
    expect((await t.store.docList('runner_status', 'carol')).map((d) => d.id.slice(0, 4))).toContain('req-');
    await t.store.docDelete('runner_status', (await t.store.docList('runner_status', 'carol')).find((d) => d.id.startsWith('req-'))!.id);

    // The runner on your computer (same data): a runner for someone else does nothing.
    t.config.serverless = false;
    t.config.runner = { enabled: true, owners: ['dave'], pollMs: 5_000 };
    await new Runner(t.career).tick();
    expect((await request(t.app).get(`/api/applications/${app.id}`).set(as('carol'))).body.queuedForRunner).toBe('apply');

    t.config.runner = { enabled: true, owners: ['carol'], pollMs: 5_000 };
    const runner = new Runner(t.career);
    await runner.tick();
    // The test has no browser: the attempt ends in "needs attention", never a fake success.
    for (let i = 0; i < 60; i++) {
      a = (await request(t.app).get(`/api/applications/${app.id}`).set(as('carol'))).body;
      if (a.stage !== 'applying') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(a.queuedForRunner).toBeNull();
    expect(a.stage).toBe('needs_attention');
    expect(a.log.map((l: any) => l.message).join(' ')).toMatch(/runner on your computer picked this up/);
    // The heartbeat is visible to the hosted app.
    t.config.serverless = true;
    const after = (await request(t.app).get('/api/agent/status').set(as('carol'))).body;
    expect(after.execution).toMatchObject({ mode: 'runner', online: true, queued: 0 });
    runner.stop();
    t.career.agent.shutdown();
  }, 30_000);

  it('rebuilds a missing tailored PDF on demand (serverless disks do not last)', async () => {
    const t = await makeApp();
    await request(t.app).post('/api/resumes/paste').set(as('erin')).send({ text: PASTED_RESUME }).expect(201);
    const app = await t.career.apps.createFromPosting('erin', { ...post, externalId: 'n/10' }, { mode: 'review' });
    await t.career.apps.prepare('erin', app.id, null, { force: true });
    const fs = await import('node:fs/promises');
    await fs.rm(t.config.automation.filesDir, { recursive: true, force: true });
    const pdf = await t.career.apps.resumePdf('erin', app.id);
    expect(pdf.buffer.subarray(0, 4).toString()).toBe('%PDF');
  }, 30_000);
});
