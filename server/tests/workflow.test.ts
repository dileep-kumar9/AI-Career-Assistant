import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ResumeData } from '../../shared/resumeTypes.js';
import { FIXTURES, JD_TEXT, PASTED_RESUME, auth, createPasted, makeApp, type TestApp } from './helpers.js';

const facts = (r: ResumeData) => r.experience.map((e) => ({ id: e.id, jobTitle: e.jobTitle, company: e.company, startDate: e.startDate, endDate: e.endDate, current: e.current }));
const skills = (r: ResumeData) => [...r.skills.simple, ...r.skills.categorized.flatMap((c) => c.skills)];

async function readyForEditing(t: TestApp) {
  const s = await createPasted(t);
  await request(t.app).post(`/api/resumes/${s.id}/job-description`).set(auth(s.token)).send({ jobDescription: JD_TEXT }).expect(200);
  const gen = await request(t.app).post(`/api/resumes/${s.id}/generate`).set(auth(s.token)).expect(200);
  return { ...s, session: gen.body };
}

function edit(t: TestApp, s: { id: string; token: string }, instruction: string) {
  return request(t.app).post(`/api/resumes/${s.id}/edit`).set(auth(s.token)).send({ instruction });
}

describe('resume upload and persistent session', () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await makeApp();
  });

  it('1. uploads a PDF resume and stores it in a new session', async () => {
    const res = await request(t.app).post('/api/resumes/upload').attach('file', path.join(FIXTURES, 'e2e-resume.pdf')).expect(201);
    const { session, token, extraction } = res.body;
    expect(token).toMatch(/^[\w-]{40,}$/);
    expect(session.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(session.originalFile).toMatchObject({ name: 'e2e-resume.pdf', mimeType: 'application/pdf' });
    expect(session.original.personalInfo.fullName).toBe('E2E Test Candidate');
    expect(session.original.experience[0]).toMatchObject({ jobTitle: 'AWS Intern', company: 'Example Technologies' });
    expect(session.original.education).toHaveLength(1);
    expect(session.versions).toHaveLength(1);
    expect(session.versions[0].label).toBe('Original extracted resume');
    expect(extraction.method).toBe('heuristic'); // fake AI refuses to parse → rule-based fallback
    const file = await request(t.app).get(`/api/resumes/${session.id}/original/file`).set(auth(token)).buffer(true).expect(200);
    expect(Buffer.from(file.body).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('2. uploads a DOCX resume', async () => {
    const res = await request(t.app).post('/api/resumes/upload').attach('file', path.join(FIXTURES, 'e2e-resume.docx')).expect(201);
    expect(res.body.session.original.experience[0].bulletPoints).toHaveLength(2);
    expect(res.body.session.original.projects.map((p: any) => p.title)).toEqual(['AI Code Review Assistant', 'Support Dashboard']);
  });

  it('3. accepts pasted resume text', async () => {
    const s = await createPasted(t);
    const r = s.body.session.original as ResumeData;
    expect(r.personalInfo.fullName).toBe('Priya Raman');
    expect(r.experience).toHaveLength(2);
    expect(r.experience[0]).toMatchObject({ company: 'Lone Star Hosting', startDate: '2022-01', current: true });
    expect(r.certifications?.[0].name).toBe('CompTIA Linux+');
  });

  it('rejects unsupported and oversized files', async () => {
    await request(t.app).post('/api/resumes/upload').attach('file', Buffer.from('MZ fake exe'), 'resume.exe').expect(400);
    const big = await makeApp({ config: { maxUploadBytes: 1024 } });
    const res = await request(big.app).post('/api/resumes/upload').attach('file', path.join(FIXTURES, 'e2e-resume.pdf'));
    expect(res.status).toBe(413);
  });

  it('protects sessions with a secret token', async () => {
    const s = await createPasted(t);
    await request(t.app).get(`/api/resumes/${s.id}`).expect(401);
    await request(t.app).get(`/api/resumes/${s.id}`).set(auth('not-the-token-000000000000000000000000000')).expect(401);
    await request(t.app).get(`/api/resumes/00000000-0000-0000-0000-000000000000`).set(auth(s.token)).expect(404);
    await request(t.app).get(`/api/resumes/${s.id}`).set({ 'X-Session-Token': s.token }).expect(200);
  });

  it('8. restores the session after a "browser refresh" / server restart', async () => {
    const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'resume-db-')), 'test.db');
    const first = await makeApp({ dbFile });
    const s = await createPasted(first);
    await request(first.app).post(`/api/resumes/${s.id}/job-description`).set(auth(s.token)).send({ jobDescription: JD_TEXT }).expect(200);
    await request(first.app).post(`/api/resumes/${s.id}/generate`).set(auth(s.token)).expect(200);
    const before = (await edit(first, s, 'Make my summary shorter.').expect(200)).body.session;
    await first.store.close();

    const second = await makeApp({ dbFile });
    const after = (await request(second.app).get(`/api/resumes/${s.id}`).set(auth(s.token)).expect(200)).body;
    expect(after.current).toEqual(before.current);
    expect(after.versions).toHaveLength(before.versions.length);
    expect(after.jobDescription).toBe(JD_TEXT.trim());
    expect(after.messages.length).toBe(before.messages.length);
    expect(after.original).toEqual(before.original);
  });
});

