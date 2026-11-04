-- ============================================================================
-- reset-demo-data.sql
--
-- Clears all lost/found activity so you can run a demo from a clean slate,
-- WITHOUT deleting accounts or categories. Run it before each demo.
--
--   Local:     psql -U postgres -d smart_lost_found -f database/scripts/reset-demo-data.sql
--   Supabase:  paste the whole file into the SQL Editor and Run.
--
-- Removed:  reports, images, private details, matches, claims, notifications,
--           and the audit rows for item/claim/match actions.
-- Kept:     users (accounts), categories, schema and migrations.
--
-- ID sequences restart at 1, so the first demo report is item #1.
-- This is irreversible. It is intended for development and demo databases only.
-- ============================================================================

BEGIN;

-- Claims reference items with ON DELETE RESTRICT, so they go first.
DELETE FROM notifications;
DELETE FROM claims;
DELETE FROM matches;
DELETE FROM item_images;
DELETE FROM item_private_details;

-- Audit rows about items that are about to disappear. Account-level rows
-- (user.registered, user.login, user.role_granted) are preserved.
DELETE FROM audit_logs
 WHERE entity_type IN ('item', 'claim', 'match');

DELETE FROM items;

-- Start numbering fresh for a tidy demo.
ALTER SEQUENCE items_item_id_seq                  RESTART WITH 1;
ALTER SEQUENCE matches_match_id_seq               RESTART WITH 1;
ALTER SEQUENCE claims_claim_id_seq                RESTART WITH 1;
ALTER SEQUENCE notifications_notification_id_seq  RESTART WITH 1;
ALTER SEQUENCE item_images_image_id_seq           RESTART WITH 1;
ALTER SEQUENCE item_private_details_private_detail_id_seq RESTART WITH 1;

COMMIT;

-- Confirmation: everything report-related should be 0, users/categories intact.
SELECT 'items'         AS table_name, COUNT(*) AS rows FROM items
UNION ALL SELECT 'matches',       COUNT(*) FROM matches
UNION ALL SELECT 'claims',        COUNT(*) FROM claims
UNION ALL SELECT 'notifications', COUNT(*) FROM notifications
UNION ALL SELECT 'images',        COUNT(*) FROM item_images
UNION ALL SELECT 'private details', COUNT(*) FROM item_private_details
UNION ALL SELECT 'users (kept)',  COUNT(*) FROM users
UNION ALL SELECT 'categories (kept)', COUNT(*) FROM categories
ORDER BY table_name;

-- ---------------------------------------------------------------------------
-- OPTIONAL: also remove every account except administrators. Uncomment if the
-- account list looks cluttered during a demo. Administrators are kept so you can
-- still sign in; delete them too only if you intend to recreate one.
-- ---------------------------------------------------------------------------
-- DELETE FROM users WHERE role <> 'admin';
