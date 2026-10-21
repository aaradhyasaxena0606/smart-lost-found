-- ============================================================================
-- Database demonstration script (Phase 2 verification).
--
-- Exercises the spatial functions, triggers, constraints and views the schema
-- promises, and shows that each expected failure really is refused by the
-- DATABASE (not merely by the API).
--
-- Design notes
--   * Everything runs inside ONE transaction that is ROLLED BACK at the end, so
--     the script is safe against any database, including one holding real data.
--   * Every statement expected to fail is wrapped in a SAVEPOINT, so one
--     expected error does not abort the rest of the demonstration.
--   * All fixtures are scoped to the two synthetic "sanity-*" accounts, so the
--     script behaves identically on an empty database and on a seeded one.
--
-- Run with:
--   psql -U postgres -d smart_lost_found -f database/scripts/sanity-check.sql
--
-- Lines beginning with "ERROR:" in the output are the point of the script: they
-- are the constraints doing their job.
-- ============================================================================
\set ON_ERROR_STOP off
\pset pager off

BEGIN;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
INSERT INTO users (full_name, email, password_hash) VALUES
  ('Sanity Lost Reporter',  'sanity-ada@campus.test',  repeat('x', 60)),
  ('Sanity Found Reporter', 'sanity-alan@campus.test', repeat('x', 60));

INSERT INTO categories (name, description) VALUES ('Mobile Phone', 'Phones')
ON CONFLICT (name) DO NOTHING;

\echo ''
\echo '=== 0. FIXTURES: two reports ~26 m apart at the campus reference point ==='

-- Campus reference: 51.5007 N, -0.1246 W -> ST_MakePoint(longitude, latitude)
INSERT INTO items (reporter_id, category_id, report_type, title, description, colour, brand, event_time, location_name, location)
SELECT u.user_id, c.category_id, 'lost', 'Sanity lost black iPhone 15', 'Black iPhone with a cracked screen protector and a cat sticker.',
       'black', 'Apple', now() - interval '2 days', 'Main Library',
       ST_SetSRID(ST_MakePoint(-0.1246, 51.5007), 4326)::geography
FROM users u, categories c WHERE u.email = 'sanity-ada@campus.test' AND c.name = 'Mobile Phone';

INSERT INTO items (reporter_id, category_id, report_type, title, description, colour, brand, event_time, location_name, location)
SELECT u.user_id, c.category_id, 'found', 'Sanity found phone near the library', 'Found a black Apple smartphone on a bench outside the library.',
       'black', 'Apple', now() - interval '2 days' + interval '3 hours', 'Library steps',
       ST_SetSRID(ST_MakePoint(-0.1248, 51.5009), 4326)::geography
FROM users u, categories c WHERE u.email = 'sanity-alan@campus.test' AND c.name = 'Mobile Phone';

-- Remember this script's own item ids so every later statement is precise.
SELECT i.item_id AS lost_id FROM items i JOIN users u ON u.user_id = i.reporter_id
 WHERE u.email = 'sanity-ada@campus.test' AND i.report_type = 'lost' \gset
SELECT i.item_id AS found_id FROM items i JOIN users u ON u.user_id = i.reporter_id
 WHERE u.email = 'sanity-alan@campus.test' AND i.report_type = 'found' \gset

SELECT :lost_id AS sanity_lost_item_id, :found_id AS sanity_found_item_id;

-- ---------------------------------------------------------------------------
\echo ''
\echo '=== 1. SPATIAL: radius search in metres (PostGIS + GiST) ==='
SELECT item_id, report_type, round(distance_meters::numeric, 2) AS metres
  FROM fn_items_within_radius(51.5007, -0.1246, 500)
 WHERE item_id IN (:lost_id, :found_id);

\echo '--- 1b. a 10 m radius must exclude the found report that is ~26 m away ---'
SELECT item_id, round(distance_meters::numeric, 2) AS metres
  FROM fn_items_within_radius(51.5007, -0.1246, 10)
 WHERE item_id IN (:lost_id, :found_id);

\echo '--- 1c. geography distances are reported in metres ---'
SELECT round(ST_Distance(a.location, b.location)::numeric, 2) AS metres
  FROM items a, items b WHERE a.item_id = :lost_id AND b.item_id = :found_id;

-- On a small table the planner may legitimately prefer a sequential scan, so
-- these plans are illustrative. `npm run db:explain` loads 100 000 rows and shows
-- the GiST and GIN index scans the schema is designed for.
\echo '--- 1d. EXPLAIN: radius search plan (small table: any index may win) ---'
EXPLAIN (COSTS OFF) SELECT item_id FROM items
 WHERE item_id = :lost_id
   AND ST_DWithin(location, ST_SetSRID(ST_MakePoint(-0.1246, 51.5007), 4326)::geography, 1500);

