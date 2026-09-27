export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, 'bad_request', details);
export const unauthorized = (message = 'Missing or invalid session token.') => new HttpError(401, message, 'unauthorized');
export const notFound = (message = 'Resume session not found or expired.') => new HttpError(404, message, 'not_found');
export const conflict = (message: string, code = 'conflict') => new HttpError(409, message, code);
export const unprocessable = (message: string, details?: unknown) => new HttpError(422, message, 'unprocessable', details);

/** Raised when every AI provider failed. The current resume is left untouched. */
export class AIUnavailableError extends HttpError {
  constructor(message = 'The AI service is temporarily unavailable. Your resume was not changed — please try again.') {
    super(503, message, 'ai_unavailable');
  }
}
