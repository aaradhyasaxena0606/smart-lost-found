/**
 * Test environment bootstrap.
 *
 * This module MUST be the first import of every test file: it sets
 * NODE_ENV=test before anything pulls in `config/env.js`, so the suite always
 * targets TEST_DATABASE_URL and never the development database.
 *
 * The npm script additionally preloads it with `--import`, so the ordering is
 * guaranteed rather than merely conventional.
 */
process.env.NODE_ENV = 'test';

export const TEST_ENV_LOADED = true;
