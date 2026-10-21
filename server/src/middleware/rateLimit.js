/**
 * Rate limiting (spec 16: "rate limits for authentication endpoints").
 *
 * Policy
 * ------
 *   * Authentication endpoints (register, login) get a strict limiter to slow
 *     credential stuffing.
 *   * The rest of the API gets a generous global limiter.
 *   * Production defaults: 10 auth requests and 300 API requests per IP per
 *     15-minute window.
 *   * Development/test defaults are far higher (1000 / 10000) so that running the
 *     automated suite or clicking through the UI repeatedly does not lock the
 *     developer out. Both are overridable with RATE_LIMIT_AUTH_MAX and
 *     RATE_LIMIT_API_MAX, and the window with RATE_LIMIT_WINDOW_MINUTES.
 *   * Limiting is disabled entirely under NODE_ENV=test.
 */
import rateLimit from 'express-rate-limit';
import config from '../config/env.js';

const baseOptions = {
  windowMs: config.rateLimit.windowMs,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => config.isTest,
  handler: (_req, res) =>
    res.status(429).json({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please try again later.',
      },
    }),
};

export const authLimiter = rateLimit({ ...baseOptions, limit: config.rateLimit.authMax });

export const apiLimiter = rateLimit({ ...baseOptions, limit: config.rateLimit.apiMax });

export default { authLimiter, apiLimiter };