describe('job description, generation and ATS scoring', () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await makeApp();
  });

  it('analyses the JD, merging only AI keywords that appear in the JD', async () => {
    const s = await createPasted(t);
    const res = await request(t.app).post(`/api/resumes/${s.id}/job-description`).set(auth(s.token)).send({ jobDescription: JD_TEXT }).expect(200);
    const jd = res.body.jdAnalysis;
    expect(jd.jobTitle).toBe('Cloud Support Engineer');
    expect(jd.company).toBe('Northwind Systems');
    expect(jd.requiredSkills).toEqual(expect.arrayContaining(['AWS', 'Linux', 'Python', 'SQL']));
    expect(jd.requiredSkills).not.toContain('Quantum Computing'); // hallucinated by the fake AI, not in the JD
    expect(jd.preferredSkills).toEqual(expect.arrayContaining(['Docker', 'Kubernetes', 'Terraform']));
    expect(jd.certifications).toContain('AWS Certified Cloud Practitioner');
    expect(jd.minYears).toBe(1);
    expect(res.body.ats.total).toBeGreaterThan(0);
  });

  it('lets the user edit extracted keywords', async () => {
    const s = await createPasted(t);
    await request(t.app).post(`/api/resumes/${s.id}/job-description`).set(auth(s.token)).send({ jobDescription: JD_TEXT }).expect(200);
    const res = await request(t.app).patch(`/api/resumes/${s.id}/job-description/analysis`).set(auth(s.token)).send({ requiredSkills: ['AWS', 'Linux'] }).expect(200);
    expect(res.body.jdAnalysis.requiredSkills).toEqual(['AWS', 'Linux']);
    expect(res.body.jdAnalysis.userEdited).toBe(true);
  });

  it('4. generates a tailored resume without inventing facts', async () => {
    const s = await readyForEditing(t);
    const view = s.session;
    const original = view.original as ResumeData;
    const current = view.current as ResumeData;
    expect(view.versions).toHaveLength(2);
    expect(view.currentVersion.source).toBe('generate');
    expect(view.originalLocked).toBe(true);
    // Employers, titles and dates are untouched.
    expect(facts(current)).toEqual(facts(original));
    expect(current.education).toEqual(original.education);
    // Kubernetes is only evidenced in a home lab → rejected from skills.
    expect(skills(current)).not.toContain('Kubernetes');
    // Invented metrics were rejected: the "40%" bullet keeps its original wording and the summary drops "99%".
    expect(JSON.stringify(current)).not.toMatch(/40%|99%|500 servers|SQL query/);
    expect(current.experience[0].bulletPoints[0]).toBe(original.experience[0].bulletPoints[0]);
    expect(current.experience[0].bulletPoints[1]).toMatch(/^Resolved: /);
    expect(current.summary).toBe('Technical support engineer with hands-on AWS, Linux and Python experience troubleshooting production issues.');
    // Every original skill is still present.
    for (const sk of skills(original)) expect(skills(current).map((x) => x.toLowerCase())).toContain(sk.toLowerCase());
    const genMsg = view.messages.at(-1);
    expect(genMsg.meta.kind).toBe('generate');
    expect(genMsg.meta.warnings.join(' ')).toMatch(/Kubernetes|figure|40/);
    expect(view.ats.total).toBeGreaterThan(0);
    expect(view.previousScore).not.toBeNull();
    // The original stays immutable after generation.
    await request(t.app).put(`/api/resumes/${s.id}/original`).set(auth(s.token)).send({ text: 'changed' }).expect(409);
  });

  it('9. recalculates a deterministic ATS score with category breakdown', async () => {
    const s = await readyForEditing(t);
    const a = (await request(t.app).post(`/api/resumes/${s.id}/ats-score/recalculate`).set(auth(s.token)).expect(200)).body.ats;
    const b = (await request(t.app).post(`/api/resumes/${s.id}/ats-score/recalculate`).set(auth(s.token)).expect(200)).body.ats;
    expect(a.total).toBe(b.total);
    expect(a.categories.map((c: any) => c.weight)).toEqual([30, 25, 20, 15, 10]);
    expect(Math.abs(a.categories.reduce((n: number, c: any) => n + c.points, 0) - a.total)).toBeLessThanOrEqual(1);
    expect(a.disclaimer).toMatch(/not an official score/i);
    const tf = a.keywords.find((k: any) => k.keyword === 'Terraform');
    expect(tf.status).toBe('missing');
    expect(tf.evidence.inOriginal).toBe(false);
    expect(tf.recommendation).toMatch(/skill gap/i);
    const k8s = a.keywords.find((k: any) => k.keyword === 'Kubernetes');
    expect(k8s.evidence.labOnly).toBe(true);
    const score = await request(t.app).get(`/api/resumes/${s.id}/ats-score`).set(auth(s.token)).expect(200);
    expect(score.body.ats.total).toBe(a.total);
  });
});

