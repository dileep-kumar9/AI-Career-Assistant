import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Express } from 'express';
import { loadConfig } from './config.js';
import { createStore } from './db/store.js';
import { createAIChain } from './ai/provider.js';
import { createApp } from './app.js';
import { RemoteBrowser } from './career/automation/browser.js';
import { logger } from './logger.js';

/**
 * Vercel serverless entry (api/index.js → here). The same Express app as the
 * local server, without a browser: applying, login-only pages and the job
 * agent are queued for the runner on your computer (npm run runner).
 * The app is built once per function instance and reused between requests.
 */
let appPromise: Promise<Express> | null = null;

async function build(): Promise<Express> {
  const config = loadConfig();
  if (!config.firebase.projectId) throw new Error('Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY on Vercel: the hosted app needs sign-in.');
  if (!/^(firestore|postgres)/i.test(config.databaseUrl)) throw new Error('Set DATABASE_URL=firestore (or a postgres:// URL) on Vercel: serverless functions have no lasting disk for SQLite.');
  const store = await createStore(config.databaseUrl, config.firebase, config.firestorePrefix);
  await store.migrate();
  const ai = createAIChain(config.ai);
  const { app } = await createApp({ config, store, ai, browser: new RemoteBrowser(config.automation) });
  logger.info('serverless.ready', { db: store.kind, ai: ai.names });
  return app;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (!appPromise) {
    appPromise = build().catch((e) => {
      appPromise = null;
      throw e;
    });
  }
  try {
    const app = await appPromise;
    app(req as any, res as any);
  } catch (e) {
    logger.error('serverless.start_failed', { error: String((e as Error)?.message || e).slice(0, 300) });
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: String((e as Error)?.message || 'The server could not start.'), code: 'startup' }));
  }
}
