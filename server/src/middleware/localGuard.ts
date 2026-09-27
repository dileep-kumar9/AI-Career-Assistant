import type { RequestHandler } from 'express';
import { HttpError } from '../errors.js';

/**
 * Protections for an app that listens on localhost and can drive a browser:
 *
 * 1. DNS rebinding: when listening on loopback, only accept requests whose
 *    Host header is localhost / 127.0.0.1 / [::1]. A malicious site that
 *    rebinds its own domain to 127.0.0.1 is rejected.
 * 2. CSRF in single-user local mode (no Firebase, so requests need no token):
 *    every state-changing /api request must carry the X-ACA-Client header.
 *    Browsers only let other sites send custom headers after a CORS
 *    preflight, and this server never allows cross-origin requests.
 */
export function localGuard(opts: { loopback: boolean; ambientAuthority: boolean }): RequestHandler {
  const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
  return (req, _res, next) => {
    if (opts.loopback) {
      const host = (req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
      if (!allowedHosts.has(host)) return next(new HttpError(403, 'Requests must be made to localhost.', 'bad_host'));
    }
    if (opts.ambientAuthority && req.path.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !req.get('x-aca-client')) {
      return next(new HttpError(403, 'Missing X-ACA-Client header.', 'csrf'));
    }
    next();
  };
}
