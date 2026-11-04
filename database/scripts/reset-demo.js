#!/usr/bin/env node
/**
 * Clears all lost/found activity so you can run a demo from a clean slate,
 * keeping accounts and categories.
 *
 *   npm run db:reset-demo                     # local database (DATABASE_URL)
 *   npm run db:reset-demo -- --env=test       # test database
 *
 *   # against Supabase (session pooler, port 5432):
 *   $env:DATABASE_URL="postgresql://...:5432/postgres?uselibpqcompat..." ; npm run db:reset-demo
 *
 * The SQL itself lives in reset-demo-data.sql so it can also be pasted into the
 * Supabase SQL Editor without running Node.
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { databaseUrlFor, describeConnection, parseArgs, clientOptions } from './lib/env.js';

const { options } = parseArgs();
const target = options.env === 'test' ? 'test' : 'dev';
const url = databaseUrlFor(target);

const SQL_PATH = path.join(import.meta.dirname, 'reset-demo-data.sql');

async function main() {
  if (!fs.existsSync(SQL_PATH)) {
    throw new Error(`SQL file not found: ${SQL_PATH}`);
  }

  console.log(`Resetting demo data in ${describeConnection(url)} (${target})`);
  const client = new pg.Client(clientOptions(url));
  await client.connect();

  try {
    const sql = fs.readFileSync(SQL_PATH, 'utf8');
    await client.query(sql);

    const { rows } = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM items)                AS items,
        (SELECT COUNT(*)::int FROM matches)              AS matches,
        (SELECT COUNT(*)::int FROM claims)               AS claims,
        (SELECT COUNT(*)::int FROM notifications)         AS notifications,
        (SELECT COUNT(*)::int FROM item_images)           AS images,
        (SELECT COUNT(*)::int FROM item_private_details)  AS private_details,
        (SELECT COUNT(*)::int FROM users)                 AS users,
        (SELECT COUNT(*)::int FROM categories)            AS categories
    `);
    const c = rows[0];

    console.log(`
  removed: ${c.items} reports, ${c.matches} matches, ${c.claims} claims, ${c.notifications} notifications
  kept:    ${c.users} users, ${c.categories} categories

  Ready for a fresh demo: report a lost item, then a matching found item.`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`\nReset failed: ${error.message}`);
  process.exitCode = 1;
});
