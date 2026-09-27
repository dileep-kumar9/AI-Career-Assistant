import type { RequestHandler } from 'express';
import type { AppConfig } from '../config.js';
import { unauthorized } from '../errors.js';
import { logger } from '../logger.js';

/**
 * Verifies the Firebase ID token sent by the browser in `X-Firebase-Auth` and
 * exposes the user's uid as `req.uid`. Requests without the header continue as
 * guests (the service decides whether guests are allowed). When Firebase is
 * not configured the header is ignored.
 */
export function firebaseAuth(config: AppConfig, override?: (token: string) => Promise<{ uid: string }>): RequestHandler {
  if (!config.firebase.projectId && !override) {
    // Single-user local mode (no Firebase, loopback only): everything belongs to one fixed owner.
    const owner = config.localOwner;
    return (req, _res, next) => {
      if (owner) (req as any).uid = owner;
      next();
    };
  }
  let verify: ((token: string) => Promise<{ uid: string }>) | null = override || null;
  const verifier = async () => {
    if (!verify) verify = await idTokenVerifier(config.firebase.projectId);
    return verify;
  };
  return (req, _res, next) => {
    const token = req.get('x-firebase-auth');
    if (!token) return next();
    verifier()
      .then((v) => v(token))
      .then((decoded) => {
        (req as any).uid = decoded.uid;
        next();
      })
      .catch((e) => {
        // The reason (e.g. wrong project / audience, expired, bad signature) — never the token itself.
        logger.warn('auth.rejected', { code: e?.errorInfo?.code || e?.code, reason: String(e?.errorInfo?.message || e?.message || e).slice(0, 300) });
        const expired = /expired/i.test(String(e?.errorInfo?.code || e?.message));
        next(unauthorized(expired ? 'Your sign-in has expired. Please sign in again.' : 'Sign-in could not be verified by the server. Please sign out and sign in again; if it keeps happening, the server’s Firebase settings need checking.'));
      });
  };
}

/**
 * Firebase ID-token verification as documented by Firebase ("verify ID tokens
 * using a third-party JWT library"): RS256 signature against Google's
 * securetoken keys, issuer https://securetoken.google.com/<project>, audience
 * <project>, not expired, issued/authenticated in the past, non-empty subject.
 * Done with `jose` directly because firebase-admin's own verifier loads it via
 * require(), which fails in the Vercel runtime.
 */
async function idTokenVerifier(projectId: string): Promise<(token: string) => Promise<{ uid: string }>> {
  const { createRemoteJWKSet, jwtVerify } = await import('jose');
  const keys = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
  return async (token: string) => {
    const { payload } = await jwtVerify(token, keys, {
      algorithms: ['RS256'],
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
      clockTolerance: 30,
    });
    const now = Date.now() / 1000;
    if (!payload.sub || typeof payload.sub !== 'string') throw new Error('Token has no subject.');
    if (typeof payload.auth_time === 'number' && payload.auth_time > now + 30) throw new Error('auth_time is in the future.');
    return { uid: payload.sub };
  };
}
