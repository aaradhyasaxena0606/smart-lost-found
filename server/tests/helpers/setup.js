/**
 * Shared test harness.
 *
 *   * forces NODE_ENV=test (via ./load-test-env.js) so TEST_DATABASE_URL is used;
 *   * applies migrations to the test database once, then truncates between files;
 *   * exposes small factory helpers so each test file reads as a scenario rather
 *     than as SQL plumbing.
 *
 * Tests run with --test-concurrency=1 (see server/package.json) so a single test
 * database can be reset safely per file.
 */
import './load-test-env.js';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import supertest from 'supertest';
import { createApp } from '../../src/app.js';
import { query, closePool } from '../../src/config/db.js';
import config from '../../src/config/env.js';
import { ROOT_DIR } from '../../src/config/env.js';

export const app = createApp();
export const api = supertest(app);
export const API = '/api/v1';

export const DEMO_PASSWORD = 'Password123';

let migrated = false;

/** Applies migrations to the test database exactly once per process. */
export function ensureMigrated() {
  if (migrated) return;
  const migrateScript = path.join(ROOT_DIR, 'database', 'scripts', 'migrate.js');
  execFileSync(process.execPath, [migrateScript, '--env=test'], {
    cwd: ROOT_DIR,
    stdio: 'pipe',
    env: { ...process.env, NODE_ENV: 'development' },
  });
  migrated = true;
}

/** Empties every application table and reloads the canonical categories. */
export async function resetDatabase() {
  ensureMigrated();
  await query(`
    TRUNCATE TABLE
      audit_logs, notifications, claims, matches, item_images, item_private_details, items, categories, users
    RESTART IDENTITY CASCADE
  `);
  const categoriesSql = fs.readFileSync(
    path.join(ROOT_DIR, 'database', 'seeds', '001_categories.sql'),
    'utf8'
  );
  await query(categoriesSql);
}

export async function closeDatabase() {
  await closePool();
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

let userCounter = 0;

/**
 * Registers a user through the real API and returns the token plus profile.
 * @param {{role?: 'user'|'admin', fullName?: string, password?: string}} [options]
 */
export async function createUserViaApi(options = {}) {
  userCounter += 1;
  const email = `user${userCounter}-${Date.now()}@campus.test`;
  const password = options.password ?? DEMO_PASSWORD;

  const response = await api
    .post(`${API}/auth/register`)
    .send({ fullName: options.fullName ?? `Test User ${userCounter}`, email, password });

  if (response.status !== 201) {
    throw new Error(`Could not create test user: ${response.status} ${JSON.stringify(response.body)}`);
  }

  const token = response.body.data.token;
  const user = response.body.data.user;

  // Promote to administrator directly in the database: there is intentionally no
  // public endpoint that can create an administrator.
  if (options.role === 'admin') {
    await query(`UPDATE users SET role = 'admin' WHERE user_id = $1`, [user.userId]);
    user.role = 'admin';
    // Re-login so the token carries the admin role.
    const login = await api.post(`${API}/auth/login`).send({ email, password });
    return { token: login.body.data.token, user: login.body.data.user, email, password };
  }

  return { token, user, email, password };
}

/** Inserts a user directly (including admins), bypassing the API. */
export async function createUserDirect({
  fullName = 'Direct User',
  email,
  password = DEMO_PASSWORD,
  role = 'user',
  isActive = true,
} = {}) {
  userCounter += 1;
  const finalEmail = email ?? `direct${userCounter}-${Date.now()}@campus.test`;
  const passwordHash = await bcrypt.hash(password, 4);
  const { rows } = await query(
    `INSERT INTO users (full_name, email, password_hash, role, is_active)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING user_id, full_name, email, role, is_active, created_at`,
    [fullName, finalEmail.toLowerCase(), passwordHash, role, isActive]
  );
  return { ...rows[0], password };
}

export async function getCategoryId(name = 'Mobile Phone') {
  const { rows } = await query('SELECT category_id FROM categories WHERE name = $1', [name]);
  if (rows.length === 0) throw new Error(`Category "${name}" not found; did seeds run?`);
  return rows[0].category_id;
}

/** A valid report payload; override any field for the scenario under test. */
export function itemPayload(overrides = {}) {
  return {
    reportType: 'lost',
    categoryId: overrides.categoryId,
    title: 'Lost black iPhone with cracked screen',
    description: 'Black iPhone with a cracked screen protector and a cat sticker on the back.',
    colour: 'black',
    brand: 'Apple',
    eventTime: new Date(Date.now() - 3 * 3600_000).toISOString(),
    locationName: 'Main Library',
    latitude: 51.5007,
    longitude: -0.1246,
    ...overrides,
  };
}

/** Creates a report through the API and returns the created object. */
export async function createItemViaApi(token, overrides = {}) {
  const categoryId = overrides.categoryId ?? (await getCategoryId(overrides.categoryName ?? 'Mobile Phone'));
  const response = await api
    .post(`${API}/items`)
    .set('Authorization', `Bearer ${token}`)
    .send(itemPayload({ ...overrides, categoryId }));

  if (response.status !== 201) {
    throw new Error(`Could not create item: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body.data;
}

export { config, ROOT_DIR };
export default { app, api, API, resetDatabase, closeDatabase, createUserViaApi, createItemViaApi };