describe('chat-based editing', () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await makeApp();
  });

  it('5 & 6. edits the summary without touching unrelated sections', async () => {
    const s = await readyForEditing(t);
    const before = s.session.current as ResumeData;
    const res = await edit(t, s, 'Make my professional summary shorter.').expect(200);
    const after = res.body.session.current as ResumeData;
    expect(res.body.changed).toBe(true);
    expect(after.summary.length).toBeLessThan(before.summary.length);
    expect(after.experience).toEqual(before.experience);
    expect(after.projects).toEqual(before.projects);
    expect(after.skills).toEqual(before.skills);
    expect(after.education).toEqual(before.education);
    expect(after.template).toBe(before.template);
    expect(res.body.session.currentVersion.source).toBe('edit');
    expect(res.body.message.meta.diff.map((d: any) => d.section)).toEqual(['summary']);
  });

  it('7. applies multiple consecutive edits and keeps earlier ones', async () => {
    const s = await readyForEditing(t);
    const shorter = (await edit(t, s, 'Make my summary shorter').expect(200)).body.session.current as ResumeData;
    const res = await edit(t, s, 'Add more relevant Linux and AWS experience from my existing resume.').expect(200);
    const after = res.body.session.current as ResumeData;
    expect(after.summary).toBe(shorter.summary); // earlier edit preserved
    expect(facts(after)).toEqual(facts(shorter)); // "CTO at Fake Corp" was rejected
    // AWS is evidenced for the hosting role, so that rewrite is accepted …
    // ("Leveraged" is rewritten to plain "Used" by the humanizer.)
    expect(after.experience[0].bulletPoints.every((b) => b.startsWith('Used AWS'))).toBe(true);
    // … but not for the college IT role, where AWS was never mentioned.
    expect(after.experience[1].bulletPoints).toEqual(shorter.experience[1].bulletPoints);
    expect(res.body.message.meta.warnings.join(' ')).toMatch(/not supported for this role/);
    expect(res.body.session.versions).toHaveLength(4);
  });

  it('asks about missing JD skills after tailoring and adds only what the user confirms', async () => {
    const s = await readyForEditing(t);
    const gen = s.session.messages.at(-1);
    expect(gen.meta.offer.skills).toEqual(expect.arrayContaining(['SQL', 'Terraform']));
    expect(gen.content).toMatch(/Do you have experience with any of them\?/);
    expect(t.fake!.calls.filter((c) => c.task === 'edit')).toHaveLength(0);
    const r = await edit(t, s, 'yes, add SQL but not Terraform').expect(200);
    expect(r.body.changed).toBe(true);
    expect(skills(r.body.session.current)).toContain('SQL');
    expect(skills(r.body.session.current)).not.toContain('Terraform');
    expect(t.fake!.calls.filter((c) => c.task === 'edit')).toHaveLength(0); // handled without AI
    // Confirmed facts are remembered and count as evidence from now on.
    const row = await t.store.getSession(s.id);
    expect(row!.userFacts.join(' ')).toMatch(/SQL/);
  });

  it('adds skills the user explicitly asks for', async () => {
    const s = await readyForEditing(t);
    const r = await edit(t, s, 'Add Terraform and Ansible to my skills').expect(200);
    expect(skills(r.body.session.current)).toEqual(expect.arrayContaining(['Terraform', 'Ansible']));
    const r2 = await edit(t, s, 'Add more relevant Linux experience from my existing resume').expect(200);
    expect(r2.body.message.meta.changes?.join(' ') || '').not.toMatch(/Added to skills/);
  });

  it('explains the score from the real breakdown and offers missing skills', async () => {
    const s = await readyForEditing(t);
    const r = await edit(t, s, 'why is my ATS score low?').expect(200);
    expect(r.body.changed).toBe(false);
    expect(r.body.message.content).toMatch(/Your estimated ATS score is \d+\/100/);
    expect(r.body.message.meta.offer.skills.length).toBeGreaterThan(0);
  });

  it('answers "how can I increase my score" with a measured plan and never changes the resume', async () => {
    const s = await readyForEditing(t);
    const versions = s.session?.versions?.length;
    const r = await edit(t, s, 'how can I increase my ATS score?').expect(200);
    expect(r.body.changed).toBe(false);
    expect(r.body.message.content).toMatch(/Your score is \*\*\d+\/100\*\*/);
    expect(r.body.message.content).toMatch(/could take it to about/);
    if (versions) expect(r.body.session.versions).toHaveLength(versions);
  });

  it('suggests projects and adds the ones the user picks', async () => {
    const s = await readyForEditing(t);
    const r = await edit(t, s, 'suggest some projects for this role').expect(200);
    expect(r.body.changed).toBe(false);
    expect(r.body.message.meta.offer.projects).toHaveLength(2);
    const add = await edit(t, s, 'add the second one').expect(200);
    expect(add.body.changed).toBe(true);
    const titles = add.body.session.current.projects.map((p: any) => p.title);
    expect(titles).toContain('CloudWatch Alerting Dashboard');
    expect(titles).not.toContain('Log Parser CLI');
  });

  it('never claims changes that were not applied', async () => {
    const s = await readyForEditing(t);
    const r = await edit(t, s, 'Standardize section headings (claim only)').expect(200);
    expect(r.body.changed).toBe(false);
    expect(r.body.message.content).toMatch(/could not apply/i);
  });

  it('asks a clarifying question without creating a version', async () => {
    const s = await readyForEditing(t);
    const res = await edit(t, s, 'Add a new project (question)').expect(200);
    expect(res.body.changed).toBe(false);
    expect(res.body.message.meta.kind).toBe('question');
    expect(res.body.session.versions).toHaveLength(2);
  });

  it('10. undoes, redoes and restores versions without deleting any', async () => {
    const s = await readyForEditing(t);
    const generated = s.session.current;
    const edited = (await edit(t, s, 'Make my summary shorter').expect(200)).body.session;
    let v = (await request(t.app).post(`/api/resumes/${s.id}/undo`).set(auth(s.token)).expect(200)).body;
    expect(v.current).toEqual(generated);
    expect(v.canRedo).toBe(true);
    v = (await request(t.app).post(`/api/resumes/${s.id}/redo`).set(auth(s.token)).expect(200)).body;
    expect(v.current).toEqual(edited.current);
    // Chat commands work too.
    let r = await edit(t, s, 'Undo the last change.').expect(200);
    expect(r.body.session.current).toEqual(generated);
    r = await edit(t, s, 'Restore version 1').expect(200);
    expect(r.body.session.current).toEqual(s.session.original);
    expect(r.body.session.versions.length).toBe(4); // restore adds a version, never deletes
    r = await edit(t, s, 'Show me what changed in the latest version').expect(200);
    expect(r.body.message.meta.kind).toBe('diff');
    const list = (await request(t.app).get(`/api/resumes/${s.id}/versions`).set(auth(s.token)).expect(200)).body.versions;
    const cmp = await request(t.app).get(`/api/resumes/${s.id}/compare`).query({ from: list[0].id, to: list[1].id }).set(auth(s.token)).expect(200);
    expect(cmp.body.changes.length).toBeGreaterThan(0);
    const restored = await request(t.app).post(`/api/resumes/${s.id}/restore/${list[1].id}`).set(auth(s.token)).expect(200);
    expect(restored.body.current).toEqual(generated);
  });

  it('11. changes templates and layout without losing content', async () => {
    const s = await readyForEditing(t);
    const before = s.session.current as ResumeData;
    const res = await request(t.app).patch(`/api/resumes/${s.id}/design`).set(auth(s.token)).send({ template: 'technical', fontSize: 'small', margins: 'narrow' }).expect(200);
    const after = res.body.current as ResumeData;
    expect(after.template).toBe('technical');
    expect(after.layout?.margins).toBe('narrow');
    expect({ ...after, template: before.template, fontSize: before.fontSize, layout: before.layout }).toEqual(before);
    const chat = await edit(t, s, 'Change the resume template to a clean professional design.').expect(200);
    expect(chat.body.session.current.template).toBe('modern-professional');
    expect(chat.body.session.current.experience).toEqual(before.experience);
    const sec = await request(t.app).patch(`/api/resumes/${s.id}/design`).set(auth(s.token)).send({ sections: [{ id: 'experience', visible: true }, { id: 'summary', visible: false }] }).expect(200);
    expect(sec.body.current.sections[0].id).toBe('experience');
    expect(sec.body.current.sections.find((x: any) => x.id === 'summary').visible).toBe(false);
    expect(sec.body.current.summary).toBe(chat.body.session.current.summary); // hidden, not deleted
  });

  it('12 & 13. exports PDF and DOCX', async () => {
    const s = await readyForEditing(t);
    const pdf = await request(t.app).post(`/api/resumes/${s.id}/export/pdf`).set(auth(s.token)).buffer(true).parse(binary).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(Number(pdf.headers['x-page-count'])).toBeGreaterThanOrEqual(1);
    expect(pdf.headers['content-disposition']).toMatch(/priya-raman-resume\.pdf/);
    const docx = await request(t.app).post(`/api/resumes/${s.id}/export/docx`).set(auth(s.token)).buffer(true).parse(binary).expect(200);
    expect(docx.body.subarray(0, 2).toString()).toBe('PK');
    const review = await request(t.app).get(`/api/resumes/${s.id}/review`).set(auth(s.token)).expect(200);
    expect(review.body.pageCount).toBeGreaterThanOrEqual(1);
    expect(review.body.template).toBe('professional');
  });

  it('14. finishes and reopens a resume', async () => {
    const s = await readyForEditing(t);
    const fin = await request(t.app).post(`/api/resumes/${s.id}/finish`).set(auth(s.token)).expect(200);
    expect(fin.body.status).toBe('finalized');
    const blocked = await edit(t, s, 'Make my summary shorter').expect(409);
    expect(blocked.body.code).toBe('finalized');
    // Exports still work while finalized.
    await request(t.app).post(`/api/resumes/${s.id}/export/pdf`).set(auth(s.token)).expect(200);
    const re = await request(t.app).post(`/api/resumes/${s.id}/reopen`).set(auth(s.token)).expect(200);
    expect(re.body.status).toBe('draft');
    expect(re.body.versions).toHaveLength(fin.body.versions.length);
    await edit(t, s, 'Make my summary shorter').expect(200);
  });

  it('15. keeps the current resume when the AI provider fails or returns garbage', async () => {
    const s = await readyForEditing(t);
    const before = s.session;
    t.fake!.failNext = true;
    const fail = await edit(t, s, 'Rewrite my experience using stronger action verbs').expect(503);
    expect(fail.body.error).toMatch(/not changed/i);
    const garbage = await edit(t, s, 'garbage please').expect(503);
    expect(garbage.body.code).toBe('ai_unavailable');
    const after = (await request(t.app).get(`/api/resumes/${s.id}`).set(auth(s.token)).expect(200)).body;
    expect(after.current).toEqual(before.current);
    expect(after.versions).toHaveLength(before.versions.length);
    expect(after.messages.at(-1).meta.kind).toBe('error');
    t.fake!.failNext = true;
    await request(t.app).post(`/api/resumes/${s.id}/generate`).set(auth(s.token)).expect(503);
    const again = (await request(t.app).get(`/api/resumes/${s.id}`).set(auth(s.token)).expect(200)).body;
    expect(again.current).toEqual(before.current);
  });

  it('16. never asks the user to upload the resume again', async () => {
    const s = await readyForEditing(t);
    const instructions = ['Make my summary shorter', 'Add more relevant Linux and AWS experience from my existing resume', 'Improve the ATS score', 'Undo', 'Remove the objective section', 'Reduce this resume to one page', 'Add a new project (question)'];
    for (const instruction of instructions) {
      const res = await edit(t, s, instruction);
      expect(res.status).toBe(200);
      const text = [res.body.message.content, ...(res.body.message.meta.questions || [])].join(' ');
      expect(text).not.toMatch(/upload/i);
      expect(res.body.session.original).toEqual(s.session.original);
    }
    // No edit request ever needs the resume in the payload.
    expect(t.fake!.calls.filter((c) => c.task === 'edit').every((c) => c.prompt.includes('<original_resume>'))).toBe(true);
  });
});

