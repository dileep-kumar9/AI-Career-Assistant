import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { JD_TEXT, PASTED_RESUME, makeApp } from './helpers.js';
import { describeRange, experienceRequirement, fitsExperience, linkedinLevels } from '../../shared/experience.js';
import { decide, defaultAgentSettings, effectiveRange, mergeAgentSettings } from '../src/career/agentSettings.js';
import { findApplyTarget, isGoogleForm, parseGoogleForm } from '../src/career/jobs/readers.js';
import { applierFor } from '../src/career/automation/appliers.js';
import type { JobPosting } from '../src/career/jobs/types.js';

const as = (uid: string) => ({ 'X-Firebase-Auth': `user:${uid}` });

describe('experience requirements', () => {
  it('reads ranges, plus, minimum, Yrs and fresher wording; ignores preferred lines', () => {
    expect(experienceRequirement('Experience: 5-7 years in data engineering')).toMatchObject({ min: 5, max: 7 });
    expect(experienceRequirement('5-7 Yrs')).toMatchObject({ min: 5, max: 7 });
    expect(experienceRequirement('We need 3+ years of hands-on experience with Python.')).toMatchObject({ min: 3, max: null });
    expect(experienceRequirement('Minimum 2 years of professional experience')).toMatchObject({ min: 2 });
    expect(experienceRequirement('Freshers can apply. Training provided.')).toMatchObject({ min: 0, fresherOk: true });
    expect(experienceRequirement('0-1 years experience in SQL')).toMatchObject({ min: 0, max: 1, fresherOk: true });
    const mixed = 'Requirements:\n- 2 years of experience with SQL\n- 7+ years of experience in Python\n- 10 years experience in Go is a plus';
    expect(experienceRequirement(mixed)?.min).toBe(7); // the highest REQUIRED minimum; "a plus" ignored
    expect(experienceRequirement('Great team, free lunch.')).toBeNull();
  });

  it('fits your range the way you asked: fresher → 0 only; 2-3 → up to 3; 2 → up to 2', () => {
    const fresher = { min: 0, max: 0 };
    expect(fitsExperience(experienceRequirement('5-7 years experience'), fresher)).toBe(false);
    expect(fitsExperience(experienceRequirement('Freshers welcome'), fresher)).toBe(true);
    expect(fitsExperience(experienceRequirement('0-2 years experience'), fresher)).toBe(true);
    expect(fitsExperience(experienceRequirement('1+ years experience'), fresher)).toBe(false);
    expect(fitsExperience(experienceRequirement('No experience mentioned'), fresher)).toBe(true); // unknown → keep
    const twoThree = { min: 2, max: 3 };
    for (const [text, ok] of [['0-1 years experience', true], ['2 years experience', true], ['3+ years experience', true], ['4+ years experience', false], ['5-7 years experience', false]] as const) {
      expect(fitsExperience(experienceRequirement(text), twoThree)).toBe(ok);
    }
    const two = { min: 2, max: 2 };
    expect(fitsExperience(experienceRequirement('3 years experience'), two)).toBe(false);
    expect(fitsExperience(experienceRequirement('1 year experience'), two)).toBe(true);
    expect(describeRange(fresher)).toMatch(/fresher/);
    expect(linkedinLevels(fresher)).toBe('1,2');
  });

  it('uses the agent range, else derives one from the Career Profile', () => {
    const s = defaultAgentSettings();
    expect(effectiveRange({ ...s, experienceMin: 2, experienceMax: 3 }, 10)).toEqual({ min: 2, max: 3 });
    expect(effectiveRange(s, 0)).toEqual({ min: 0, max: 0 });
    expect(effectiveRange(s, null)).toBeNull();
    const merged = mergeAgentSettings(s, { experienceMin: 5, experienceMax: 2 });
    expect([merged.experienceMin, merged.experienceMax]).toEqual([2, 5]);
  });
});

describe('skip / review / auto-approve decision', () => {
  const s = defaultAgentSettings(); // skip below 50, auto-approve at 70, review mode
  it('skips below 50, auto-approves when both ≥ 70, otherwise waits for review', () => {
    expect(decide(s, 45, 80)).toBe('skip');
    expect(decide(s, 60, 48)).toBe('skip');
    expect(decide(s, 72, 81)).toBe('apply');
    expect(decide(s, 72, 65)).toBe('review');
    expect(decide({ ...s, autoApprove: false }, 90, 90)).toBe('review');
    expect(decide(s, 55, 60, 'auto')).toBe('apply');
  });
});

