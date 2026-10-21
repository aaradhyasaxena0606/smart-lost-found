/**
 * Health endpoint (spec 14 "Administration and Health").
 *
 * Reports liveness plus an optional database readiness check. It never reveals
 * credentials, hosts or connection strings: only a boolean, the database name and
 * the PostGIS version, which are safe and genuinely useful.
 */
import { Router } from 'express';
import { checkConnection } from '../../config/db.js';
import { describeAiStatus } from '../../integrations/ai/index.js';
import config from '../../config/env.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

export const healthRouter = Router();

healthRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const withDatabase = req.query.db === '1' || req.query.db === 'true';

    const payload = {
      status: 'ok',
      environment: config.nodeEnv,
      uptimeSeconds: Math.round(process.uptime()),
      ai: describeAiStatus(),
      matching: {
        radiusMeters: config.matching.radiusMeters,
        maxDays: config.matching.maxDays,
        minScore: config.matching.minScore,
        weights: config.matching.weights,
      },
    };

    if (withDatabase) {
      try {
        const database = await checkConnection();
        payload.checks = {
          database: {
            status: 'ok',
            name: database.database,
            postgisVersion: database.postgisVersion,
            latencyMs: database.latencyMs,
          },
        };
      } catch {
        // Deliberately vague: no host, port, user or error text.
        payload.status = 'degraded';
        payload.checks = { database: { status: 'unavailable' } };
        return res.status(503).json(payload);
      }
    }

    return res.status(200).json(payload);
  })
);

export default healthRouter;
