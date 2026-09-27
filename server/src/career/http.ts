import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { z } from 'zod';
import { badRequest, unauthorized } from '../errors.js';

/** Async route handler → Express handler that forwards errors. */
export const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next: NextFunction) => {
    fn(req, res).catch(next);
  };

/** Validates the JSON body (400 with field messages on failure). */
export function body<S extends z.ZodTypeAny>(schema: S, req: Request): z.infer<S> {
  const r = schema.safeParse(req.body ?? {});
  if (!r.success) throw badRequest('Invalid request body.', r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`));
  return r.data;
}

/** The signed-in Firebase uid (or the single-user local owner). Everything in the career modules is owner-scoped. */
export function ownerOf(req: Request): string {
  const uid = (req as any).uid as string | undefined;
  if (!uid) throw unauthorized('Please sign in to continue.');
  return uid;
}

export const isId = (v: string) => /^[A-Za-z0-9_-]{6,80}$/.test(v);