\echo '--- 1e. the private hint is inserted now for section 4d (scoped to our fixture) ---'
INSERT INTO item_private_details (item_id, verification_hint)
VALUES (:found_id, 'initials A.L. under the case')
ON CONFLICT (item_id) DO NOTHING;
SELECT verification_hint FROM item_private_details WHERE item_id = :found_id;

-- ---------------------------------------------------------------------------
\echo ''
\echo '=== 2. TRIGGER: a match must pair one lost report with one found report ==='
\echo '--- 2a. wrong orientation (found in lost_item_id) must FAIL ---'
SAVEPOINT s2a;
INSERT INTO matches (lost_item_id, found_item_id, attribute_score, time_score, overall_score)
VALUES (:found_id, :lost_id, 50, 50, 50);
ROLLBACK TO s2a;

\echo '--- 2b. correct orientation must SUCCEED ---'
INSERT INTO matches (lost_item_id, found_item_id, attribute_score, time_score, spatial_score, overall_score, match_reasons)
VALUES (:lost_id, :found_id, 88, 95, 97, 92, '[{"code":"category_match"}]'::jsonb);

\echo '--- 2c. the same pair again must FAIL (unique constraint) ---'
SAVEPOINT s2c;
INSERT INTO matches (lost_item_id, found_item_id, attribute_score, time_score, overall_score)
VALUES (:lost_id, :found_id, 10, 10, 10);
ROLLBACK TO s2c;

\echo '--- 2d. an item paired with itself must FAIL ---'
SAVEPOINT s2d;
INSERT INTO matches (lost_item_id, found_item_id, attribute_score, time_score, overall_score)
VALUES (:lost_id, :lost_id, 10, 10, 10);
ROLLBACK TO s2d;

-- ---------------------------------------------------------------------------
\echo ''
\echo '=== 3. TRIGGER: item status transitions ==='
\echo '--- 3a. an illegal transition (open -> returned) must FAIL ---'
SAVEPOINT s3a;
UPDATE items SET status = 'returned' WHERE item_id = :lost_id;
ROLLBACK TO s3a;

\echo '--- 3b. a legal transition (open -> matched) must SUCCEED ---'
UPDATE items SET status = 'matched' WHERE item_id = :lost_id;
SELECT item_id, report_type, status FROM items WHERE item_id IN (:lost_id, :found_id) ORDER BY item_id;

-- ---------------------------------------------------------------------------
\echo ''
\echo '=== 4. CLAIMS: invariants ==='
\echo '--- 4a. an administrator reviewing their own claim must FAIL ---'
SAVEPOINT s4a;
INSERT INTO claims (item_id, claimant_id, claim_message, status, reviewed_by, reviewed_at)
SELECT :found_id, i.reporter_id, 'Sanity claim that attempts self review.', 'approved', i.reporter_id, now()
  FROM items i WHERE i.item_id = :found_id;
ROLLBACK TO s4a;

\echo '--- 4b. a valid pending claim must SUCCEED ---'
INSERT INTO claims (item_id, claimant_id, claim_message, private_evidence)
SELECT :found_id, i.reporter_id, 'Sanity claim: the screen protector is cracked top-left.', 'IMEI ends 0000'
  FROM items i WHERE i.item_id = :lost_id;

\echo '--- 4c. a duplicate ACTIVE claim by the same user must FAIL (partial unique index) ---'
SAVEPOINT s4c;
INSERT INTO claims (item_id, claimant_id, claim_message)
SELECT :found_id, i.reporter_id, 'Sanity second claim from the same user.'
  FROM items i WHERE i.item_id = :lost_id;
ROLLBACK TO s4c;

\echo '--- 4d. approving the same claim must SUCCEED ---'
UPDATE claims SET status = 'approved',
                 reviewed_by = (SELECT user_id FROM users WHERE email = 'sanity-alan@campus.test'),
                 reviewed_at = now()
 WHERE item_id = :found_id;

\echo '--- 4e. a SECOND claim by the same user must still FAIL after approval ---'
SAVEPOINT s4e;
INSERT INTO claims (item_id, claimant_id, claim_message)
SELECT :found_id, i.reporter_id, 'Sanity claim attempt after approval.'
  FROM items i WHERE i.item_id = :lost_id;
ROLLBACK TO s4e;

