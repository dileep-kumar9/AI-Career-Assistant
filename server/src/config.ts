import path from 'node:path';
import { DEFAULT_WEIGHTS, normalizeWeights, type AtsWeights } from '../../shared/ats.js';

export interface AppConfig {
  appName: string;
  port: number;
  /** Interface to listen on. Defaults to loopback: the app can drive a browser and submit applications. */
  host: string;
  nodeEnv: string;
  databaseUrl: string;
  dataDir: string;
  sessionTtlDays: number;
  maxUploadBytes: number;
  atsWeights: AtsWeights;
  atsSemantic: boolean;
  rateLimit: { windowMs: number; general: number; ai: number };
  trustProxy: boolean;
  /** Firebase (Auth + optional Firestore). Empty projectId = sign-in disabled. */
  firebase: { projectId: string; clientEmail: string; privateKey: string };
  /** Only signed-in users may create and open resumes. */
  requireAuth: boolean;
  /**
   * Single-user local mode: no Firebase configured, so every request acts as
   * the fixed owner "local". Only allowed while listening on loopback.
   */
  localOwner: string | null;
  /** Firestore collection prefix; keeps this app's data apart from resume-creator-ai in a shared project. */
  firestorePrefix: string;
  /**
   * Serverless host (Vercel): no browser, no timers, no lasting disk. Browser
   * work (applying, reading login-only pages, the job agent) is queued for the
   * runner on your computer.
   */
  serverless: boolean;
  /** This process is the runner: it does the queued browser work and the job agent for these owners. */
  runner: { enabled: boolean; owners: string[]; pollMs: number };
  automation: {
    /** Chrome profile used for job sites (you log in to LinkedIn/Naukri/Indeed there once). */
    browserProfileDir: string;
    /** 'chrome' uses your installed Google Chrome; 'msedge' or 'chromium' also work. */
    browserChannel: string;
    headless: boolean;
    /** Tailored PDFs and cover letters generated for applications. */
    filesDir: string;
    /** Fill forms but never press Submit (global safety switch). */
    forceDryRun: boolean;
  };
  ai: {
    order: string[];
    anthropicKey: string;
    anthropicModel: string;
    anthropicEffort: string;
    anthropicFallbacks: boolean;
    geminiKey: string;
    geminiModel: string;
    geminiFallbackModel: string;
    groqKey: string;
    groqModel: string;
    mistralKey: string;
    mistralModel: string;
    timeoutMs: number;
  };
}

function parseWeights(raw: string | undefined): AtsWeights {
  if (!raw) return { ...DEFAULT_WEIGHTS };
  try {
    return normalizeWeights(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_WEIGHTS };
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  // Hosted without a browser: Vercel, Render (sets RENDER=true) or ACA_HOSTED=true.
  const serverless = !!env.VERCEL || env.RENDER === 'true' || env.ACA_HOSTED === 'true';
  // Only /tmp is writable on serverless hosts (and it does not last).
  const dataDir = path.resolve(env.DATA_DIR || (serverless ? '/tmp/aca-data' : './data'));
  const host = (env.HOST || '127.0.0.1').trim();
  const projectId = (env.FIREBASE_PROJECT_ID || '').trim().replace(/^"|"$/g, '');
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(host);
  return {
    appName: 'AI Career Assistant',
    port: Number(env.PORT || 8790),
    host,
    nodeEnv: env.NODE_ENV || 'development',
    // postgres://… uses PostgreSQL; anything else (or empty) uses SQLite.
    // "firestore" uses Cloud Firestore (FIREBASE_* credentials).
    databaseUrl: env.DATABASE_URL || `sqlite:${path.join(dataDir, 'ai-career-assistant.db')}`,
    dataDir,
    sessionTtlDays: Number(env.SESSION_TTL_DAYS || 30),
    maxUploadBytes: Number(env.MAX_UPLOAD_MB || 5) * 1024 * 1024,
    atsWeights: parseWeights(env.ATS_WEIGHTS),
    atsSemantic: env.ATS_SEMANTIC_ANALYSIS !== 'false',
    rateLimit: {
      windowMs: Number(env.RATE_LIMIT_WINDOW_MS || 60_000),
      general: Number(env.RATE_LIMIT_GENERAL || 300),
      ai: Number(env.RATE_LIMIT_AI || 20),
    },
    trustProxy: env.TRUST_PROXY === 'true' || !!env.VERCEL || env.RENDER === 'true',
    firebase: {
      // Trimmed and unquoted: values pasted into hosting dashboards often carry stray spaces or newlines.
      projectId: (env.FIREBASE_PROJECT_ID || '').trim().replace(/^"|"$/g, ''),
      clientEmail: (env.FIREBASE_CLIENT_EMAIL || '').trim().replace(/^"|"$/g, ''),
      // Env vars usually store the key with literal "\n" sequences.
      // Surrounding quotes pasted into a hosting dashboard are removed too.
      privateKey: (env.FIREBASE_PRIVATE_KEY || '').trim().replace(/^"([\s\S]*)"$/, '$1').replace(/\\n/g, '\n'),
    },
    requireAuth: env.REQUIRE_AUTH ? env.REQUIRE_AUTH.trim() === 'true' : !!projectId,
    localOwner: !projectId && loopback && env.LOCAL_SINGLE_USER !== 'false' ? 'local' : null,
    firestorePrefix: (env.FIRESTORE_PREFIX ?? 'aca_').trim(),
    serverless,
    runner: {
      enabled: env.ACA_RUNNER === 'true' && !serverless,
      owners: (env.RUNNER_OWNERS || '').split(',').map((s) => s.trim()).filter(Boolean),
      pollMs: Math.max(5_000, Number(env.RUNNER_POLL_MS || 15_000)),
    },
    automation: {
      browserProfileDir: path.resolve(env.BROWSER_PROFILE_DIR || path.join(dataDir, 'browser-profile')),
      browserChannel: (env.BROWSER_CHANNEL || 'chrome').trim(),
      headless: env.BROWSER_HEADLESS === 'true',
      filesDir: path.join(dataDir, 'applications'),
      forceDryRun: env.AUTOMATION_DRY_RUN === 'true',
    },
    ai: {
      order: (env.AI_PROVIDER_ORDER || 'gemini,groq,mistral,anthropic').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
      anthropicKey: env.ANTHROPIC_API_KEY || '',
      anthropicModel: env.ANTHROPIC_MODEL || 'claude-opus-5',
      anthropicEffort: env.ANTHROPIC_EFFORT || '',
      anthropicFallbacks: env.ANTHROPIC_FALLBACKS !== 'false',
      geminiKey: env.GEMINI_API_KEY || '',
      geminiModel: env.GEMINI_MODEL || env.GEMINI_PARSER_MODEL || 'gemini-3.8-flash',
      // Used when the main Gemini model is busy (free tier "high demand" errors).
      geminiFallbackModel: env.GEMINI_FALLBACK_MODEL || env.GEMINI_PARSER_MODEL || 'gemini-3.1-flash-lite',
      groqKey: env.GROQ_API_KEY || '',
      groqModel: env.GROQ_MODEL || 'openai/gpt-oss-120b',
      mistralKey: env.MISTRAL_API_KEY || '',
      mistralModel: env.MISTRAL_MODEL || 'mistral-small-latest',
      timeoutMs: Number(env.AI_TIMEOUT_MS || 120_000),
    },
  };
}
