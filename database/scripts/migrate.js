#!/usr/bin/env node
/**
 * Version-controlled migration runner.
 *
 *   node database/scripts/migrate.js                 # apply pending migrations (DATABASE_URL)
 *   node database/scripts/migrate.js --env=test      # apply pending migrations (TEST_DATABASE_URL)
 *   node database/scripts/migrate.js --status        # show applied / pending migrations
 *   node database/scripts/migrate.js --reset         # DROP schema public and re-apply everything
 *   node database/scripts/migrate.js --rollback      # alias of --reset (migrations are forward-only)
 *
 * Guarantees:
 *   * Each migration runs inside a single transaction: it either applies fully
 *     or not at all (ACID; spec 20 "transactions, rollback").
 *   * Applied migrations are recorded in schema_migrations with a SHA-256
 *     checksum. Editing an already-applied migration is detected and refused,
 *     so the database can never silently drift from version control.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import { MIGRATIONS_DIR, databaseUrlFor, parseArgs, describeConnection, clientOptions } from './lib/env.js';

const { flags, options } = parseArgs();
const target = options.env === 'test' ? 'test' : 'dev';
const url = databaseUrlFor(target);

if ((flags.has('reset') || flags.has('rollback')) && process.env.NODE_ENV === 'production') {
  console.error('Refusing to reset the schema with NODE_ENV=production.');
  process.exit(1);
}

const MIGRATION_FILE_RE = /^(\d{3})_[a-z0-9_]+\.sql$/;

function readMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    throw new Error(`Migrations directory not found: ${MIGRATIONS_DIR}`);
  }
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => MIGRATION_FILE_RE.test(f))
    .sort()
    .map((filename) => {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
      return {
        version: filename.slice(0, 3),
        filename,
        sql,
        checksum: crypto.createHash('sha256').update(sql).digest('hex'),
      };
    });
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version      TEXT        PRIMARY KEY,
      filename     TEXT        NOT NULL,
      checksum     TEXT        NOT NULL,
      applied_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      execution_ms INTEGER
    )
  `);
}

async function resetSchema(client) {
  console.log('  Dropping schema public CASCADE ...');
  await client.query('DROP SCHEMA IF EXISTS public CASCADE');
  await client.query('CREATE SCHEMA public');
  await client.query('GRANT ALL ON SCHEMA public TO public');
  console.log('  Schema reset. All migrations will be re-applied.');
}

async function applyMigrations(client, migrations) {
  const { rows } = await client.query('SELECT version, filename, checksum FROM schema_migrations');
  const applied = new Map(rows.map((r) => [r.version, r]));

  let appliedCount = 0;
  const skipped = [];

  for (const migration of migrations) {
    const existing = applied.get(migration.version);

    if (existing) {
      if (existing.checksum !== migration.checksum) {
        throw new Error(
          `Migration ${migration.filename} has changed since it was applied ` +
            `(checksum mismatch).\n` +
            `  applied: ${existing.checksum}\n  on disk: ${migration.checksum}\n` +
            `Restore the original file, or add a NEW migration for the change.`
        );
      }
      skipped.push(migration.filename);
      continue;
    }

    const startedAt = Date.now();
    // One transaction per migration => all-or-nothing.
    await client.query('BEGIN');
    try {
      await client.query(migration.sql);
      const executionMs = Date.now() - startedAt;
      await client.query(
        'INSERT INTO schema_migrations (version, filename, checksum, execution_ms) VALUES ($1, $2, $3, $4)',
        [migration.version, migration.filename, migration.checksum, executionMs]
      );
      await client.query('COMMIT');
      appliedCount += 1;
      console.log(`  [applied] ${migration.filename} (${executionMs} ms)`);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error(`  [FAILED ] ${migration.filename}`);
      throw error;
    }
  }

  return { appliedCount, skippedCount: skipped.length };
}

async function printStatus(client) {
  const { rows } = await client.query(
    'SELECT version, filename, applied_at, execution_ms FROM schema_migrations ORDER BY version'
  );
  const appliedVersions = new Set(rows.map((r) => r.version));
  const all = readMigrations();

  console.log('\nMigration status\n----------------');
  for (const migration of all) {
    const record = rows.find((r) => r.version === migration.version);
    if (record) {
      console.log(`  applied  ${migration.filename}  (${record.applied_at.toISOString()}, ${record.execution_ms ?? '-'} ms)`);
    } else {
      console.log(`  pending  ${migration.filename}`);
    }
  }
  const orphans = rows.filter((r) => !all.some((m) => m.version === r.version));
  for (const orphan of orphans) {
    console.log(`  MISSING  ${orphan.filename}  (recorded in DB but no file on disk!)`);
  }
  console.log(`\n  ${appliedVersions.size} applied, ${all.length - appliedVersions.size} pending\n`);
}

async function main() {
  const client = new pg.Client(clientOptions(url));
  await client.connect();
  console.log(`Migration target: ${describeConnection(url)} (${target})`);

  try {
    if (flags.has('reset') || flags.has('rollback')) {
      await resetSchema(client);
    }

    await ensureMigrationsTable(client);

    const postgis = await client.query(
      `SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis')
                   THEN (SELECT extversion FROM pg_extension WHERE extname = 'postgis')
              END AS postgis_version`
    );
    if (postgis.rows[0].postgis_version) {
      console.log(`  PostGIS detected: ${postgis.rows[0].postgis_version}`);
    } else {
      console.log('  PostGIS not yet enabled (migration 001 will enable it).');
    }

    const migrations = readMigrations();

    if (flags.has('status')) {
      await printStatus(client);
      return;
    }

    console.log(`\nApplying migrations from ${path.relative(process.cwd(), MIGRATIONS_DIR)} ...`);
    const { appliedCount, skippedCount } = await applyMigrations(client, migrations);
    console.log(`\nDone. ${appliedCount} applied, ${skippedCount} already up to date.`);

    const version = await client.query(
      `SELECT extversion AS v FROM pg_extension WHERE extname = 'postgis'`
    );
    if (version.rows.length) {
      console.log(`PostGIS version in database: ${version.rows[0].v}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('\nMigration failed:');
  console.error(error.message);
  if (error.detail) console.error(`detail: ${error.detail}`);
  if (error.hint) console.error(`hint: ${error.hint}`);
  process.exit(1);
});