\echo '--- 4f. a rejection without a reason must FAIL ---'
SAVEPOINT s4f;
UPDATE claims SET status = 'rejected',
                 reviewed_by = (SELECT user_id FROM users WHERE email = 'sanity-alan@campus.test'),
                 reviewed_at = now(), review_reason = NULL
 WHERE item_id = :found_id;
ROLLBACK TO s4f;

\echo '--- 4g. v_pending_claims joins claims/items/users and never exposes private_evidence ---'
SELECT claim_id, item_title, claimant_name, has_private_evidence, left(item_verification_hint, 40) AS hint
  FROM v_pending_claims WHERE item_id = :found_id;

-- ---------------------------------------------------------------------------
\echo ''
\echo '=== 5. PRIVACY: v_public_items cannot expose private details ==='
SELECT string_agg(column_name, ', ' ORDER BY ordinal_position) AS public_columns
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'v_public_items';

SELECT count(*) AS verification_hint_columns_in_public_view
  FROM information_schema.columns
 WHERE table_name = 'v_public_items' AND column_name = 'verification_hint';

-- ---------------------------------------------------------------------------
\echo ''
\echo '=== 6. CONSTRAINTS: not-null, unique, check, length, enum ==='
\echo '--- 6a. an email differing only by case must FAIL (normalized uniqueness) ---'
SAVEPOINT s6a;
INSERT INTO users (full_name, email, password_hash) VALUES ('Impostor', 'SANITY-ADA@campus.test', repeat('x', 60));
ROLLBACK TO s6a;

\echo '--- 6b. a too-short password hash must FAIL ---'
SAVEPOINT s6b;
INSERT INTO users (full_name, email, password_hash) VALUES ('Short Hash', 'sanity-short@campus.test', 'tooshort');
ROLLBACK TO s6b;

\echo '--- 6c. an unknown report_type must FAIL ---'
SAVEPOINT s6c;
INSERT INTO items (reporter_id, category_id, report_type, title, description, event_time)
SELECT reporter_id, category_id, 'stolen', 'Sanity invalid type report', 'A sufficiently long description.', now()
  FROM items WHERE item_id = :lost_id;
ROLLBACK TO s6c;

\echo '--- 6d. a too-short title must FAIL ---'
SAVEPOINT s6d;
INSERT INTO items (reporter_id, category_id, report_type, title, description, event_time)
SELECT reporter_id, category_id, 'lost', 'ab', 'A sufficiently long description.', now()
  FROM items WHERE item_id = :lost_id;
ROLLBACK TO s6d;

\echo '--- 6e. an out-of-range match score must FAIL ---'
SAVEPOINT s6e;
INSERT INTO matches (lost_item_id, found_item_id, attribute_score, time_score, overall_score)
VALUES (:lost_id, :found_id, 150, 50, 50);
ROLLBACK TO s6e;

\echo '--- 6f. a referencing row with a missing parent must FAIL (foreign key) ---'
SAVEPOINT s6f;
INSERT INTO claims (item_id, claimant_id, claim_message)
VALUES (2147483647, 2147483647, 'Sanity claim with a missing parent row.');
ROLLBACK TO s6f;

-- ---------------------------------------------------------------------------
\echo ''
\echo '=== 7. SEARCH: fn_search_items (filters, distance sort, window-count pagination) ==='
SELECT item_id, report_type, left(title, 32) AS title, status,
       round(distance_meters::numeric, 1) AS metres, total_count
  FROM fn_search_items(p_latitude => 51.5007, p_longitude => -0.1246, p_radius_meters => 1000, p_sort => 'distance')
 WHERE item_id IN (:lost_id, :found_id);

\echo '--- 7b. the same search with a 10 m radius must return ONLY the fixture at the origin ---'
SELECT count(*) AS fixtures_within_10m
  FROM fn_search_items(p_latitude => 51.5007, p_longitude => -0.1246, p_radius_meters => 10)
 WHERE item_id IN (:lost_id, :found_id);

\echo '--- 7c. soft delete hides a report from v_public_items and fn_search_items ---'
UPDATE items SET deleted_at = now() WHERE item_id = :found_id;
SELECT count(*) AS fixture_visible_after_soft_delete FROM v_public_items WHERE item_id = :found_id;
SELECT count(*) AS fixture_searchable_after_soft_delete FROM fn_search_items(p_reporter_id => (
  SELECT reporter_id FROM items WHERE item_id = :found_id
)) WHERE item_id = :found_id;

\echo '--- 7d. the row is still present (history preserved) ---'
SELECT item_id, deleted_at IS NOT NULL AS soft_deleted FROM items WHERE item_id = :found_id;

ROLLBACK;
\echo ''
\echo '=== ALL CHECKS DONE - transaction rolled back, no data persisted ==='
