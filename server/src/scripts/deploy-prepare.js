#!/usr/bin/env node
/**
 * One-command preparation for a hosted (Supabase) database.
 *
 *   npm run deploy:prepare
 *
 * What it does
 * ------------
 *   1. Connects to DATABASE_URL and prints the target without credentials.
 *   2. Runs preflight checks that catch the two mistakes that break a Supabase
 *      deployment: PostGIS missing, and PostGIS living in a schema that is not on
 *      the search path.
 *   3. Applies the migrations.
 *   4. Creates the first administrator if the database has none.
 *   5. Prints the exact environment values to paste into Render and Vercel.
 *
 * It deliberately does NOT run the demo seed, and refuses to continue if the
 * database looks like a local one only when you ask it to.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { query, closePool } from '../config/db.js';
import config, { ROOT_DIR } from '../config/env.js';
import { describeConnection } from '../../../database/scripts/lib/env.js';

function heading(text) {
  console.log(`\n${'='.repeat(64)}\n${text}\n${'='.repeat(64)}`);
}

function fail(message, hint) {
  console.error(`\n✗ ${message}`);
  if (hint) console.error(`\n${hint}\n`);
  process.exitCode = 1;
}

function runNodeScript(relativePath, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT_DIR, relativePath), ...args], {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      env: process.env,
    });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Exited with code ${code}`))));
  });
}

async function main() {
  heading('Smart Lost & Found — deployment preparation');
  console.log(`Target database : ${describeConnection(config.databaseUrl)}`);
  console.log(`Pool ceiling    : ${config.dbPoolMax}`);
  console.log(`Search path     : ${config.pgSearchPath ?? '(provider default)'}`);

  // ---------------------------------------------------------------------
  // Preflight
  // ---------------------------------------------------------------------
  let info;
  try {
    const { rows } = await query(
      `SELECT current_database() AS database,
              current_user       AS username,
              current_setting('search_path') AS search_path,
              substring(version() from 'PostgreSQL [0-9.]+') AS version`
    );
    info = rows[0];
  } catch (error) {
    fail(`Could not connect: ${error.message}`, 'Check DATABASE_URL, the password encoding and ?sslmode=require.');
    return;
  }

  console.log(`Connected to    : ${info.database} as ${info.username} (${info.version})`);
  console.log(`Effective path  : ${info.search_path}`);

  const postgis = await query(
    `SELECT e.extversion, n.nspname AS schema
       FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
      WHERE e.extname = 'postgis'`
  );

  if (postgis.rows.length === 0) {
    fail(
      'PostGIS is not installed in this database.',
      'On Supabase: Database → Extensions → enable "postgis" (accept the default `extensions` schema), then re-run.\n' +
        'Do not let our migration install it into `public` on a managed provider.'
    );
    return;
  }

  const postgisVersion = postgis.rows[0].extversion;
  const postgisSchema = postgis.rows[0].schema;
  console.log(`PostGIS         : ${postgisVersion} (schema: ${postgisSchema})`);

  // The decisive check: can this connection actually resolve the geography type?
  const geographyOk = await query(`SELECT 'SRID=4326;POINT(0 0)'::geography IS NOT NULL AS ok`).then(
    (result) => result.rows[0].ok,
    () => false
  );

  if (!geographyOk) {
    fail(
      'The `geography` type cannot be resolved from this connection.',
      postgisSchema === 'public'
        ? 'PostGIS is in `public` but the search path does not include it.'
        : `PostGIS lives in the "${postgisSchema}" schema. Add it to the search path:\n\n` +
          `  PowerShell:  $env:PG_SEARCH_PATH="public, ${postgisSchema}"\n` +
          `  .env:        PG_SEARCH_PATH=public, ${postgisSchema}\n\n` +
          'and also set PG_SEARCH_PATH to the same value in Render, otherwise the deployed API fails the same way.'
    );
    return;
  }
  console.log('Geography type  : resolves correctly');

  const trgm = await query(`SELECT 1 FROM pg_available_extensions WHERE name = 'pg_trgm'`);
  if (trgm.rows.length === 0) {
    fail('pg_trgm is not available on this server.', 'Enable it from the provider dashboard before migrating.');
    return;
  }
  console.log('pg_trgm         : available');

  // ---------------------------------------------------------------------
  // Migrations
  // ---------------------------------------------------------------------
  heading('Applying migrations');
  try {
    await runNodeScript('database/scripts/migrate.js');
  } catch (error) {
    fail(`Migrations failed: ${error.message}`, 'Fix the error above, then re-run this command.');
    return;
  }

  // ---------------------------------------------------------------------
  // First administrator
  // ---------------------------------------------------------------------
  heading('Administrator account');
  const admins = await query(`SELECT email FROM users WHERE role = 'admin' ORDER BY user_id LIMIT 5`);

  if (admins.rows.length > 0) {
    console.log('Administrator(s) already present:');
    for (const row of admins.rows) console.log(`  • ${row.email}`);
    console.log('\nTo add another (for example a teammate):');
    console.log('  npm run admin:create -- --email=them@example.com --name="Their Name" --promote');
  } else {
    console.log('No administrator exists yet. The next step asks for an email, a name and a password.');
    console.log('(Press Ctrl+C to skip and create it later with `npm run admin:create`.)\n');
    try {
      await runNodeScript('server/src/scripts/create-admin.js');
    } catch {
      console.log('\nSkipped. Create an administrator later with:');
      console.log('  npm run admin:create -- --email=you@example.com --name="Your Name"');
    }
  }

  // ---------------------------------------------------------------------
  // Environment values for the hosts
  // ---------------------------------------------------------------------
  const counts = await query(
    `SELECT (SELECT COUNT(*)::int FROM items) AS items, (SELECT COUNT(*)::int FROM users) AS users`
  );
  const { items, users } = counts.rows[0];

  heading('Deployment is ready');
  console.log(`Database now holds ${users} user(s) and ${items} report(s).\n`);

  console.log('--- Render (API) environment ------------------------------------');
  console.log('  DATABASE_URL    = <your TRANSACTION pooler URL, port 6543, ?sslmode=require>');
  console.log(`  PG_SEARCH_PATH  = public,${postgisSchema === 'public' ? 'extensions' : postgisSchema}`);
  console.log(`  PGPOOL_MAX      = ${Math.min(config.dbPoolMax, 5)}`);
  console.log('  JWT_SECRET      = (generated automatically by render.yaml)');
  console.log('  CLIENT_ORIGIN   = https://<your-app>.vercel.app   (no trailing slash)');
  console.log('  AI_PROVIDER     = disabled');
  console.log('  UPLOAD_DIR      = /tmp/uploads');
  console.log('  NODE_ENV        = production');

  console.log('\n--- Vercel (client) environment ----------------------------------');
  console.log('  VITE_API_URL    = https://<your-api>.onrender.com/api/v1');
  console.log('  VITE_API_ORIGIN = https://<your-api>.onrender.com');

  console.log('\n--- Next ---------------------------------------------------------');
  console.log('  1. Render → New → Blueprint → select this repository.');
  console.log('  2. Vercel → Add New → Project → Root Directory = client.');
  console.log('  3. Set CLIENT_ORIGIN on Render once Vercel gives you a URL.');
  console.log('  4. Verify: https://<your-api>.onrender.com/api/v1/health?db=1');
  console.log('\nFull guide: docs/deployment.md');
}

main()
  .catch((error) => {
    console.error(`\nUnexpected failure: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
