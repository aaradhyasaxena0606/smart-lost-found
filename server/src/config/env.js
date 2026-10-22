/**
 * Centralised environment configuration.
 *
 * Rules enforced here (NFR-04, spec 17):
 *   * No secret is ever hardcoded; everything comes from the environment.
 *   * Required variables are validated on startup, so a misconfigured server
 *     fails immediately with a readable message instead of at first request.
 *   * The placeholder values shipped in `.env.example` are rejected outside
 *     development.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ROOT_DIR = path.resolve(SERVER_DIR, '..');

// Configuration lives in the repository-root `.env` (single source of truth);
// a `server/.env` file, if present, may override it for local experiments.
const rootEnv = path.join(ROOT_DIR, '.env');
const serverEnv = path.join(SERVER_DIR, '.env');
if (fs.existsSync(rootEnv)) dotenv.config({ path: rootEnv });
if (fs.existsSync(serverEnv)) dotenv.config({ path: serverEnv, override: true });

const boolLike = z
  .union([z.boolean(), z.string()])
  .transform((value) => (typeof value === 'boolean' ? value : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (see .env.example)'),
  TEST_DATABASE_URL: z.string().optional(),

  // Managed Postgres often has a low connection limit (a free Supabase project
  // allows ~60 direct connections including its own pooler). A serverless or
  // free-tier deployment should keep this small.
  PGPOOL_MAX: z.coerce.number().int().positive().max(100).optional(),

  // Some managed providers install PostGIS into a schema other than `public`
  // (Supabase uses `extensions`). Setting this makes the type/function lookup
  // work without moving the extension. Applied as a startup parameter, so it is
  // never interpolated into SQL.
  PG_SEARCH_PATH: z
    .string()
    .max(200)
    .regex(/^[A-Za-z0-9_,$" ]+$/, 'PG_SEARCH_PATH may only contain schema names, commas and quotes')
    .optional(),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('1d'),

  UPLOAD_DIR: z.string().default('uploads'),
  MAX_UPLOAD_MB: z.coerce.number().positive().max(50).default(5),

  MATCH_RADIUS_METERS: z.coerce.number().positive().max(200_000).default(1500),
  MATCH_MAX_DAYS: z.coerce.number().positive().max(3650).default(30),
  MATCH_MIN_SCORE: z.coerce.number().min(0).max(100).default(40),
  MATCH_CANDIDATE_LIMIT: z.coerce.number().int().positive().max(2000).default(200),
  MATCH_WEIGHT_ATTRIBUTE: z.coerce.number().min(0).max(1).default(0.35),
  MATCH_WEIGHT_TIME: z.coerce.number().min(0).max(1).default(0.2),
  MATCH_WEIGHT_SPATIAL: z.coerce.number().min(0).max(1).default(0.25),
  MATCH_WEIGHT_AI: z.coerce.number().min(0).max(1).default(0.2),

  AI_PROVIDER: z.enum(['disabled', 'openai']).default('disabled'),
  AI_API_KEY: z.string().optional().default(''),
  AI_MODEL: z.string().default('text-embedding-3-small'),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().max(60_000).default(5000),
  AI_BASE_URL: z.string().default('https://api.openai.com/v1'),

  TRUST_PROXY: boolLike.default(false),
  LOG_REQUESTS: boolLike.default(true),

  // Rate limits. Strict defaults apply in production; development and test are
  // relaxed so the test suite and manual testing are not throttled. Both are
  // overridable, so a deployment can tune them without a code change.
  RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().positive().max(1440).default(15),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().max(100_000).optional(),
  RATE_LIMIT_API_MAX: z.coerce.number().int().positive().max(1_000_000).optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  throw new Error(
    `Invalid environment configuration:\n${issues}\n\n` +
      `Copy .env.example to .env and fill in the values.`
  );
}

const raw = parsed.data;
const isProduction = raw.NODE_ENV === 'production';

// Fail fast on placeholder secrets outside development (spec 17).
if (isProduction) {
  if (raw.JWT_SECRET.includes('replace_with') || raw.JWT_SECRET.length < 32) {
    throw new Error(
      'Refusing to start in production with a placeholder or short JWT_SECRET. ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
    );
  }
  if (raw.DATABASE_URL.includes('change_me')) {
    throw new Error('Refusing to start in production with the example DATABASE_URL password.');
  }
}

const weightSum =
  raw.MATCH_WEIGHT_ATTRIBUTE + raw.MATCH_WEIGHT_TIME + raw.MATCH_WEIGHT_SPATIAL + raw.MATCH_WEIGHT_AI;
if (weightSum <= 0) {
  throw new Error('At least one MATCH_WEIGHT_* value must be greater than zero.');
}

const uploadDir = path.isAbsolute(raw.UPLOAD_DIR)
  ? raw.UPLOAD_DIR
  : path.join(ROOT_DIR, raw.UPLOAD_DIR);

export const config = Object.freeze({
  nodeEnv: raw.NODE_ENV,
  isProduction,
  isTest: raw.NODE_ENV === 'test',
  port: raw.PORT,
  clientOrigins: raw.CLIENT_ORIGIN.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

  databaseUrl: raw.NODE_ENV === 'test' && raw.TEST_DATABASE_URL ? raw.TEST_DATABASE_URL : raw.DATABASE_URL,
  dbPoolMax: raw.PGPOOL_MAX ?? (raw.NODE_ENV === 'test' ? 5 : 10),
  pgSearchPath: raw.PG_SEARCH_PATH ?? null,

  jwtSecret: raw.JWT_SECRET,
  jwtExpiresIn: raw.JWT_EXPIRES_IN,

  uploadDir,
  maxUploadBytes: Math.round(raw.MAX_UPLOAD_MB * 1024 * 1024),
  maxUploadMb: raw.MAX_UPLOAD_MB,

  matching: Object.freeze({
    radiusMeters: raw.MATCH_RADIUS_METERS,
    maxDays: raw.MATCH_MAX_DAYS,
    minScore: raw.MATCH_MIN_SCORE,
    candidateLimit: raw.MATCH_CANDIDATE_LIMIT,
    weights: Object.freeze({
      attribute: raw.MATCH_WEIGHT_ATTRIBUTE,
      time: raw.MATCH_WEIGHT_TIME,
      spatial: raw.MATCH_WEIGHT_SPATIAL,
      ai: raw.MATCH_WEIGHT_AI,
    }),
  }),

  ai: Object.freeze({
    provider: raw.AI_PROVIDER,
    apiKey: raw.AI_API_KEY,
    model: raw.AI_MODEL,
    timeoutMs: raw.AI_TIMEOUT_MS,
    baseUrl: raw.AI_BASE_URL,
  }),

  trustProxy: raw.TRUST_PROXY,
  logRequests: raw.LOG_REQUESTS,

  rateLimit: Object.freeze({
    windowMs: raw.RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
    authMax: raw.RATE_LIMIT_AUTH_MAX ?? (isProduction ? 10 : 1000),
    apiMax: raw.RATE_LIMIT_API_MAX ?? (isProduction ? 300 : 10_000),
  }),
});

export default config;
