#!/usr/bin/env node
/**
 * Development seed.
 *
 *   npm run db:seed
 *
 * Behaviour
 * ---------
 * 1. Runs every `.sql` file in database/seeds in filename order. Those files are
 *    idempotent (see database/seeds/001_categories.sql).
 * 2. Creates clearly-fictional demo accounts. Passwords are real bcrypt hashes of
 *    the documented demo password, never plaintext.
 * 3. Creates demo reports around a fictional campus location, with private
 *    verification hints stored separately from public data.
 * 4. Uses the **real matching service** and the **real claims service** to
 *    populate matches and one pending claim, so the seeded state is exactly the
 *    state those code paths produce — no hand-written fixture that could drift
 *    from the implementation.
 *
 * Idempotency: demo data is only created when the `items` table is empty, so
 * re-running never duplicates it. Categories are upserted. Drop the schema
 * (`npm run db:reset`) to force a fresh seed.
 *
 * All names, emails and items below are fictional (spec 6, NFR: no real personal
 * information).
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR, SEEDS_DIR, databaseUrlFor, describeConnection } from '../../../database/scripts/lib/env.js';
import { query, withTransaction, closePool } from '../config/db.js';
import { hashPassword } from '../utils/password.js';
import * as matchingService from '../services/matching.service.js';
import * as claimsService from '../modules/claims/claims.service.js';
import config from '../config/env.js';

const DEMO_PASSWORD = 'Password123';

const DEMO_USERS = [
  { fullName: 'Amara Okafor', email: 'admin@campus.test', role: 'admin' },
  { fullName: 'Ada Lovelace', email: 'ada@campus.test', role: 'user' },
  { fullName: 'Alan Turing', email: 'alan@campus.test', role: 'user' },
  { fullName: 'Grace Hopper', email: 'grace@campus.test', role: 'user' },
  { fullName: 'Linus Pauling', email: 'linus@campus.test', role: 'user' },
];

/** Fictional campus: "Example University", coordinates are invented. */
const LOCATIONS = {
  library: { name: 'Main Library, Level 2', latitude: 51.5007, longitude: -0.1246 },
  cafeteria: { name: 'North Campus Cafeteria', latitude: 51.5021, longitude: -0.1231 },
  gym: { name: 'Sports Centre Reception', latitude: 51.4993, longitude: -0.1272 },
  engineering: { name: 'Engineering Building Foyer', latitude: 51.5015, longitude: -0.1258 },
  busStop: { name: 'West Gate Bus Stop', latitude: 51.5042, longitude: -0.1219 },
  auditorium: { name: 'Lecture Hall A', latitude: 51.5001, longitude: -0.1252 },
};