describe('without any AI provider configured', () => {
  it('still supports the full workflow with rule-based fallbacks', async () => {
    const t = await makeApp({ ai: null });
    const s = await createPasted(t);
    await request(t.app).post(`/api/resumes/${s.id}/job-description`).set(auth(s.token)).send({ jobDescription: JD_TEXT }).expect(200);
    const gen = await request(t.app).post(`/api/resumes/${s.id}/generate`).set(auth(s.token)).expect(200);
    expect(gen.body.currentVersion.source).toBe('generate');
    expect(gen.body.ai.available).toBe(false);
    const r = await edit(t, s, 'Make my summary shorter').expect(200);
    expect(r.body.changed).toBe(true);
    const r2 = await edit(t, s, 'Rewrite my experience with stronger verbs').expect(200);
    expect(r2.body.changed).toBe(false);
    expect(r2.body.message.meta.kind).toBe('error');
  });
});

function binary(res: any, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

describe('ChatGPT-style requests on the stored resume', () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await makeApp();
  });

  it('chat works right after upload, before any job description', async () => {
    const s = await createPasted(t);
    const r = await edit(t, s, 'Remove the line below my name').expect(200);
    expect(r.body.changed).toBe(true);
    expect(r.body.session.current.personalInfo.jobTitle).toBe('');
    expect(r.body.session.original.personalInfo.jobTitle).toBe('Linux System Administrator'); // original untouched
    const undo = await edit(t, s, 'undo').expect(200);
    expect(undo.body.session.current.personalInfo.jobTitle).toBe('Linux System Administrator');
  });

  it('answers analysis requests in chat without changing the resume', async () => {
    const s = await createPasted(t);
    const r = await edit(t, s, 'Analyse my resume and tell me its strengths and weaknesses').expect(200);
    expect(r.body.changed).toBe(false);
    expect(r.body.message.content).toContain('Strengths:\n- Clear Linux administration experience');
    expect(r.body.session.versions).toHaveLength(1);
  });

  it('tailors when a job description is pasted into the chat', async () => {
    const s = await createPasted(t);
    const r = await edit(t, s, `Tailor my resume to this JD:\n${JD_TEXT}`).expect(200);
    expect(r.body.changed).toBe(true);
    expect(r.body.session.jdAnalysis.jobTitle).toBe('Cloud Support Engineer');
    expect(r.body.session.jobDescription).not.toMatch(/^Tailor my resume/);
    expect(r.body.session.currentVersion.source).toBe('generate');
    expect(r.body.session.ats.total).toBeGreaterThan(0);
  });

  it('asks for a JD when told to tailor without one, and tailors once it exists', async () => {
    const s = await createPasted(t);
    const ask = await edit(t, s, 'Tailor my resume to the job description').expect(200);
    expect(ask.body.message.meta.kind).toBe('question');
    expect(ask.body.message.content).not.toMatch(/upload/i);
    await request(t.app).post(`/api/resumes/${s.id}/job-description`).set(auth(s.token)).send({ jobDescription: JD_TEXT }).expect(200);
    const shorter = (await edit(t, s, 'Make my summary shorter').expect(200)).body.session;
    const tailored = await edit(t, s, 'Tailor my resume to the job description').expect(200);
    expect(tailored.body.session.currentVersion.source).toBe('generate');
    expect(tailored.body.session.versions.length).toBe(shorter.versions.length + 1);
  });

  it('gives a rule-based review when no AI provider is configured', async () => {
    const off = await makeApp({ ai: null });
    const s = await createPasted(off);
    const r = await edit(off, s, 'Please review my resume').expect(200);
    expect(r.body.message.content).toMatch(/Here is a review of your current resume/);
    expect(r.body.message.content).toMatch(/Strengths:/);
  });
});

