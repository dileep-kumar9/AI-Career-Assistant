import crypto from 'node:crypto';
import type { AppConfig } from '../config.js';
import type { Store } from '../db/store.js';
import type { AIChain } from '../ai/provider.js';
import type { ResumeService } from '../services/resumeService.js';

/** Everything the career modules need; built once in createApp(). */
export interface CareerContext {
  config: AppConfig;
  store: Store;
  ai: AIChain;
  resumes: ResumeService;
}

let lastTs = 0;
/** Strictly increasing ISO timestamps (stable ordering of documents written in the same millisecond). */
export function now(): string {
  const t = Math.max(Date.now(), lastTs + 1);
  lastTs = t;
  return new Date(t).toISOString();
}

export const newId = () => crypto.randomUUID();

/** Short stable hash (dedupe keys, cache keys). */
export const hashOf = (s: string) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 24);