describe('forms and third-party pages', () => {
  it('finds where to apply on a third-party page', () => {
    const blog = '<p>We are hiring a data analyst!</p><a href="https://forms.gle/AbC123">Apply here</a> <a href="/about">About us</a>';
    expect(findApplyTarget(blog, 'https://someblog.example/post/1')).toBe('https://forms.gle/AbC123');
    const careers = '<a href="https://boards.greenhouse.io/acme/jobs/42">View role</a><a href="https://twitter.com/acme">Twitter</a>';
    expect(findApplyTarget(careers, 'https://acme.example/careers')).toBe('https://boards.greenhouse.io/acme/jobs/42');
    const iframe = '<iframe src="https://forms.office.com/r/XyZ"></iframe>';
    expect(findApplyTarget(iframe, 'https://x.example/job')).toBe('https://forms.office.com/r/XyZ');
    expect(findApplyTarget('<a href="https://news.example/story">Read more</a>', 'https://x.example')).toBeNull();
  });

  it('parses a Google Form (title, description, questions) and routes forms to the forms flow', () => {
    const data = JSON.stringify([null, ['Hiring for Data Analyst — 0-2 years, SQL, Tableau', [[1, 'Full name', null, 0], [2, 'Years of experience with SQL', null, 0], [3, 'Upload your resume', null, 13]]]]);
    const html = `<html><head><meta property="og:title" content="Data Analyst Application - Google Forms"><meta property="og:description" content="Apply for the Data Analyst role at Contoso Analytics"></head><body><script>var FB_PUBLIC_LOAD_DATA_ = ${data};</script></body></html>`;
    const p = parseGoogleForm(html, 'https://docs.google.com/forms/d/e/abc/viewform') as JobPosting;
    expect(p.title).toBe('Data Analyst Application');
    expect(p.description).toContain('Apply for the Data Analyst role at Contoso Analytics');
    expect(p.description).toContain('- Years of experience with SQL');
    expect(p.description).toContain('0-2 years, SQL, Tableau');
    expect(isGoogleForm(new URL('https://forms.gle/x'))).toBe(true);
    expect(applierFor('https://docs.google.com/forms/d/e/abc/viewform')).toBe('google_forms');
    expect(applierFor('https://forms.office.com/r/abc')).toBe('microsoft_forms');
    expect(applierFor('https://job-boards.greenhouse.io/a/jobs/1')).toBe('greenhouse');
  });
});

describe('ATS skip rule, questions for you and learning answers (API)', () => {
  it('leaves a job below 50 automatically, then prepares it when you choose “apply anyway”', async () => {
    const t = await makeApp();
    await request(t.app).post('/api/resumes/paste').set(as('alice')).send({ text: PASTED_RESUME }).expect(201);
    const low: JobPosting = { source: 'greenhouse', externalId: 'x/1', title: 'Registered Nurse', company: 'City Hospital', location: '', remote: false, description: 'Registered Nurse needed. Requirements: BLS certification, patient care, IV therapy, electronic health records, nursing license, 2 years of hospital experience in an ICU ward. Responsibilities: monitor patients, administer medication, chart vitals.', jobUrl: 'https://job-boards.greenhouse.io/x/jobs/1', applyUrl: 'https://job-boards.greenhouse.io/x/jobs/1', postedAt: null };
    const app = await t.career.apps.createFromPosting('alice', low, { mode: 'review' });
    const out = await t.career.apps.prepare('alice', app.id, null);
    expect(out.stage).toBe('skipped');
    expect(out.reason).toMatch(/below 50/);
    expect(out.resumeSessionId).toBeNull(); // nothing tailored for a skipped job
    await request(t.app).post(`/api/applications/${app.id}/prepare-anyway`).set(as('alice')).expect(202);
    for (let i = 0; i < 40; i++) {
      const a = (await request(t.app).get(`/api/applications/${app.id}`).set(as('alice'))).body;
      if (a.stage === 'ready') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const ready = (await request(t.app).get(`/api/applications/${app.id}`).set(as('alice'))).body;
    expect(ready.stage).toBe('ready');
    expect(ready.hasResumePdf).toBe(true);
  }, 30_000);

  it('records your answers to pending questions, remembers them in the profile and continues', async () => {
    const t = await makeApp();
    await request(t.app).post('/api/resumes/paste').set(as('bob')).send({ text: PASTED_RESUME }).expect(201);
    const post: JobPosting = { source: 'greenhouse', externalId: 'n/2', title: 'Cloud Support Engineer', company: 'Northwind Systems', location: '', remote: false, description: JD_TEXT, jobUrl: 'https://job-boards.greenhouse.io/n/jobs/2', applyUrl: 'https://job-boards.greenhouse.io/n/jobs/2', postedAt: null };
    const app = await t.career.apps.createFromPosting('bob', post, { mode: 'review' });
    await t.career.apps.prepare('bob', app.id, null, { force: true });
    // Simulate the form asking a question only Bob can answer.
    const doc: any = await t.store.docGet('job_applications', app.id);
    Object.assign(doc, { stage: 'needs_attention', waitingFor: 'answers', pendingQuestions: [{ question: 'Can you join immediately to 15 days after selection?', kind: 'radio', options: ['Yes', 'No'], required: true, suggested: '', source: 'none' }], updatedAt: new Date().toISOString() });
    await t.store.docPut('job_applications', doc);
    await request(t.app).post(`/api/applications/${app.id}/answers`).set(as('bob')).send({ answers: [{ question: 'Something else', answer: 'x' }] }).expect(400);
    const res = await request(t.app).post(`/api/applications/${app.id}/answers`).set(as('bob')).send({ answers: [{ question: 'Can you join immediately to 15 days after selection?', answer: 'Yes', remember: true }] }).expect(202);
    expect(res.body.stage).toBe('applying');
    expect(res.body.waitingFor).toBeNull();
    expect(res.body.answerOverrides).toEqual(expect.arrayContaining([{ question: 'Can you join immediately to 15 days after selection?', answer: 'Yes' }]));
    const profile = (await request(t.app).get('/api/profile').set(as('bob'))).body;
    expect(profile.savedAnswers.map((a: any) => a.question)).toContain('Can you join immediately to 15 days after selection?');
    // The test has no browser: the continued attempt ends in "needs attention", never a fake success.
    for (let i = 0; i < 40; i++) {
      const a = (await request(t.app).get(`/api/applications/${app.id}`).set(as('bob'))).body;
      if (a.stage !== 'applying') {
        expect(a.stage).toBe('needs_attention');
        expect(a.reason).toMatch(/No browser/);
        return;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('apply did not finish');
  }, 30_000);
});
