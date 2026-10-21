/**
 * Server bootstrap.
 *
 * Verifies the database is reachable and that PostGIS is installed, then starts
 * listening. Shuts down gracefully so in-flight requests finish and the pool
 * closes cleanly.
 */
import { createApp } from './app.js';
import config from './config/env.js';
import { checkConnection, closePool } from './config/db.js';
import { getAiProvider } from './integrations/ai/index.js';

async function main() {
  const app = createApp();

  // Fail fast on a broken database unless we are in development, where a
  // degraded health response is more useful than refusing to boot.
  try {
    const database = await checkConnection();
    console.log(
      `[db] connected to "${database.database}" (PostGIS ${database.postgisVersion ?? 'not installed'})`
    );
    if (!database.postgisVersion) {
      console.warn(
        '[db] WARNING: the PostGIS extension is not installed in this database. ' +
          'Run "npm run db:migrate" — spatial search requires it.'
      );
    }
  } catch (error) {
    const message = `[db] could not connect: ${error.message}`;
    if (config.isProduction) {
      console.error(message);
      process.exit(1);
    }
    console.warn(`${message} — starting anyway so /api/v1/health can report the failure.`);
  }

  const ai = getAiProvider();
  console.log(`[ai] provider: ${ai.name}${ai.enabled ? '' : ' (deterministic matching only)'}`);

  const server = app.listen(config.port, () => {
    console.log(`[http] Smart Lost & Found API listening on http://localhost:${config.port}`);
    console.log(`[http] health: http://localhost:${config.port}/api/v1/health?db=1`);
    console.log(`[http] allowed origins: ${config.clientOrigins.join(', ') || '(none configured)'}`);
  });

  const shutdown = (signal) => {
    console.log(`\n[http] ${signal} received, shutting down ...`);
    server.close(async () => {
      await closePool();
      console.log('[http] shutdown complete');
      process.exit(0);
    });
    // Do not hang forever on a stuck connection.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('[startup] fatal error:', error.message);
  if (!config.isTest) console.error(error.stack);
  process.exit(1);
});
