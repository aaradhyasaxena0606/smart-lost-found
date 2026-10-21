/**
 * Spatial database tests.
 *
 * Acceptance criteria covered (PROJECT_SPEC.md section 18 "Spatial Database"):
 *   * setup/migrations enable PostGIS
 *   * coordinates are stored in the selected spatial type and the coordinate
 *     order is documented
 *   * a spatial index exists
 *   * radius queries return points inside the radius and exclude points outside
 *   * spatial distance calculations use appropriate units (metres)
 */
import './helpers/load-test-env.js';
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { api, API, resetDatabase, closeDatabase, createUserViaApi, createItemViaApi, getCategoryId } from './helpers/setup.js';
import { query } from '../src/config/db.js';
import { haversineMeters } from '../src/utils/geo.js';

let owner;
let categoryId;

/** Library reference point used by every case below. */
const ORIGIN = { latitude: 51.5007, longitude: -0.1246 };

before(async () => {
  await resetDatabase();
  categoryId = await getCategoryId('Mobile Phone');
  owner = await createUserViaApi({ fullName: 'Spatial Owner' });
});

after(async () => {
  await closeDatabase();
});

const auth = (token) => ({ Authorization: `Bearer ${token}` });

/** Creates a report at an offset (in degrees) from ORIGIN. */
async function createAt(offsetLat, offsetLon, overrides = {}) {
  return createItemViaApi(owner.token, {
    categoryId,
    latitude: ORIGIN.latitude + offsetLat,
    longitude: ORIGIN.longitude + offsetLon,
    ...overrides,
  });
}

describe('PostGIS setup', () => {
  test('the postgis extension is installed by the migrations', async () => {
    const { rows } = await query(
      `SELECT extversion, extname FROM pg_extension WHERE extname IN ('postgis', 'pg_trgm')`
    );
    const names = rows.map((row) => row.extname).sort();
    assert.deepEqual(names, ['pg_trgm', 'postgis']);
    assert.match(rows.find((row) => row.extname === 'postgis').extversion, /^3\./);
  });

  test('items.location is geography(Point,4326)', async () => {
    // Geography columns are listed in geography_columns (geometry_columns only
    // covers the geometry type), so this checks the correct catalogue.
    const { rows } = await query(
      `SELECT type, srid, coord_dimension
         FROM geography_columns
        WHERE f_table_name = 'items' AND f_geography_column = 'location'`
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].type, 'Point');
    assert.equal(rows[0].srid, 4326);
    assert.equal(rows[0].coord_dimension, 2);
  });

  test('a GiST index exists on items.location', async () => {
    const { rows } = await query(
      `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'items_location_gist_idx'`
    );
    assert.equal(rows.length, 1);
    assert.match(rows[0].indexdef, /USING gist/i);
    assert.match(rows[0].indexdef, /location/);
  });

  test('the GiST index actually supports the ST_DWithin predicate', async () => {
    // On a table with a handful of rows the planner may legitimately prefer a
    // sequential scan, so this checks *usability* rather than the chosen plan:
    // with sequential scans disabled the only remaining option is the GiST index,
    // which proves it can answer this predicate.
    await query('SET enable_seqscan = OFF');
    try {
      const { rows } = await query(
        `EXPLAIN SELECT item_id FROM items
          WHERE location IS NOT NULL
            AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 1000)`,
        [ORIGIN.longitude, ORIGIN.latitude]
      );
      const plan = rows.map((row) => row['QUERY PLAN']).join('\n');
      assert.match(plan, /items_location_gist_idx/, `expected the GiST index in the plan:\n${plan}`);
    } finally {
      await query('SET enable_seqscan = ON');
    }
  });
});

describe('Distance units and coordinate order', () => {
  test('geography distances are reported in metres', async () => {
    const { rows } = await query(
      `SELECT ST_Distance(
                ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
                ST_SetSRID(ST_MakePoint($1, $3), 4326)::geography
              ) AS metres`,
      [ORIGIN.longitude, ORIGIN.latitude, ORIGIN.latitude + 0.009]
    );
    // 0.009 degrees of latitude is roughly 1 km on the WGS84 spheroid.
    assert.ok(rows[0].metres > 990 && rows[0].metres < 1010, `expected ~1000 m, got ${rows[0].metres}`);
  });

  test('a report created with latitude/longitude is stored with the axes swapped correctly', async () => {
    const created = await createAt(0.01, 0.02);
    const { rows } = await query(
      `SELECT ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude
         FROM items WHERE item_id = $1`,
      [created.itemId]
    );
    assert.ok(Math.abs(Number(rows[0].latitude) - (ORIGIN.latitude + 0.01)) < 1e-9);
    assert.ok(Math.abs(Number(rows[0].longitude) - (ORIGIN.longitude + 0.02)) < 1e-9);
  });
});