const DEMO_ITEMS = [
  {
    reporter: 'ada@campus.test',
    category: 'Mobile Phone',
    reportType: 'lost',
    title: 'Lost black iPhone 15 with cracked screen',
    description:
      'Black iPhone 15 with a cracked screen protector and a small sticker of a cat on the back case.',
    colour: 'black',
    brand: 'Apple',
    daysAgo: 2,
    location: LOCATIONS.library,
    verificationHint: 'Screen protector cracked in the top-left corner; cat sticker on the back.',
  },
  {
    reporter: 'alan@campus.test',
    category: 'Mobile Phone',
    reportType: 'found',
    title: 'Found smartphone on a bench outside the library',
    description:
      'Found a black smartphone left on a bench outside the main library. Screen protector is cracked.',
    colour: 'black',
    brand: 'Apple',
    daysAgo: 1,
    location: LOCATIONS.library,
    verificationHint: 'Lock screen shows a photo of a golden retriever; cat sticker on the back.',
  },
  {
    reporter: 'grace@campus.test',
    category: 'Laptop & Tablet',
    reportType: 'lost',
    title: 'Lost silver MacBook Air in a grey sleeve',
    description:
      'Left a silver MacBook Air inside a grey felt sleeve in the engineering foyer, with a charger in the side pocket.',
    colour: 'grey',
    brand: 'Apple',
    daysAgo: 4,
    location: LOCATIONS.engineering,
    verificationHint: 'A blue sticker of a rocket on the bottom of the sleeve.',
  },
  {
    reporter: 'linus@campus.test',
    category: 'Laptop & Tablet',
    reportType: 'found',
    title: 'Silver laptop in a grey sleeve found in the foyer',
    description:
      'Found a silver laptop inside a grey felt sleeve at the Engineering Building foyer. It has a small sticker on the sleeve.',
    colour: 'grey',
    brand: 'Apple',
    daysAgo: 3,
    location: LOCATIONS.engineering,
    verificationHint: 'Blue rocket sticker on the underside of the sleeve.',
  },
  {
    reporter: 'grace@campus.test',
    category: 'Water Bottle',
    reportType: 'lost',
    title: 'Lost blue insulated water bottle',
    description: 'A blue insulated water bottle with a dented base, lost somewhere between the lab and the cafeteria.',
    colour: 'blue',
    brand: 'Hydro Flask',
    daysAgo: 6,
    location: LOCATIONS.cafeteria,
    verificationHint: 'Dent on the base and faded initials written in marker.',
  },
  {
    reporter: 'alan@campus.test',
    category: 'Umbrella',
    reportType: 'lost',
    title: 'Lost navy umbrella with wooden handle',
    description: 'Navy blue umbrella with a curved wooden handle, left at the West Gate bus stop.',
    colour: 'navy',
    brand: 'Umbrella Co',
    daysAgo: 9,
    location: LOCATIONS.busStop,
    verificationHint: 'Small tear near the third panel and a wooden handle.',
  },
  {
    reporter: 'linus@campus.test',
    category: 'ID Card & Documents',
    reportType: 'found',
    title: 'Found student ID card near the sports centre',
    description: 'Found a student ID card on the path outside the sports centre reception.',
    colour: 'white',
    brand: null,
    daysAgo: 5,
    location: LOCATIONS.gym,
    verificationHint: 'Card belongs to a second-year student; photo shows short dark hair.',
  },
  {
    reporter: 'ada@campus.test',
    category: 'Books & Stationery',
    reportType: 'lost',
    title: 'Lost calculus textbook with handwritten notes',
    description:
      'A calculus textbook with handwritten notes in the margins, left in Lecture Hall A after the morning lecture.',
    colour: 'green',
    brand: 'Campus Press',
    daysAgo: 12,
    location: LOCATIONS.auditorium,
    verificationHint: 'Name written inside the front cover and green sticky tabs on two chapters.',
  },
];

async function runSqlSeeds() {
  if (!fs.existsSync(SEEDS_DIR)) return;
  const files = fs.readdirSync(SEEDS_DIR).filter((file) => file.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(SEEDS_DIR, file), 'utf8');
    await query(sql);
    console.log(`  [sql] ${file}`);
  }
}

async function seedUsers() {
  const map = new Map();
  for (const user of DEMO_USERS) {
    const passwordHash = await hashPassword(DEMO_PASSWORD);
    const { rows } = await query(
      `INSERT INTO users (full_name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
       RETURNING user_id, email, role`,
      [user.fullName, user.email, passwordHash, user.role]
    );
    map.set(rows[0].email, rows[0]);
    console.log(`  [user] ${user.email} (${user.role})`);
  }
  return map;
}

