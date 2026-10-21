/**
 * Shared environment loading for the database scripts.
 *
 * Database scripts live outside the `server` workspace but are run from the
 * repository root, so configuration is loaded from the root `.env` file.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const MIGRATIONS_DIR = path.join(ROOT_DIR, 'database', 'migrations');
export const SEEDS_DIR = path.join(ROOT_DIR, 'database', 'seeds');

const envFile = path.join(ROOT_DIR, '.env');
if (fs.existsSync(envFile)) {
  dotenv.config({ path: envFile });
} else {
  // Fall back to the example so that scripts can still print a helpful error.
  dotenv.config({ path: path.join(ROOT_DIR, '.env.example') });
}

/**
 * Resolves the connection string for the requested target.
 * @param {'dev'|'test'} target
 */
export function databaseUrlFor(target) {
  if (target === 'test') {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) {
      throw new Error(
        'TEST_DATABASE_URL is not set. Copy .env.example to .env and configure a separate test database.'
      );
    }
    return url;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env and configure your PostgreSQL connection.'
    );
  }
  return url;
}

/** Very small argument parser: supports `--env=test`, `--reset`, `--status`. */
export function parseArgs(argv = process.argv.slice(2)) {
  const flags = new Set();
  const options = {};
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      if (value === undefined) flags.add(key);
      else options[key] = value;
    }
  }
  return { flags, options };
}

/** Human-readable database label without ever printing credentials. */
export function describeConnection(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || 5432}${parsed.pathname}`;
  } catch {
    return '<unparseable connection string>';
  }
}