describe('fonts, sizes and colours', () => {
  it('changes typography by chat and via the design API without touching content', async () => {
    const t = await makeApp();
    const s = await readyForEditing(t);
    const before = s.session.current as ResumeData;
    const r1 = await edit(t, s, 'change font to Georgia').expect(200);
    expect(r1.body.session.current.layout.style).toEqual({ fontFamily: 'Georgia' });
    const r2 = await edit(t, s, 'make headings navy').expect(200);
    expect(r2.body.session.current.layout.style).toEqual({ fontFamily: 'Georgia', headingColor: '#1f3a5f' });
    const r3 = await edit(t, s, 'body font size 11').expect(200);
    expect(r3.body.session.current.layout.style.bodySize).toBe(11);
    expect(t.fake!.calls.filter((c) => c.task === 'edit')).toHaveLength(0);
    expect(r3.body.session.current.experience).toEqual(before.experience);
    const api = await request(t.app).patch(`/api/resumes/${s.id}/design`).set(auth(s.token)).send({ style: { nameColor: '#7a1f2b', nameSize: 99, textColor: 'red' } }).expect(200);
    expect(api.body.current.layout.style).toMatchObject({ nameColor: '#7a1f2b', nameSize: 36 }); // clamped
    expect(api.body.current.layout.style.textColor).toBeUndefined(); // invalid colour ignored
    const pdf = await request(t.app).post(`/api/resumes/${s.id}/export/pdf`).set(auth(s.token)).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    const reset = await edit(t, s, 'reset fonts').expect(200);
    expect(reset.body.session.current.layout.style).toBeUndefined();
    const undo = await edit(t, s, 'undo').expect(200);
    expect(undo.body.session.current.layout.style.fontFamily).toBe('Georgia');
  });
});

