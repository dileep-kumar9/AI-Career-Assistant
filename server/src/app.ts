import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import type { AppConfig } from './config.js';
import type { Store } from './db/store.js';
import type { AIChain } from './ai/provider.js';
import { ResumeService } from './services/resumeService.js';
import { resumeRoutes } from './routes/resumes.js';
import { HttpError } from './errors.js';
import { firebaseAuth } from './middleware/firebaseAuth.js';
import { logger } from './logger.js';

export interface AppDeps {
  config: AppConfig;
  store: Store;
  ai: AIChain;
  /** Directory with the built frontend (served in production). */
  staticDir?: string;
  /** Test hook: replaces Firebase ID-token verification. */
  verifyIdToken?: (token: string) => Promise<{ uid: string }>;
}

export async function createApp(deps: AppDeps) {
  const { config, store, ai } = deps;
  const service = new ResumeService(store, ai, config);
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", 'https://apis.google.com', 'https://www.gstatic.com'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'blob:', 'https://lh3.googleusercontent.com'],
          workerSrc: ["'self'", 'blob:'],
          frameSrc: ["'self'", 'blob:', 'https://*.firebaseapp.com', 'https://accounts.google.com'],
          objectSrc: ["'self'", 'blob:'],
          // Firebase Authentication (sign-in, token refresh)
          connectSrc: ["'self'", 'https://identitytoolkit.googleapis.com', 'https://securetoken.googleapis.com', 'https://www.googleapis.com', 'https://apis.google.com'],
        },
      },
      crossOriginEmbedderPolicy: false,
      // signInWithPopup (Google) needs to talk to its popup window.
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    }),
  );

  // Request log: method, path pattern, status and duration only (never bodies).
  app.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      if (req.path.startsWith('/api/')) logger.info('http', { method: req.method, path: req.path.replace(/[0-9a-f-]{36}/gi, ':id'), status: res.statusCode, ms: Date.now() - started });
    });
    next();
  });

  app.use(
    '/api/',
    rateLimit({ windowMs: config.rateLimit.windowMs, limit: config.rateLimit.general, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many requests. Please slow down.', code: 'rate_limited' } }),
  );

  app.use(express.json({ limit: '1mb' }));
  app.get('/api/health', (_req, res) => res.json({ ok: true, db: store.kind, ai: ai.names }));
  app.get('/api/config', (_req, res) => res.json({ requireAuth: config.requireAuth, authEnabled: !!config.firebase.projectId || !!deps.verifyIdToken }));
  app.use('/api/resumes', firebaseAuth(config, deps.verifyIdToken), resumeRoutes(service, config));
  // Scheduled cleanup of expired guest sessions (Vercel Cron sends Authorization: Bearer <CRON_SECRET>).
  app.get('/api/cron/cleanup', (req, res, next) => {
    if (!process.env.CRON_SECRET || req.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: 'Unauthorized' });
    service.cleanup().then((removed) => res.json({ removed }), next);
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));

  if (deps.staticDir && fs.existsSync(path.join(deps.staticDir, 'index.html'))) {
    app.use(express.static(deps.staticDir, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(deps.staticDir!, 'index.html')));
  }

  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code, details: err.details });
    if (err instanceof multer.MulterError) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return res.status(tooBig ? 413 : 400).json({ error: tooBig ? `The file is too large. The maximum size is ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB.` : `Upload error: ${err.message}`, code: err.code });
    }
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body.', code: 'bad_json' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large.', code: 'too_large' });
    logger.error('unhandled', { path: req.path.replace(/[0-9a-f-]{36}/gi, ':id'), error: String(err?.message || err).slice(0, 300) });
    res.status(500).json({ error: 'Something went wrong on the server. Your resume was not changed.', code: 'internal' });
  });

  return { app, service };
}
