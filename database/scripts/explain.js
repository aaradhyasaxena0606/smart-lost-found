#!/usr/bin/env node
/**
 * Query-planning walkthrough (spec 12.2 / 20: "Demonstrate query planning with
 * EXPLAIN ANALYZE").
 *
 *   npm run db:explain            # 100,000 synthetic reports
 *   node database/scripts/explain.js --rows=50000
 *
 * The script loads a realistic volume of synthetic reports **inside a transaction
 * that is rolled back at the end**, so the database is never modified: no user
 * data is read or written and nothing is persisted.
 *
 * It then runs EXPLAIN ANALYZE for query shapes the API issues and reports, for
 * each one, which indexes the planner actually used. Because PostgreSQL chooses
 * plans by cost, a plan that does not use a particular index is not necessarily
 * wrong; the script reports what it measured instead of asserting an opinion.
 *
 * Measured results on PostgreSQL 17.6 / PostGIS 3.6.2 are reproduced in
 * docs/database-design.md.
 */
import pg from 'pg';
import { databaseUrlFor, describeConnection, parseArgs, clientOptions } from './lib/env.js';

const { options } = parseArgs();
const target = options.env === 'test' ? 'test' : 'dev';
const REPORT_COUNT = Number(options.rows ?? 100000);

/** A deliberately rare token so keyword queries are selective. */
const RARE_TOKEN = 'zarquonium';

const QUERIES = [
  {
    title: 'Radius search — PostGIS GiST index',
    note: 'Same predicate as GET /api/v1/items?latitude=..&radiusMeters=..',
    acceptable: ['items_location_gist_idx'],
    sql: `SELECT item_id
            FROM items
           WHERE deleted_at IS NULL
             AND location IS NOT NULL
             AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 1500)
           ORDER BY location <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
           LIMIT 20`,
    params: [-0.1246, 51.5007],
  },
  {
    title: 'Keyword search on title — GIN trigram index',
    note: 'Single-column trigram/ILIKE predicate, the indexable core of fn_search_items',
    acceptable: ['items_title_trgm_idx'],
    sql: `SELECT item_id, title
            FROM items
           WHERE deleted_at IS NULL
             AND (title ILIKE '%' || $1 || '%' OR title % $1)
           LIMIT 20`,
    params: [RARE_TOKEN],
  },
  {
    title: 'Keyword search on description — GIN trigram index',
    note: 'The second trigram index from migration 012',
    acceptable: ['items_description_trgm_idx'],
    sql: `SELECT item_id
            FROM items
           WHERE deleted_at IS NULL
             AND (description ILIKE '%' || $1 || '%' OR description % $1)
           LIMIT 20`,
    params: [RARE_TOKEN],
  },
  {
    title: 'Un-indexable alternative: similarity() as a filter',
    note: 'Counter-example: a bare similarity() call cannot use the trigram index, which is exactly why migration 014 replaced it with % in fn_search_items',
    acceptable: [],
    sql: `SELECT item_id
            FROM items
           WHERE deleted_at IS NULL AND similarity(title, $1) > 0.15
           LIMIT 20`,
    params: [RARE_TOKEN],
  },
  {
    title: 'Public listing by recency — partial index on non-deleted rows',
    note: 'Predicate identical to the WHERE clause of items_report_type_created_idx',
    acceptable: ['items_report_type_created_idx'],
    sql: `SELECT item_id, created_at
            FROM items
           WHERE report_type = $1 AND deleted_at IS NULL
           ORDER BY created_at DESC
           LIMIT 20`,
    params: ['found'],
  },
  {
    title: 'Candidate lookup for the matching engine — partial index on open reports',
    note: 'Same predicate as findCandidates() in services/matching.service.js. The planner may legitimately prefer items_category_idx, which also satisfies this predicate.',
    acceptable: ['items_open_match_idx', 'items_category_idx'],
    sql: `SELECT item_id, event_time
            FROM items
           WHERE deleted_at IS NULL
             AND report_type = $1
             AND status IN ('open', 'matched')
             AND category_id = $2
             AND event_time >= $3
             AND event_time <= $4`,
    params: ['found', 1, new Date(Date.now() - 30 * 86400_000), new Date()],
  },
  {
    title: 'Administrator pending-claim queue — partial index',
    note: 'GET /api/v1/admin/claims with the default (pending only) filter',
    acceptable: ['claims_pending_idx'],
    sql: `SELECT claim_id, item_id, created_at
            FROM claims
           WHERE status = 'pending'
           ORDER BY created_at
           LIMIT 50`,
    params: [],
  },
  {
    title: 'Best matches for a report — partial covering index',
    note: 'Dashboard query over matches',
    acceptable: ['matches_ranked_idx', 'matches_lost_idx', 'matches_found_idx'],
    sql: `SELECT match_id, overall_score
            FROM matches
           WHERE match_status = 'suggested'
           ORDER BY overall_score DESC
           LIMIT 20`,
    params: [],
  },
];