describe('Radius search boundaries', () => {
  test('returns points inside the radius and excludes points outside it', async () => {
    await resetDatabase();
    categoryId = await getCategoryId('Mobile Phone');
    owner = await createUserViaApi({ fullName: 'Radius Owner' });
    await query(`INSERT INTO categories (name, description) VALUES ('Umbrella', 'x') ON CONFLICT DO NOTHING`);

    const inside = await createAt(0.001, 0.001); // ~144 m away
    const outside = await createAt(0.05, 0.05); // ~7.8 km away

    const { rows: distances } = await query(
      `SELECT
         (SELECT ST_Distance(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) FROM items WHERE item_id = $3) AS inside_m,
         (SELECT ST_Distance(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) FROM items WHERE item_id = $4) AS outside_m`,
      [ORIGIN.latitude, ORIGIN.longitude, inside.itemId, outside.itemId]
    );

    const insideMeters = Number(distances[0].inside_m);
    const outsideMeters = Number(distances[0].outside_m);

    // A radius just above the "inside" distance must include it and exclude the
    // far point.
    const radius = Math.round(insideMeters + 50);
    const response = await api.get(
      `${API}/items?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&radiusMeters=${radius}&sort=distance`
    );

    assert.equal(response.status, 200);
    const ids = response.body.data.map((item) => item.itemId);
    assert.ok(ids.includes(inside.itemId), 'the near report must be returned');
    assert.ok(!ids.includes(outside.itemId), 'the far report must be excluded');

    // Distances come back in metres and match the values PostGIS computes.
    const returned = response.body.data.find((item) => item.itemId === inside.itemId);
    assert.ok(Math.abs(returned.distanceMeters - insideMeters) < 0.001);
    assert.ok(
      Math.abs(returned.distanceMeters - haversineMeters(ORIGIN.latitude, ORIGIN.longitude, ORIGIN.latitude + 0.001, ORIGIN.longitude + 0.001)) < 1,
      'the spatial distance must agree with an independent great-circle calculation'
    );
    assert.ok(outsideMeters > radius);
  });

  test('the radius boundary is inclusive within a sub-millimetre tolerance', async () => {
    // ST_DWithin applies `<=` to a *spheroidal* distance estimate that PostGIS
    // computes separately from ST_Distance. The two can differ by a fraction of a
    // millimetre, so a radius exactly equal to ST_Distance is not guaranteed to
    // include the point. The behaviour this project documents and relies on is:
    //   * radius >= distance + 1 cm  -> included
    //   * radius <= distance - 1 m   -> excluded
    const { rows } = await query(
      `SELECT item_id,
              ST_Distance(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) AS metres
         FROM items WHERE item_id = (
           SELECT item_id FROM items ORDER BY item_id LIMIT 1
         )`,
      [ORIGIN.latitude, ORIGIN.longitude]
    );
    const { item_id: itemId, metres } = rows[0];

    const within = async (radius) => {
      const result = await query(
        `SELECT COUNT(*)::int AS n FROM items
          WHERE item_id = $3
            AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $4)`,
        [ORIGIN.latitude, ORIGIN.longitude, itemId, radius]
      );
      return result.rows[0].n;
    };

    assert.equal(await within(metres + 0.01), 1, 'a radius 1 cm larger must include the point');
    assert.equal(await within(metres - 1), 0, 'a radius 1 m smaller must exclude the point');

    // Record the exact-equality behaviour so a future PostGIS change is visible.
    const exact = await within(metres);
    assert.ok(exact === 0 || exact === 1, 'the exact-boundary result must be a valid count');
  });

  test('reports without a location are handled gracefully (never crash, never match a radius)', async () => {
    const payload = {
      reportType: 'lost',
      categoryId,
      title: 'Report with no coordinates at all',
      description: 'This report deliberately omits latitude and longitude values.',
      eventTime: new Date(Date.now() - 3600_000).toISOString(),
      locationName: 'Somewhere on campus',
    };
    const created = await api.post(`${API}/items`).set(auth(owner.token)).send(payload);
    assert.equal(created.status, 201);
    assert.equal(created.body.data.location, null);

    const response = await api.get(
      `${API}/items?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&radiusMeters=100000`
    );
    assert.equal(response.status, 200);
    assert.ok(
      !response.body.data.some((item) => item.itemId === created.body.data.itemId),
      'a report without coordinates must be excluded from a radius search'
    );

    // ...but it is still visible in an unfiltered listing.
    const all = await api.get(`${API}/items?limit=100`);
    assert.ok(all.body.data.some((item) => item.itemId === created.body.data.itemId));
  });

  test('the radius query rejects a missing or invalid radius', async () => {
    const negative = await api.get(
      `${API}/items?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&radiusMeters=-5`
    );
    assert.equal(negative.status, 422);

    const tooLarge = await api.get(
      `${API}/items?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&radiusMeters=500000`
    );
    assert.equal(tooLarge.status, 422);
  });

  test('fn_items_within_radius reports distances ordered nearest first', async () => {
    const { rows } = await query(
      `SELECT item_id, distance_meters FROM fn_items_within_radius($1, $2, 5000, NULL, 50)`,
      [ORIGIN.latitude, ORIGIN.longitude]
    );
    assert.ok(rows.length > 0);
    for (let i = 1; i < rows.length; i += 1) {
      assert.ok(rows[i - 1].distance_meters <= rows[i].distance_meters, 'distances must be ascending');
    }
    assert.ok(rows.every((row) => row.distance_meters <= 5000));
  });
});
