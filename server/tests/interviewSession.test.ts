import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { JD_TEXT, PASTED_RESUME, makeApp, type TestApp } from './helpers.js';
import { deliverySignals, folderName } from '../src/career/interviewSession.js';

const as = (uid: string) => ({ 'X-Firebase-Auth': `user:${uid}` });
const voice = (over: Record<string, unknown> = {}) => ({ source: 'voice', secondsToStart: 1, durationSec: 20, longPauses: 0, speechDetected: true, ...over });

async function setup(t: TestApp, uid: string) {
  await request(t.app).post('/api/resumes/paste').set(as(uid)).send({ text: PASTED_RESUME }).expect(201);
}

describe('delivery signals', () => {
  it('detects fillers, hedging, slow starts and pauses', () => {
    expect(deliverySignals('I used CloudWatch to check the instance metrics, then restarted the failing service and documented the fix for the team.').confidence).toBe('confident');
    const hesitant = deliverySignals('Um, I think, uh, maybe I would check the logs first and then, um, restart it if needed and see what happens.', { source: 'voice', secondsToStart: 9, durationSec: 30, longPauses: 3, speechDetected: true });
    expect(hesitant.confidence).toBe('hesitant');
    expect(hesitant.signals.join(' ')).toMatch(/filler/);
    expect(hesitant.signals.join(' ')).toMatch(/9 s to start/);
    expect(hesitant.signals.join(' ')).toMatch(/3 long pauses/);
    expect(deliverySignals("I'm not sure, I don't know how that works").confidence).toBe('unsure');
  });

  it('names folders with role, company, date and time (safe for Windows)', () => {
    const name = folderName('SOC Analyst / L2', 'Acme: Inc?', new Date(2026, 8, 27, 22, 15, 3));
    expect(name).toBe('SOC Analyst L2 - Acme Inc - 2026-09-27 22-15-03');
    expect(folderName('', '', new Date(2026, 0, 2, 3, 4, 5))).toBe('Interview - 2026-01-02 03-04-05');
  });
});

