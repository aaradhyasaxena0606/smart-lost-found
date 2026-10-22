#!/usr/bin/env node
/**
 * Creates the development and test databases if they do not exist yet.
 *
 *   node database/scripts/create-databases.js
 *
 * Connects to the `postgres` maintenance database for the same server, so the
 * DATABASE_URL / TEST_DATABASE_URL configuration is the single source of truth.
 * The PostGIS extension itself is installed by migration 001, not here, so a
 * fresh database is schema-identical to an existing one.
 */
import pg from 'pg';
import { databaseUrlFor, describeConnection, clientOptions } from './lib/env.js';

async function ensureDatabase(adminClient, dbName) {
  const { rows } = await adminClient.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (rows.length > 0) {
    console.log(`  exists   ${dbName}`);
    return;
  }
  // Identifiers cannot be parameterised, so quote the name we derived and
  // validated from configuration rather than trusting arbitrary input.
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(dbName)) {
    throw new Error(`Refusing to create suspicious database name: ${dbName}`);
  }
  await adminClient.query(`CREATE DATABASE "${dbName}"`);
  console.log(`  created  ${dbName}`);
}

async function main() {
  const targets = ['dev', 'test'];
  const urls = {};
  for (const target of targets) {
    try {
      urls[target] = databaseUrlFor(target);
    } catch (error) {
      console.warn(`Skipping ${target}: ${error.message}`);
    }
  }

  if (Object.keys(urls).length === 0) {
    throw new Error('Neither DATABASE_URL nor TEST_DATABASE_URL is configured.');
  }

  // Build an admin connection to the "postgres" maintenance database on the
  // same host/credentials as the development URL.
  const base = new URL(urls.dev ?? urls.test);
  const adminUrl = new URL(base.toString());
  adminUrl.pathname = '/postgres';

  const admin = new pg.Client(clientOptions(adminUrl.toString()));
  await admin.connect();
  console.log(`Connected to ${describeConnection(adminUrl.toString())}`);

  try {
    for (const target of targets) {
      if (!urls[target]) continue;
      const dbName = decodeURIComponent(new URL(urls[target]).pathname.replace(/^\//, ''));
      await ensureDatabase(admin, dbName);
    }
  } finally {
    await admin.end();
  }

  console.log('\nDatabases ready. Next: npm run db:migrate && npm run db:seed');
}

main().catch((error) => {
  console.error('\nFailed to create databases:');
  console.error(error.message);
  process.exit(1);
});
