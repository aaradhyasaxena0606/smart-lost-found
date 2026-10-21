/**
 * Request validation middleware built on zod.
 *
 * Controllers therefore never see untrusted shapes: `req.body`, `req.query` and
 * `req.params` are replaced by the parsed (and coerced) result. Validation
 * always runs on the server, even though the UI validates too (spec 2/16).
 */
import { z } from 'zod';
import { unprocessable } from '../utils/httpError.js';

/**
 * @param {{body?: import('zod').ZodTypeAny, query?: import('zod').ZodTypeAny, params?: import('zod').ZodTypeAny}} schemas
 */
export function validate(schemas = {}) {
  return (req, _res, next) => {
    try {
      if (schemas.params) {
        req.params = schemas.params.parse(req.params);
      }
      if (schemas.query) {
        // Express 5 exposes req.query as a getter; assigning a plain object is
        // still supported in Express 4 and keeps the parsed value available.
        req.validatedQuery = schemas.query.parse(req.query);
      }
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      return next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return next(
          unprocessable(
            'The request contains invalid or missing fields.',
            error.issues.map((issue) => ({
              field: issue.path.join('.') || '(body)',
              message: issue.message,
              code: issue.code,
            }))
          )
        );
      }
      return next(error);
    }
  };
}

/** Reusable field schemas shared by several endpoints. */
export const commonSchemas = {
  idParam: z.object({
    itemId: z.coerce.number().int().positive().optional(),
    claimId: z.coerce.number().int().positive().optional(),
    matchId: z.coerce.number().int().positive().optional(),
    notificationId: z.coerce.number().int().positive().optional(),
  }),
};

export default validate;
