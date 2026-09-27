import { Router, type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { Cred, ResumeService } from '../services/resumeService.js';
import type { AppConfig } from '../config.js';
import { badRequest } from '../errors.js';

/** Session token from `Authorization: Bearer <token>` or `X-Session-Token`. */
function sessionToken(req: Request): string | undefined {
  const auth = req.get('authorization');
  if (auth && /^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, '').trim();
  return req.get('x-session-token') || undefined;
}

/** Firebase uid verified by the firebaseAuth middleware (signed-in users). */
const uidOf = (req: Request): string | undefined => (req as any).uid;

/** Guest token and/or signed-in uid. */
function tokenOf(req: Request): Cred {
  return { token: sessionToken(req), uid: uidOf(req) };
}

const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next: NextFunction) => {
    fn(req, res).catch(next);
  };

function body<T>(schema: z.ZodType<T>, req: Request): T {
  const r = schema.safeParse(req.body ?? {});
  if (!r.success) throw badRequest('Invalid request body.', r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`));
  return r.data;
}

const Paste = z.object({ text: z.string().min(1).max(60_000) });
const Jd = z.object({ jobDescription: z.string().min(1).max(30_000) });
const JdUrl = z.object({ url: z.string().url().max(2000) });
const JdPatch = z.object({
  jobTitle: z.string().max(200).optional(),
  company: z.string().max(200).optional(),
  requiredSkills: z.array(z.string().max(100)).max(80).optional(),
  preferredSkills: z.array(z.string().max(100)).max(80).optional(),
  atsKeywords: z.array(z.string().max(100)).max(80).optional(),
  certifications: z.array(z.string().max(150)).max(40).optional(),
  tools: z.array(z.string().max(100)).max(80).optional(),
});
const Edit = z.object({ instruction: z.string().min(1).max(30_000) });
const Original = z.object({ text: z.string().max(60_000).optional(), resume: z.record(z.any()).optional() });
const Manual = z.object({ resume: z.record(z.any()), label: z.string().max(80).optional() });
const Design = z.object({
  template: z.string().optional(),
  fontSize: z.string().optional(),
  margins: z.string().optional(),
  pageTarget: z.union([z.literal(1), z.literal(2)]).optional(),
  pageFormat: z.string().optional(),
  sections: z.array(z.object({ id: z.string(), visible: z.boolean(), title: z.string().max(60).optional() })).max(20).optional(),
  style: z.record(z.any()).nullable().optional(),
});
const Export = z.object({ versionId: z.string().uuid().optional() });
const Rename = z.object({ title: z.string().min(1).max(120) });

export function resumeRoutes(service: ResumeService, config: AppConfig): Router {
  const r = Router();
  const upload = multer({
    storage: multer.memoryStorage(), // nothing is written to a temp directory
    limits: { fileSize: config.maxUploadBytes, files: 1, fields: 5 },
  });
  // Stricter limit for endpoints that call the AI provider or parse documents.
  const aiLimiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    limit: config.rateLimit.ai,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many AI requests. Please wait a minute and try again.', code: 'rate_limited' },
  });

  r.post(
    '/upload',
    aiLimiter,
    upload.single('file'),
    wrap(async (req, res) => {
      if (!req.file) throw badRequest('Attach a PDF or DOCX file in the "file" field.');
      res.status(201).json(await service.createFromUpload({ buffer: req.file.buffer, originalname: req.file.originalname, size: req.file.size }, uidOf(req) ?? null));
    }),
  );

  r.post('/paste', aiLimiter, wrap(async (req, res) => res.status(201).json(await service.createFromPaste(body(Paste, req).text, uidOf(req) ?? null))));

  // Signed-in users: their resumes on any device, and moving guest resumes into the account.
  r.get('/', wrap(async (req, res) => res.json({ resumes: await service.listMine(uidOf(req)) })));
  r.post('/:id/claim', wrap(async (req, res) => res.json(await service.claim(req.params.id, sessionToken(req), uidOf(req)))));

  r.get('/:id', wrap(async (req, res) => res.json(await service.get(req.params.id, tokenOf(req)))));
  r.patch('/:id', wrap(async (req, res) => res.json(await service.rename(req.params.id, tokenOf(req), body(Rename, req).title))));
  r.delete(
    '/:id',
    wrap(async (req, res) => {
      await service.remove(req.params.id, tokenOf(req));
      res.status(204).end();
    }),
  );

  r.put('/:id/original', aiLimiter, wrap(async (req, res) => res.json(await service.correctOriginal(req.params.id, tokenOf(req), body(Original, req)))));
  r.get(
    '/:id/original/file',
    wrap(async (req, res) => {
      const f = await service.originalFile(req.params.id, tokenOf(req));
      res.setHeader('Content-Type', f.mime);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(f.name)}"`);
      res.setHeader('Cache-Control', 'private, no-store');
      res.send(f.buffer);
    }),
  );

  r.post('/:id/job-description', aiLimiter, wrap(async (req, res) => res.json(await service.setJobDescription(req.params.id, tokenOf(req), body(Jd, req).jobDescription))));
  r.post('/:id/job-description/url', aiLimiter, wrap(async (req, res) => res.json(await service.setJobDescriptionFromUrl(req.params.id, tokenOf(req), body(JdUrl, req).url))));
  r.patch('/:id/job-description/analysis', wrap(async (req, res) => res.json(await service.updateJdAnalysis(req.params.id, tokenOf(req), body(JdPatch, req)))));

  r.post('/:id/generate', aiLimiter, wrap(async (req, res) => res.json(await service.generate(req.params.id, tokenOf(req)))));
  r.post(
    '/:id/attachment',
    aiLimiter,
    upload.single('file'),
    wrap(async (req, res) => {
      if (!req.file) throw badRequest('Attach a file in the "file" field.');
      const message = typeof req.body?.message === 'string' ? req.body.message.slice(0, 2000) : '';
      res.json(await service.attach(req.params.id, tokenOf(req), { buffer: req.file.buffer, originalname: req.file.originalname }, message));
    }),
  );
  r.post('/:id/edit', aiLimiter, wrap(async (req, res) => res.json(await service.edit(req.params.id, tokenOf(req), body(Edit, req).instruction))));
  r.put('/:id/current', wrap(async (req, res) => {
    const b = body(Manual, req);
    res.json(await service.saveManual(req.params.id, tokenOf(req), b.resume, b.label));
  }));
  r.patch('/:id/design', wrap(async (req, res) => res.json(await service.updateDesign(req.params.id, tokenOf(req), body(Design, req)))));

  r.get('/:id/versions', wrap(async (req, res) => res.json({ versions: await service.listVersions(req.params.id, tokenOf(req)) })));
  r.get('/:id/versions/:versionId', wrap(async (req, res) => res.json(await service.getVersion(req.params.id, tokenOf(req), req.params.versionId))));
  r.get(
    '/:id/compare',
    wrap(async (req, res) => {
      const from = String(req.query.from || '');
      const to = String(req.query.to || '');
      if (!from || !to) throw badRequest('Provide "from" and "to" version ids.');
      res.json(await service.compare(req.params.id, tokenOf(req), from, to));
    }),
  );
  r.post('/:id/restore/:versionId', wrap(async (req, res) => res.json(await service.restore(req.params.id, tokenOf(req), req.params.versionId))));
  r.post('/:id/undo', wrap(async (req, res) => res.json(await service.undo(req.params.id, tokenOf(req)))));
  r.post('/:id/redo', wrap(async (req, res) => res.json(await service.redo(req.params.id, tokenOf(req)))));

  r.get('/:id/ats-score', wrap(async (req, res) => res.json(await service.atsScore(req.params.id, tokenOf(req)))));
  r.post('/:id/ats-score/recalculate', aiLimiter, wrap(async (req, res) => res.json(await service.recalculate(req.params.id, tokenOf(req)))));

  for (const format of ['pdf', 'docx'] as const) {
    r.post(
      `/:id/export/${format}`,
      wrap(async (req, res) => {
        const b = body(Export, req);
        const file = await service.exportFile(req.params.id, tokenOf(req), format, b.versionId);
        res.setHeader('Content-Type', format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
        res.setHeader('X-Page-Count', String(file.pageCount));
        res.setHeader('Cache-Control', 'private, no-store');
        res.send(file.buffer);
      }),
    );
  }

  r.get('/:id/review', wrap(async (req, res) => res.json(await service.review(req.params.id, tokenOf(req)))));
  r.post('/:id/finish', wrap(async (req, res) => res.json(await service.finish(req.params.id, tokenOf(req)))));
  r.post('/:id/reopen', wrap(async (req, res) => res.json(await service.reopen(req.params.id, tokenOf(req)))));
  return r;
}