describe('live interview sessions (fake AI interviewer)', () => {
  it('follows up on a partial answer, moves on when correct, hints on silence, then gives the model answer', async () => {
    const t = await makeApp();
    await setup(t, 'alice');
    const start = await request(t.app).post('/api/interview-sessions').set(as('alice')).send({ mode: 'live', role: 'Cloud Support Engineer', company: 'Northwind', jobDescription: JD_TEXT, count: 6 }).expect(201);
    const s = start.body;
    expect(s.turns.map((x: any) => x.kind)).toEqual(['intro', 'question']);
    expect(s.current).toBe(0);

    // Partial answer → connecting follow-up on the SAME question
    let r = await request(t.app).post(`/api/interview-sessions/${s.id}/respond`).set(as('alice')).send({ answer: 'Um, I think I would look at the logs and maybe restart something if it looks broken.', metrics: voice({ secondsToStart: 8, longPauses: 2 }) }).expect(200);
    expect(r.body.said.map((x: any) => x.kind)).toEqual(['answer', 'followup']);
    const answerTurn = r.body.said[0];
    expect(answerTurn.analysis.verdict).toBe('partially_correct');
    expect(answerTurn.analysis.confidence).toBe('hesitant');
    expect(answerTurn.analysis.deliverySignals.join(' ')).toMatch(/hedging/);
    expect(r.body.session.current).toBe(0);
    expect(r.body.said[1].text).toMatch(/Which tool would you check first/);

    // Answer to the follow-up → correct → next question
    r = await request(t.app).post(`/api/interview-sessions/${s.id}/respond`).set(as('alice')).send({ answer: 'I would open the monitoring dashboards and check CPU, memory and the error rate for that service first.', metrics: voice() }).expect(200);
    expect(r.body.said.map((x: any) => x.kind)).toEqual(['answer', 'feedback', 'question']);
    expect(r.body.session.current).toBe(1);

    // Silence → hint (stay), silence again → model answer → next question
    r = await request(t.app).post(`/api/interview-sessions/${s.id}/respond`).set(as('alice')).send({ answer: '', metrics: voice({ speechDetected: false }) }).expect(200);
    expect(r.body.said.map((x: any) => x.kind)).toEqual(['hint']);
    expect(r.body.said[0].text).toMatch(/didn't hear an answer/);
    r = await request(t.app).post(`/api/interview-sessions/${s.id}/hint`).set(as('alice')).expect(200);
    expect(r.body.said.map((x: any) => x.kind)).toEqual(['model_answer', 'question']);
    expect(r.body.session.current).toBe(2);

    // "I don't know" counts as stuck → hint first
    r = await request(t.app).post(`/api/interview-sessions/${s.id}/respond`).set(as('alice')).send({ answer: "I don't know", metrics: voice() }).expect(200);
    expect(r.body.said.map((x: any) => x.kind)).toEqual(['answer', 'hint']);

    // Skip → model answer → next
    r = await request(t.app).post(`/api/interview-sessions/${s.id}/skip`).set(as('alice')).expect(200);
    expect(r.body.session.current).toBe(3);

    // Finish → summary + closing; saved folder with transcript, Q&A JSON and JD
    const done = await request(t.app).post(`/api/interview-sessions/${s.id}/finish`).set(as('alice')).expect(200);
    expect(done.body.status).toBe('finished');
    expect(done.body.summary.overallScore).toBe(7);
    expect(done.body.turns[done.body.turns.length - 1].kind).toBe('closing');
    await request(t.app).post(`/api/interview-sessions/${s.id}/respond`).set(as('alice')).send({ answer: 'late answer here please' }).expect(409);

    const dir = path.join(t.dataDir, 'interviews', done.body.folder);
    expect(done.body.folder).toMatch(/^Cloud Support Engineer - Northwind - \d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}$/);
    const md = fs.readFileSync(path.join(dir, 'transcript.md'), 'utf8');
    expect(md).toContain('# Interview practice — Cloud Support Engineer at Northwind');
    expect(md).toContain('Which tool would you check first?');
    expect(md).toContain('**You:** I would open the monitoring dashboards');
    expect(md).toMatch(/partially correct · 5\/10/);
    const json = JSON.parse(fs.readFileSync(path.join(dir, 'session.json'), 'utf8'));
    expect(json.questionsAndAnswers[0].exchange.filter((x: any) => x.speaker === 'user')).toHaveLength(2);
    expect(fs.readFileSync(path.join(dir, 'job-description.txt'), 'utf8')).toBe(JD_TEXT);

    const dl = await request(t.app).get(`/api/interview-sessions/${s.id}/transcript.md`).set(as('alice')).expect(200);
    expect(dl.headers['content-disposition']).toMatch(/attachment/);
    const list = await request(t.app).get('/api/interview-sessions').set(as('alice')).expect(200);
    expect(list.body.sessions).toHaveLength(1);
    expect(list.body.folderRoot).toContain('interviews');
    await request(t.app).get(`/api/interview-sessions/${s.id}`).set(as('bob')).expect(404);
  }, 30_000);

  it('works without AI: rule-based follow-ups, then a clarification after two follow-ups', async () => {
    const t = await makeApp({ ai: null });
    await setup(t, 'dan');
    const s = (await request(t.app).post('/api/interview-sessions').set(as('dan')).send({ mode: 'coach', role: 'Cloud Support Engineer', jobDescription: JD_TEXT, count: 4 }).expect(201)).body;
    expect(s.method).toBe('rule-based');
    const vague = 'It depends on the situation and what the team needs at that moment really.';
    let r = await request(t.app).post(`/api/interview-sessions/${s.id}/respond`).set(as('dan')).send({ answer: vague }).expect(200);
    expect(r.body.said[1].kind).toBe('followup');
    r = await request(t.app).post(`/api/interview-sessions/${s.id}/respond`).set(as('dan')).send({ answer: vague }).expect(200);
    expect(r.body.said[1].kind).toBe('followup');
    r = await request(t.app).post(`/api/interview-sessions/${s.id}/respond`).set(as('dan')).send({ answer: vague }).expect(200);
    expect(r.body.said.map((x: any) => x.kind)).toEqual(['answer', 'clarification', 'question']);
    expect(r.body.session.current).toBe(1);
    expect(r.body.said[0].analysis.method).toBe('rule-based');
  }, 30_000);
});