async function seedItems(users) {
  const { rows: countRows } = await query('SELECT COUNT(*)::int AS total FROM items');
  if (countRows[0].total > 0) {
    console.log(`  [skip] ${countRows[0].total} reports already exist; demo reports were not created.`);
    return [];
  }

  const categories = await query('SELECT category_id, name FROM categories');
  const categoryByName = new Map(categories.rows.map((row) => [row.name, row.category_id]));

  const createdIds = [];
  await withTransaction(async (client) => {
    for (const item of DEMO_ITEMS) {
      const categoryId = categoryByName.get(item.category);
      if (!categoryId) throw new Error(`Seed category missing: ${item.category}`);
      const reporter = users.get(item.reporter);
      if (!reporter) throw new Error(`Seed user missing: ${item.reporter}`);

      const { rows } = await client.query(
        `INSERT INTO items
           (reporter_id, category_id, report_type, title, description, colour, brand,
            event_time, location_name, location)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now() - ($8 || ' days')::interval, $9, $10::geography)
         RETURNING item_id`,
        [
          reporter.user_id,
          categoryId,
          item.reportType,
          item.title,
          item.description,
          item.colour,
          item.brand,
          String(item.daysAgo),
          item.location.name,
          `SRID=4326;POINT(${item.location.longitude} ${item.location.latitude})`,
        ]
      );
      const itemId = rows[0].item_id;
      createdIds.push(itemId);

      if (item.verificationHint) {
        await client.query(
          `INSERT INTO item_private_details (item_id, verification_hint) VALUES ($1, $2)`,
          [itemId, item.verificationHint]
        );
      }
    }
  });

  console.log(`  [items] created ${createdIds.length} demo reports with locations and private hints.`);
  return createdIds;
}

async function seedMatches() {
  const { rows } = await query(
    `SELECT item_id FROM items WHERE deleted_at IS NULL AND status IN ('open','matched') ORDER BY item_id`
  );

  let created = 0;
  for (const row of rows) {
    const summary = await matchingService.recalculateForItem(row.item_id, { notify: false });
    created += summary.created;
  }
  console.log(`  [matches] ${created} candidate matches generated by the real matching service.`);
}

async function seedClaim(users) {
  const { rows } = await query(`SELECT COUNT(*)::int AS total FROM claims`);
  if (rows[0].total > 0) {
    console.log('  [skip] claims already exist; demo claim was not created.');
    return;
  }

  // Ada lost her phone; Alan found it. Ada submits a claim so the administrator
  // queue is not empty on a fresh install.
  const { rows: itemRows } = await query(
    `SELECT item_id FROM items WHERE title = 'Found smartphone on a bench outside the library'`
  );
  if (itemRows.length === 0) return;
  const foundItemId = itemRows[0].item_id;
  const ada = users.get('ada@campus.test');

  try {
    const claim = await claimsService.submitClaim(
      foundItemId,
      {
        claimMessage:
          'This is my phone. The screen protector is cracked in the top-left corner and there is a cat sticker on the back case.',
        privateEvidence: 'IMEI ends 4471; demo evidence text only.',
      },
      { userId: ada.user_id, role: 'user' }
    );
    console.log(`  [claims] demo pending claim #${claim.claimId} submitted (no decisions applied).`);
  } catch (error) {
    console.log(`  [claims] skipped demo claim: ${error.message}`);
  }
}

async function main() {
  console.log(`Seeding ${describeConnection(databaseUrlFor(config.isTest ? 'test' : 'dev'))}`);
  console.log(`Demo account password for every seeded user: ${DEMO_PASSWORD} (development only)`);

  console.log('\n1. SQL seed files');
  await runSqlSeeds();

  console.log('\n2. Demo accounts');
  const users = await seedUsers();

  console.log('\n3. Demo reports');
  await seedItems(users);

  console.log('\n4. Candidate matches');
  await seedMatches();

  console.log('\n5. Demo claim');
  await seedClaim(users);

  const summary = await query(`
    SELECT (SELECT COUNT(*)::int FROM users)     AS users,
           (SELECT COUNT(*)::int FROM items)      AS items,
           (SELECT COUNT(*)::int FROM matches)    AS matches,
           (SELECT COUNT(*)::int FROM claims)     AS claims,
           (SELECT COUNT(*)::int FROM notifications) AS notifications
  `);
  const counts = summary.rows[0];
  console.log(
    `\nSeed complete: ${counts.users} users, ${counts.items} reports, ${counts.matches} matches, ` +
      `${counts.claims} claims, ${counts.notifications} notifications.`
  );
  console.log(`Repository root: ${ROOT_DIR}`);
}

main()
  .catch((error) => {
    console.error('\nSeeding failed:', error.message);
    if (error.detail) console.error('detail:', error.detail);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
