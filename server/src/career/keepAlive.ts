import { waitUntil } from '@vercel/functions';

/**
 * Keeps a serverless function alive until background work (reading a job,
 * tailoring) finishes after the response was sent. On a normal server the
 * process stays up anyway and this does nothing.
 */
export function keepAlive(work: Promise<unknown>): void {
  if (!process.env.VERCEL) return;
  try {
    waitUntil(work.catch(() => undefined));
  } catch {
    /* outside a request: nothing to extend */
  }
}
