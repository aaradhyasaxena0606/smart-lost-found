/**
 * Consistent response envelopes (spec 14).
 *
 *   success:  { "data": ..., "meta": { ... } }
 *   error:    { "error": { "code": "...", "message": "...", "details": ... } }
 */
import { HttpError } from './httpError.js';

/** Sends 200 with a data envelope. */
export function sendOk(res, data, meta) {
  const body = meta === undefined ? { data } : { data, meta };
  return res.status(200).json(body);
}

/** Sends 201 with a data envelope and optional Location header. */
export function sendCreated(res, data, location) {
  if (location) res.setHeader('Location', location);
  return res.status(201).json({ data });
}

/** Sends 204 with no body. */
export function sendNoContent(res) {
  return res.status(204).end();
}

/** The single error serialiser used by the error handler middleware. */
export function sendError(res, status, code, message, details) {
  const error = { code, message };
  if (details !== undefined && details !== null) error.details = details;
  return res.status(status).json({ error });
}

export { HttpError };
export default { sendOk, sendCreated, sendNoContent, sendError };
