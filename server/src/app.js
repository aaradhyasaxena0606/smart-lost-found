/**
 * Express application assembly.
 *
 * Security posture (spec 16):
 *   * helmet sets conservative security headers;
 *   * CORS is an explicit allow-list from CLIENT_ORIGIN, not "*";
 *   * JSON bodies are size limited;
 *   * uploaded files are served read-only with `Content-Disposition: inline`
 *     and `X-Content-Type-Options: nosniff`, so an upload can never be executed;
 *   * authentication endpoints are rate limited;
 *   * no stack traces or secrets are ever sent to clients.
 */
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import path from 'node:path';
import fs from 'node:fs';
import config from './config/env.js';
import { apiRouter } from './routes/index.js';
import { notFoundHandler } from './middleware/notFound.js';
import { errorHandler } from './middleware/errorHandler.js';
import { apiLimiter } from './middleware/rateLimit.js';

export function createApp() {
  const app = express();

  // Behind a reverse proxy the real client IP is in X-Forwarded-For; only trust
  // it when explicitly configured.
  if (config.trustProxy) app.set('trust proxy', 1);

  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'img-src': ["'self'", 'data:', 'blob:'],
          'script-src': ["'self'"],
          'object-src': ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );

  app.use(
    cors({
      origin(origin, callback) {
        // Allow same-origin/tooling requests with no Origin header.
        if (!origin) return callback(null, true);
        if (config.clientOrigins.includes(origin)) return callback(null, true);
        return callback(new Error(`Origin ${origin} is not allowed by CORS.`));
      },
      credentials: false,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 600,
    })
  );

  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));

  if (config.logRequests && !config.isTest) {
    // `tiny` never includes headers or body content, so no tokens are logged.
    app.use(morgan('tiny'));
  }

  // Uploaded images are public assets but must stay inert.
  fs.mkdirSync(config.uploadDir, { recursive: true });
  app.use(
    '/uploads',
    express.static(config.uploadDir, {
      index: false,
      dotfiles: 'deny',
      maxAge: '1h',
      setHeaders(res) {
        res.setHeader('Content-Disposition', 'inline');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      },
    })
  );

  app.get('/', (_req, res) => {
    res.json({
      data: {
        name: 'Smart Lost & Found API',
        version: 'v1',
        documentation: '/docs/api-reference.md',
        health: '/api/v1/health',
      },
    });
  });

  app.use('/api/v1', apiLimiter, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export const uploadDirectory = path.resolve(config.uploadDir);
export default createApp;