/** Extracts index names mentioned by a plan. */
function indexesInPlan(planText) {
  const names = new Set();
  // PostgreSQL prints "Index Scan using <index>" and "Bitmap Index Scan on <index>".
  const pattern = /(?:Bitmap Index Scan|Index Only Scan|Index Scan) (?:using|on) ([A-Za-z0-9_]+)/g;
  let match = pattern.exec(planText);
  while (match) {
    names.add(match[1]);
    match = pattern.exec(planText);
  }
  return [...names];
}

async function printIndexInventory(client) {
  const { rows } = await client.query(
    `SELECT indexname, indexdef, pg_size_pretty(pg_relation_size(indexname::regclass)) AS size
       FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename IN ('items', 'matches', 'claims')
        AND indexname NOT LIKE '%_pkey'
      ORDER BY tablename, indexname`
  );

  console.log('='.repeat(78));
  console.log('Index inventory (from migrations 012 and 014)');
  console.log('='.repeat(78));
  for (const row of rows) {
    const kind = /USING (gist|gin)/i.exec(row.indexdef)?.[1]?.toUpperCase() ?? 'BTREE';
    const partial = /WHERE/i.test(row.indexdef) ? ' partial' : '';
    console.log(`  ${kind.padEnd(6)}${partial.padEnd(9)} ${row.indexname}  (${row.size})`);
  }
  console.log('');
}