describe('adding projects and internships from a brief or a file', () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await makeApp();
  });

  const BRIEF = `Add this project to my resume:
Job Listings Scraper
- Built a Python scraper with Selenium and BeautifulSoup that collects job postings from three job boards every day.
- Cleaned and de-duplicated the listings with Pandas and stored them in a MySQL table for analysis.
- Wrote a small report that shows new postings per skill and per city.`;

  it('adds a project from a typed brief in the same format, dropping invented claims', async () => {
    const s = await readyForEditing(t);
    const r = await edit(t, s, BRIEF).expect(200);
    expect(r.body.changed).toBe(true);
    const p = r.body.session.current.projects[0];
    expect(p.title).toBe('Job Listings Scraper');
    expect(p.description).toMatch(/Selenium and BeautifulSoup/);
    expect(p.description).not.toMatch(/2 million|Kubernetes/);
    expect(p.technologies).not.toContain('Kubernetes');
    expect(r.body.message.content).toMatch(/left out/);
  });

  it('adds an internship from an attached file', async () => {
    const s = await readyForEditing(t);
    const letter = Buffer.from(`Internship completion letter\nThe intern worked on data pipelines at Acme Analytics.\nBuilt Python scripts with Selenium to extract supplier price lists from partner portals.\nLoaded the extracted data into MySQL and checked it for missing values every week.`);
    const r = await request(t.app).post(`/api/resumes/${s.id}/attachment`).set(auth(s.token)).field('message', 'add this internship').attach('file', letter, 'internship.txt').expect(200);
    expect(r.body.changed).toBe(true);
    const e = r.body.session.current.experience.find((x: any) => x.company === 'Acme Analytics');
    expect(e).toBeTruthy();
    expect(e.bulletPoints.join(' ')).toMatch(/Selenium/);
  });
});

