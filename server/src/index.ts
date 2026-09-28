import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createStore } from './db/store.js';
import { createAIChain } from './ai/provider.js';
import { createApp } from './app.js';
import { logger } from './logger.js';
import { Runner } from './career/runner.js';

const here = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  // npm run runner: this computer does the browser work for the hosted (Vercel) app.
  if (process.argv.includes('--runner')) process.env.ACA_RUNNER = 'true';
  const config = loadConfig();
  if (config.runner.enabled && (!config.firebase.projectId || !/^(firestore|postgres)/i.test(config.databaseUrl))) {
    throw new Error('The runner shares data with the hosted app: set DATABASE_URL=firestore (or the same postgres:// URL) and FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY (the same values as on Vercel).');
  }
  if (!config.firebase.projectId && !config.localOwner) {
    throw new Error('Firebase is not configured and HOST is not a loopback address. Set FIREBASE_* (sign-in) or listen on 127.0.0.1 for single-user local mode.');
  }
  const store = await createStore(config.databaseUrl, config.firebase, config.firestorePrefix);
  await store.migrate();
  const ai = createAIChain(config.ai);
  // dist/ lives at the project root; this file runs from server/src (tsx) or build/server/src (compiled).
  const staticDir = [path.resolve(here, '../../dist'), path.resolve(here, '../../../dist')].find((p) => fs.existsSync(path.join(p, 'index.html')));
  const { app, service, career } = await createApp({ config, store, ai, staticDir: process.env.STATIC_DIR || staticDir });

  const server = app.listen(config.port, config.host, () => {
    logger.info('server.started', { host: config.host, port: config.port, owner: config.localOwner ? 'single-user local mode' : 'firebase accounts', db: store.kind, ai: ai.names.length ? ai.names : 'none (rule-based fallbacks only)' });
  });

  await career.agent.init();
  const runner = config.runner.enabled ? new Runner(career) : null;
  runner?.start();

  const runCleanup = () => service.cleanup().catch((e) => logger.warn('cleanup.failed', { error: String(e?.message || e) }));
  runCleanup();
  const timer = setInterval(runCleanup, 60 * 60 * 1000);
  timer.unref();

  const shutdown = async () => {
    clearInterval(timer);
    runner?.stop();
    career.agent.shutdown();
    await career.browser.close();
    server.close();
    await store.close().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  logger.error('server.failed', { error: String(e?.stack || e) });
  process.exit(1);
});
