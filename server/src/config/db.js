/**
 * PostgreSQL connection pool and transaction helper.
 *
 * Every query in the application goes through this module, which guarantees
 * that only parameterised SQL is issued (NFR-02) — callers pass `$1`, `$2`, ...
 * placeholders and a values array.
 */
import pg from 'pg';
import config from './env.js';

const { Pool, types } = pg;

// ---------------------------------------------------------------------------
// Type parsing
// ---------------------------------------------------------------------------
// By default node-postgres returns NUMERIC as a string (to avoid precision
// loss). Match scores are bounded 0-100 with two decimals, so parsing them as
// numbers is safe and keeps the JSON API clean.
types.setTypeParser(types.builtins.NUMERIC, (value) => (value === null ? null : Number(value)));
// BIGINT is only used for COUNT(*) totals and audit ids, well inside the safe
// integer range, so returning a number is convenient and lossless here.
types.setTypeParser(types.builtins.INT8, (value) => (value === null ? null : Number(value)));

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: config.dbPoolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  application_name: 'smart-lost-found-api',
  // Applied by the server at connection startup, so there is no race and no SQL
  // interpolation. Needed when PostGIS lives outside `public` (e.g. Supabase
  // installs it into `extensions`). Whitespace is stripped because a startup
  // `options` value is terminated by a space: "public, extensions" would be
  // parsed as the value "public," plus a stray argument.
  ...(config.pgSearchPath
    ? { options: `-c search_path=${config.pgSearchPath.replace(/\s+/g, '')}` }
    : {}),
});

pool.on('error', (error) => {
  // A pooled idle client failed: log without leaking credentials.
  console.error('[db] unexpected idle client error:', error.message);
});

/**
 * Runs a parameterised query.
 * @param {string} text
 * @param {unknown[]} [params]
 */
export function query(text, params) {
  return pool.query(text, params);
}

/** Acquires a client for multi-statement work. Caller MUST release it. */
export function connect() {
  return pool.connect();
}

/**
 * Runs `fn` inside a database transaction.
 *
 * The callback receives a client with `.query()`. The transaction is committed
 * when the callback resolves and rolled back on any error, which is what makes
 * multi-step operations (claim approval + item status + notifications + audit)
 * atomic (FR-22, spec 20).
 *
 * @template T
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('[db] rollback failed:', rollbackError.message);
    }
    throw error;
  } finally {
    client.release();
  }
}

/** Lightweight readiness probe used by the health endpoint. */
export async function checkConnection() {
  const startedAt = Date.now();
  const { rows } = await pool.query(
    `SELECT current_database() AS database,
            (SELECT extversion FROM pg_extension WHERE extname = 'postgis') AS postgis_version`
  );
  return {
    ok: true,
    database: rows[0].database,
    postgisVersion: rows[0].postgis_version ?? null,
    latencyMs: Date.now() - startedAt,
  };
}

export async function closePool() {
  await pool.end();
}

export default { query, connect, withTransaction, checkConnection, closePool, pool };
