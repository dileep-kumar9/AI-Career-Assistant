import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { badRequest } from '../errors.js';
import { PROMPT_CATALOG } from '../ai/prompts/index.js';
import { body, ownerOf, wrap } from './http.js';
import type { CareerModules } from './index.js';
import { ProfileInput, SavedAnswerInput } from './profile.js';
import { AgentSettingsInput } from './agentSettings.js';
import { CreateSetInput } from './interview.js';
import { RespondInput, StartInput } from './interviewSession.js';
import { ConfirmInput, PlanInput, PlanUpdate } from './skills.js';
import { ActionInput, ChatInput } from './assistant.js';

const LOGIN_SITES: Record<string, string> = {
  linkedin: 'https://www.linkedin.com/login',
  naukri: 'https://www.naukri.com/nlogin/login',
  indeed: 'https://secure.indeed.com/auth',
  google: 'https://accounts.google.com/',
};

const Link = z.object({ url: z.string().trim().url().max(2000).refine((u) => /^https?:\/\//i.test(u), 'Use an http(s) link'), resumeId: z.string().uuid().nullable().optional(), mode: z.enum(['review', 'auto']).default('review') });
const Manual = z.object({
  jobTitle: z.string().trim().min(1).max(200),
  company: z.string().trim().min(1).max(200),
  jobUrl: z.string().trim().max(2000).default(''),
  location: z.string().trim().max(200).default(''),
  stage: z.enum(['applied', 'interview', 'offer', 'rejected', 'no_response', 'withdrawn']).default('applied'),
  appliedAt: z.string().datetime({ offset: true }).nullable().default(null),
  notes: z.string().max(5000).default(''),
});
const Patch = z.object({
  notes: z.string().max(5000).optional(),
  followUpAt: z.string().datetime({ offset: true }).nullable().optional(),
  interviewAt: z.string().datetime({ offset: true }).nullable().optional(),
  jobTitle: z.string().trim().max(200).optional(),
  company: z.string().trim().max(200).optional(),
});
const Stage = z.object({ stage: z.enum(['applied', 'interview', 'offer', 'rejected', 'no_response', 'withdrawn', 'skipped']), note: z.string().max(500).optional(), interviewAt: z.string().datetime({ offset: true }).nullable().optional() });

export function careerRoutes(m: CareerModules, config: AppConfig): Router {
  const r = Router();
  const ai = rateLimit({ windowMs: config.rateLimit.windowMs, limit: config.rateLimit.ai, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many AI requests. Please wait a minute.', code: 'rate_limited' } });

  // ---------------------------------------------------------------- profile
  r.get('/profile', wrap(async (req, res) => res.json(await m.profiles.get(ownerOf(req)))));
  r.put('/profile', wrap(async (req, res) => res.json(await m.profiles.update(ownerOf(req), body(ProfileInput, req)))));
  r.post('/profile/autofill', ai, wrap(async (req, res) => res.json(await m.profiles.autofill(ownerOf(req), body(z.object({ resumeId: z.string().uuid() }), req).resumeId))));
  r.post('/profile/answers', wrap(async (req, res) => res.json(await m.profiles.saveAnswer(ownerOf(req), body(SavedAnswerInput, req)))));
  r.delete('/profile/answers/:id', wrap(async (req, res) => res.json(await m.profiles.deleteAnswer(ownerOf(req), req.params.id))));

  // ---------------------------------------------------------------- applications (single apply + tracker)
  r.get('/applications', wrap(async (req, res) => res.json({ applications: await m.apps.list(ownerOf(req)) })));
  r.post('/applications/link', ai, wrap(async (req, res) => res.status(202).json(await m.apps.createFromLink(ownerOf(req), body(Link, req)))));
  r.post('/applications/manual', wrap(async (req, res) => res.status(201).json(await m.apps.createManual(ownerOf(req), body(Manual, req)))));
  r.get('/applications/:id', wrap(async (req, res) => res.json(await m.apps.get(ownerOf(req), req.params.id))));
  r.patch('/applications/:id', wrap(async (req, res) => res.json(await m.apps.update(ownerOf(req), req.params.id, body(Patch, req)))));
  r.delete('/applications/:id', wrap(async (req, res) => {
    await m.apps.remove(ownerOf(req), req.params.id);
    res.status(204).end();
  }));
  r.post('/applications/:id/approve', wrap(async (req, res) => res.status(202).json(await m.apps.approve(ownerOf(req), req.params.id, body(z.object({ submit: z.boolean() }), req).submit))));
  r.post('/applications/:id/retry', ai, wrap(async (req, res) => res.status(202).json(await m.apps.retry(ownerOf(req), req.params.id))));
  r.post('/applications/:id/prepare-anyway', ai, wrap(async (req, res) => res.status(202).json(await m.apps.prepareAnyway(ownerOf(req), req.params.id))));
  r.post(
    '/applications/:id/answers',
    wrap(async (req, res) => {
      const b = body(z.object({ answers: z.array(z.object({ question: z.string().trim().min(1).max(600), answer: z.string().max(4000), remember: z.boolean().default(true) })).min(1).max(50), submit: z.boolean().optional() }), req);
      res.status(202).json(await m.apps.provideAnswers(ownerOf(req), req.params.id, b));
    }),
  );
  r.post('/applications/:id/stage', wrap(async (req, res) => res.json(await m.apps.setStage(ownerOf(req), req.params.id, body(Stage, req)))));
  r.post('/applications/:id/email', ai, wrap(async (req, res) => res.json(await m.tracker.emailDraft(ownerOf(req), req.params.id, body(z.object({ kind: z.enum(['follow_up', 'thank_you', 'withdraw']) }), req).kind))));
  r.get('/applications/:id/resume.pdf', wrap(async (req, res) => {
    const file = await m.apps.resumePdf(ownerOf(req), req.params.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${file.filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(file.buffer);
  }));

  r.get('/tracker/overview', wrap(async (req, res) => res.json(await m.tracker.overview(ownerOf(req)))));
  r.get('/tracker/export.csv', wrap(async (req, res) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="applications-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(`\uFEFF${await m.tracker.csv(ownerOf(req))}`);
  }));

  // ---------------------------------------------------------------- job agent
  r.get('/agent/settings', wrap(async (req, res) => res.json(await m.agent.settings(ownerOf(req)))));
  r.put('/agent/settings', wrap(async (req, res) => res.json(await m.agent.updateSettings(ownerOf(req), body(AgentSettingsInput, req)))));
  r.get('/agent/status', wrap(async (req, res) => res.json(await m.agent.status(ownerOf(req)))));
  r.post('/agent/start', wrap(async (req, res) => res.json(await m.agent.start(ownerOf(req)))));
  r.post('/agent/stop', wrap(async (req, res) => res.json(await m.agent.stop(ownerOf(req)))));
  r.post('/agent/run', ai, wrap(async (req, res) => res.status(202).json(await m.agent.runNow(ownerOf(req)))));
  r.get('/agent/runs', wrap(async (req, res) => res.json({ runs: await m.agent.runs(ownerOf(req), 20) })));

  // ---------------------------------------------------------------- automation browser
  r.get('/browser/status', wrap(async (req, res) => {
    const owner = ownerOf(req);
    // Hosted: the browser is the runner's, as its last heartbeat reported it.
    res.json(config.serverless ? (await m.agent.status(owner)).browser : m.browser.status());
  }));
  r.post('/browser/open', wrap(async (req, res) => {
    ownerOf(req);
    const site = body(z.object({ site: z.enum(['linkedin', 'naukri', 'indeed', 'google']) }), req).site;
    await m.browser.openForLogin(LOGIN_SITES[site]).catch((e) => {
      throw badRequest(String(e?.message || e));
    });
    res.json(m.browser.status());
  }));
  r.post('/browser/close', wrap(async (req, res) => {
    ownerOf(req);
    await m.browser.close();
    res.json(m.browser.status());
  }));

  // ---------------------------------------------------------------- interview prep
  r.get('/interviews', wrap(async (req, res) => res.json({ sets: await m.interviews.list(ownerOf(req)) })));
  r.post('/interviews', ai, wrap(async (req, res) => res.status(201).json(await m.interviews.create(ownerOf(req), body(CreateSetInput, req)))));
  r.get('/interviews/:id', wrap(async (req, res) => res.json(await m.interviews.get(ownerOf(req), req.params.id))));
  r.delete('/interviews/:id', wrap(async (req, res) => {
    await m.interviews.remove(ownerOf(req), req.params.id);
    res.status(204).end();
  }));
  r.post('/interviews/:id/answer', ai, wrap(async (req, res) => {
    const b = body(z.object({ questionId: z.string().max(80), answer: z.string().max(8000) }), req);
    res.json(await m.interviews.answer(ownerOf(req), req.params.id, b.questionId, b.answer));
  }));

  // ---------------------------------------------------------------- live / coached interview sessions
  r.get('/interview-sessions', wrap(async (req, res) => res.json({ sessions: await m.sessions.list(ownerOf(req)), folderRoot: m.sessions.folderPath('') })));
  r.post('/interview-sessions', ai, wrap(async (req, res) => res.status(201).json(await m.sessions.start(ownerOf(req), body(StartInput, req)))));
  r.get('/interview-sessions/:id', wrap(async (req, res) => res.json(await m.sessions.get(ownerOf(req), req.params.id))));
  r.delete('/interview-sessions/:id', wrap(async (req, res) => {
    await m.sessions.remove(ownerOf(req), req.params.id);
    res.status(204).end();
  }));
  r.post('/interview-sessions/:id/respond', ai, wrap(async (req, res) => res.json(await m.sessions.respond(ownerOf(req), req.params.id, body(RespondInput, req)))));
  r.post('/interview-sessions/:id/hint', ai, wrap(async (req, res) => res.json(await m.sessions.hint(ownerOf(req), req.params.id))));
  r.post('/interview-sessions/:id/skip', ai, wrap(async (req, res) => res.json(await m.sessions.skip(ownerOf(req), req.params.id))));
  r.post('/interview-sessions/:id/finish', ai, wrap(async (req, res) => res.json(await m.sessions.finish(ownerOf(req), req.params.id))));
  r.get('/interview-sessions/:id/transcript.md', wrap(async (req, res) => {
    const t = await m.sessions.transcript(ownerOf(req), req.params.id);
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(t.filename)}"`);
    res.send(t.markdown);
  }));

  // ---------------------------------------------------------------- skills & learning
  r.get('/skills/gaps', wrap(async (req, res) => res.json(await m.skills.gapReport(ownerOf(req), { role: String(req.query.role || '').slice(0, 120), days: Math.min(90, Math.max(1, Number(req.query.days) || 30)) }))));
  r.get('/learning', wrap(async (req, res) => res.json({ plans: await m.skills.plans(ownerOf(req)) })));
  r.post('/learning', ai, wrap(async (req, res) => res.status(201).json(await m.skills.createPlan(ownerOf(req), body(PlanInput, req)))));
  r.patch('/learning/:id', wrap(async (req, res) => res.json(await m.skills.updatePlan(ownerOf(req), req.params.id, body(PlanUpdate, req)))));
  r.post('/learning/:id/confirm', wrap(async (req, res) => res.json(await m.skills.confirm(ownerOf(req), req.params.id, body(ConfirmInput, req)))));
  r.delete('/learning/:id', wrap(async (req, res) => {
    await m.skills.removePlan(ownerOf(req), req.params.id);
    res.status(204).end();
  }));

  // ---------------------------------------------------------------- career assistant
  r.post('/assistant/chat', ai, wrap(async (req, res) => res.json(await m.assistant.chat(ownerOf(req), body(ChatInput, req)))));
  r.post('/assistant/actions', wrap(async (req, res) => res.json(await m.assistant.execute(ownerOf(req), body(ActionInput, req)))));

  // ---------------------------------------------------------------- AI transparency
  r.get('/ai/prompts', wrap(async (req, res) => {
    ownerOf(req);
    res.json({ prompts: PROMPT_CATALOG, providers: m.ctx.ai.names });
  }));

  return r;
}