async function main() {
  const client = new pg.Client(clientOptions(databaseUrlFor(target)));
  await client.connect();
  console.log(`Query planning demo on ${describeConnection(databaseUrlFor(target))} (${target})`);
  console.log(
    `Loading ${REPORT_COUNT.toLocaleString()} synthetic reports inside a rolled-back transaction ...\n`
  );

  await client.query('BEGIN');
  try {
    const hasPostgis = await client.query(`SELECT 1 FROM pg_extension WHERE extname = 'postgis'`);
    if (hasPostgis.rows.length === 0) {
      throw new Error('PostGIS is not installed in this database. Run "npm run db:migrate" first.');
    }

    const user = await client.query(
      `INSERT INTO users (full_name, email, password_hash)
       VALUES ('Query Planner Demo', 'planner-' || gen_random_uuid() || '@campus.test', repeat('x', 60))
       RETURNING user_id`
    );
    const userId = user.rows[0].user_id;

    const categoryCount = await client.query('SELECT COUNT(*)::int AS n FROM categories');
    if (categoryCount.rows[0].n === 0) {
      throw new Error('No categories found. Run "npm run db:seed" first.');
    }

    const started = Date.now();
    await client.query(
      `INSERT INTO items
         (reporter_id, category_id, report_type, title, description, colour, brand,
          event_time, location_name, location, status)
       SELECT
         $1,
         (SELECT category_id FROM categories ORDER BY random() LIMIT 1),
         CASE WHEN g % 2 = 0 THEN 'lost' ELSE 'found' END,
         (ARRAY['iPhone','umbrella','backpack','water bottle','id card','laptop',
                'keys','spectacles','textbook','jacket'])[1 + (g % 10)] || ' report number ' || g,
         'Synthetic description for query planning exercise number ' || g ||
           ', mentioning ' || (ARRAY['iphone','umbrella','backpack','bottle','card'])[1 + (g % 5)] || '.',
         (ARRAY['black','white','blue','red','green','grey'])[1 + (g % 6)],
         (ARRAY['Apple','RainPro','Campus Gear','Hydro Flask','NoBrand'])[1 + (g % 5)],
         now() - ((g % 60) || ' days')::interval,
         'Synthetic location ' || g,
         ST_SetSRID(ST_MakePoint(-0.1246 + (random() - 0.5) * 0.1,
                                 51.5007 + (random() - 0.5) * 0.1), 4326)::geography,
         'open'
       FROM generate_series(1, $2) AS g`,
      [userId, REPORT_COUNT]
    );

    // A small, highly selective set of rows carrying the rare token.
    await client.query(
      `UPDATE items SET title = 'Lost ' || $1 || ' crystal pendant number ' || item_id
        WHERE item_id IN (SELECT item_id FROM items ORDER BY item_id LIMIT 25)`,
      [RARE_TOKEN]
    );

    // Some matches and claims so those indexes have data to work with.
    await client.query(
      `INSERT INTO matches (lost_item_id, found_item_id, attribute_score, time_score, spatial_score, overall_score, match_status)
       SELECT l.item_id, f.item_id, 70, 70, 70, 70, 'suggested'
         FROM items l
         JOIN items f ON f.item_id = l.item_id + 1
        WHERE l.report_type = 'lost' AND f.report_type = 'found'
        LIMIT 5000`
    );
    await client.query(
      `INSERT INTO claims (item_id, claimant_id, claim_message)
       SELECT i.item_id, $1, 'Synthetic claim for query planning exercise.'
         FROM items i WHERE i.report_type = 'found' LIMIT 2000`,
      [userId]
    );

    await client.query('ANALYZE items');
    await client.query('ANALYZE claims');
    await client.query('ANALYZE matches');

    const counts = await client.query(
      `SELECT (SELECT COUNT(*)::int FROM items) AS items,
              (SELECT COUNT(*)::int FROM claims) AS claims,
              (SELECT COUNT(*)::int FROM matches) AS matches`
    );
    console.log(
      `Loaded ${counts.rows[0].items.toLocaleString()} reports, ` +
        `${counts.rows[0].matches.toLocaleString()} matches and ` +
        `${counts.rows[0].claims.toLocaleString()} claims in ${((Date.now() - started) / 1000).toFixed(1)}s.\n`
    );

    await printIndexInventory(client);

    let pass = 0;
    let note = 0;

    for (const entry of QUERIES) {
      console.log('='.repeat(78));
      console.log(entry.title);
      console.log(entry.note);
      console.log('='.repeat(78));

      const { rows } = await client.query(`EXPLAIN (ANALYZE, BUFFERS) ${entry.sql}`, entry.params);
      const planText = rows.map((row) => row['QUERY PLAN']).join('\n');
      console.log(planText);

      const used = indexesInPlan(planText);
      const matched = entry.acceptable.filter((name) => used.includes(name));

      if (entry.acceptable.length === 0) {
        console.log(`\n-> OBSERVED: indexes used = ${used.length ? used.join(', ') : 'none (sequential scan)'}\n`);
      } else if (matched.length > 0) {
        pass += 1;
        console.log(`\n-> PASS: plan uses ${matched.join(', ')}${used.length > matched.length ? ` (also: ${used.filter((n) => !matched.includes(n)).join(', ')})` : ''}\n`);
      } else {
        note += 1;
        console.log(`\n-> NOTE: expected one of [${entry.acceptable.join(', ')}] but the planner used ${used.length ? used.join(', ') : 'a sequential scan'}.\n`);
      }
    }

    console.log('='.repeat(78));
    console.log(
      `Summary: ${pass} of ${QUERIES.filter((q) => q.acceptable.length).length} expectations met` +
        (note ? `, ${note} chose a different (still valid) plan.` : '.')
    );
    console.log(
      'A sequential scan is not automatically a defect: for a predicate that matches a\n' +
        'large fraction of the table, scanning is genuinely cheaper than an index lookup.'
    );
    console.log('='.repeat(78));
  } finally {
    await client.query('ROLLBACK');
    await client.end();
    console.log('\nTransaction rolled back — the database is unchanged.');
  }
}

main().catch((error) => {
  console.error('\nQuery planning demo failed:');
  console.error(error.message);
  process.exit(1);
});
