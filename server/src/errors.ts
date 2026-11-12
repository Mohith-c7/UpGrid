import { ZodError } from 'zod';
import type { NextFunction, Request, Response, RequestHandler } from 'express';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, fields?: Record<string, string>) =>
  new ApiError(400, 'VALIDATION_ERROR', message, fields);
export const unauthorized = (message = 'Authentication required', code = 'UNAUTHORIZED') =>
  new ApiError(401, code, message);
export const forbidden = (message = 'You do not have access to this resource', code = 'FORBIDDEN') =>
  new ApiError(403, code, message);
export const notFound = (message = 'Not found', code = 'NOT_FOUND') => new ApiError(404, code, message);
export const conflict = (code: string, message: string, fields?: Record<string, string>) =>
  new ApiError(409, code, message, fields);
export const unprocessable = (code: string, message: string, fields?: Record<string, string>) =>
  new ApiError(422, code, message, fields);

export function zodFields(err: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

export function parse<T>(schema: { safeParse: (v: unknown) => any }, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) {
    const fields = zodFields(r.error);
    const first = Object.values(fields)[0];
    throw new ApiError(400, 'VALIDATION_ERROR', first ? String(first) : 'Invalid request', fields);
  }
  return r.data as T;
}

export const wrap =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

export function errorHandler(logger: (msg: string) => void = (m) => console.error(m)) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return (err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    if (err instanceof ApiError) {
      const body: any = { error: { code: err.code, message: err.message } };
      if (err.fields) body.error.fields = err.fields;
      return res.status(err.status).json(body);
    }
    if (err instanceof ZodError) {
      const fields = zodFields(err);
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request', fields } });
    }
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(400).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' } });
    }
    if (err?.code === '23505') {
      return res.status(409).json({ error: { code: 'CONFLICT', message: 'This record already exists' } });
    }
    if (err?.code === '22P02') {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid identifier' } });
    }
    // Never leak internals: log the message only, return a generic body.
    logger(`[error] ${err?.message ?? String(err)}`);
    return res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } });
  };
}
