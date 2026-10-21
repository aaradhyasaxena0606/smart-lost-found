/**
 * Centralised error handler (NFR-09, NFR-14).
 *
 * Guarantees:
 *   * one JSON error shape for every failure;
 *   * PostgreSQL constraint violations are translated to meaningful HTTP
 *     statuses instead of leaking SQL;
 *   * stack traces and internal details are only logged, never returned.
 */
import { ZodError } from 'zod';
import { HttpError } from '../utils/httpError.js';
import { sendError } from '../utils/respond.js';
import config from '../config/env.js';

/** Maps PostgreSQL error codes to HTTP responses. */
function translatePostgresError(error) {
  switch (error.code) {
    case '23505': // unique_violation
      return new HttpError(
        409,
        'CONFLICT',
        'That record already exists.',
        { constraint: error.constraint }
      );
    case '23503': // foreign_key_violation
      return new HttpError(400, 'INVALID_REFERENCE', 'A referenced record does not exist.', {
        constraint: error.constraint,
      });
    case '23514': // check_violation
      return new HttpError(400, 'CONSTRAINT_VIOLATION', error.message, {
        constraint: error.constraint,
      });
    case '23502': // not_null_violation
      return new HttpError(400, 'MISSING_FIELD', `Field "${error.column}" is required.`);
    case '22P02': // invalid_text_representation (e.g. bad enum/number)
    case '22007': // invalid_datetime_format
    case '22023': // invalid_parameter_value
      return new HttpError(400, 'BAD_REQUEST', 'A supplied value has an invalid format.');
    case '40001': // serialization_failure
    case '40P01': // deadlock_detected
      return new HttpError(409, 'CONFLICT', 'The request conflicted with a concurrent update. Please retry.');
    default:
      return null;
  }
}

export function errorHandler(error, req, res, _next) {
  let httpError;

  if (error instanceof HttpError) {
    httpError = error;
  } else if (error instanceof ZodError) {
    httpError = new HttpError(
      422,
      'VALIDATION_ERROR',
      'The request contains invalid or missing fields.',
      error.issues.map((issue) => ({
        field: issue.path.join('.') || '(body)',
        message: issue.message,
      }))
    );
  } else if (error.type === 'entity.parse.failed') {
    httpError = new HttpError(400, 'MALFORMED_JSON', 'The request body is not valid JSON.');
  } else if (error.type === 'entity.too.large') {
    httpError = new HttpError(413, 'PAYLOAD_TOO_LARGE', 'The request body is too large.');
  } else if (error.code === 'LIMIT_FILE_SIZE') {
    httpError = new HttpError(413, 'FILE_TOO_LARGE', `Uploads are limited to ${config.maxUploadMb} MB.`);
  } else if (error.code === 'LIMIT_UNEXPECTED_FILE') {
    httpError = new HttpError(400, 'UNEXPECTED_FILE', 'Unexpected file field in the upload.');
  } else if (typeof error.code === 'string') {
    httpError = translatePostgresError(error) ?? null;
  }

  if (!httpError) {
    httpError = new HttpError(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  }

  // Log server-side problems with context, but never log secrets or bodies.
  if (httpError.status >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl} ->`, error.message);
    if (!config.isTest) console.error(error.stack);
  } else if (!config.isTest) {
    console.warn(`[warn ] ${req.method} ${req.originalUrl} -> ${httpError.status} ${httpError.code}: ${httpError.message}`);
  }

  return sendError(res, httpError.status, httpError.code, httpError.message, httpError.details);
}

export default errorHandler;