describe('accounts (Firebase sign-in)', () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await makeApp();
  });
  const as = (uid: string) => ({ 'X-Firebase-Auth': `user:${uid}` });

  it('keeps each user’s resumes separate and available on any device', async () => {
    const a = await request(t.app).post('/api/resumes/paste').set(as('alice')).send({ text: PASTED_RESUME }).expect(201);
    await request(t.app).post('/api/resumes/paste').set(as('bob')).send({ text: PASTED_RESUME }).expect(201);
    const mine = await request(t.app).get('/api/resumes').set(as('alice')).expect(200);
    expect(mine.body.resumes.map((r: any) => r.id)).toEqual([a.body.session.id]);
    // Another device: no session token, only the account.
    await request(t.app).get(`/api/resumes/${a.body.session.id}`).set(as('alice')).expect(200);
    // Another user cannot open it, even with the token.
    await request(t.app).get(`/api/resumes/${a.body.session.id}`).set({ ...as('bob'), ...auth(a.body.token) }).expect(401);
    await request(t.app).get('/api/resumes').expect(401);
  });

  it('moves a guest resume into the account after sign-in', async () => {
    const s = await createPasted(t);
    await request(t.app).post(`/api/resumes/${s.id}/claim`).set({ ...as('carol'), ...auth(s.token) }).expect(200);
    const mine = await request(t.app).get('/api/resumes').set(as('carol')).expect(200);
    expect(mine.body.resumes.map((r: any) => r.id)).toContain(s.id);
    // The old browser token alone no longer opens an account resume.
    await request(t.app).get(`/api/resumes/${s.id}`).set(auth(s.token)).expect(401);
  });

  it('requires sign-in to create resumes when REQUIRE_AUTH is on', async () => {
    const strict = await makeApp({ config: { requireAuth: true } });
    await request(strict.app).post('/api/resumes/paste').send({ text: PASTED_RESUME }).expect(401);
    await request(strict.app).post('/api/resumes/paste').set(as('dave')).send({ text: PASTED_RESUME }).expect(201);
  });
});
