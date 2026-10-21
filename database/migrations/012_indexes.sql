-- ============================================================================
-- 012_indexes.sql
-- Indexes supporting the documented query patterns (NFR-07, spec 12.2).
--
-- Rationale for each group is given so the choice can be defended and
-- re-measured with `npm run db:explain` (EXPLAIN ANALYZE walkthrough).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- items: list/filter/sort and join columns
-- ---------------------------------------------------------------------------
-- Public listings always filter on report_type and exclude soft-deleted rows.
CREATE INDEX items_report_type_created_idx ON items (report_type, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX items_status_idx       ON items (status)      WHERE deleted_at IS NULL;
CREATE INDEX items_category_idx     ON items (category_id) WHERE deleted_at IS NULL;
CREATE INDEX items_event_time_idx   ON items (event_time DESC) WHERE deleted_at IS NULL;
CREATE INDEX items_reporter_idx     ON items (reporter_id, created_at DESC);
CREATE INDEX items_colour_idx       ON items (lower(colour)) WHERE colour IS NOT NULL;
CREATE INDEX items_brand_idx        ON items (lower(brand))  WHERE brand  IS NOT NULL;

-- Partial index tuned for the matching engine, which repeatedly looks up
-- *open* reports by type + category (see services/matching.service.js).
CREATE INDEX items_open_match_idx ON items (report_type, category_id, event_time DESC)
  WHERE deleted_at IS NULL AND status IN ('open', 'matched');

-- Fuzzy text search on title/description using pg_trgm.
CREATE INDEX items_title_trgm_idx ON items USING GIN (title gin_trgm_ops);
CREATE INDEX items_description_trgm_idx ON items USING GIN (description gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- items.location: GiST spatial index (required by spec 12.2 / acceptance tests).
-- This is what makes ST_DWithin radius search an index scan instead of a
-- sequential scan over every report.
-- ---------------------------------------------------------------------------
CREATE INDEX items_location_gist_idx ON items USING GIST (location);

-- ---------------------------------------------------------------------------
-- item_images / item_private_details
-- ---------------------------------------------------------------------------
CREATE INDEX item_images_item_idx ON item_images (item_id);

-- ---------------------------------------------------------------------------
-- matches
-- ---------------------------------------------------------------------------
CREATE INDEX matches_lost_idx     ON matches (lost_item_id, overall_score DESC);
CREATE INDEX matches_found_idx    ON matches (found_item_id, overall_score DESC);
CREATE INDEX matches_status_idx   ON matches (match_status);
CREATE INDEX matches_reasons_gin  ON matches USING GIN (match_reasons);
-- Covering index for the "best matches for this user" dashboard query.
CREATE INDEX matches_ranked_idx   ON matches (overall_score DESC, match_id)
  WHERE match_status = 'suggested';

-- ---------------------------------------------------------------------------
-- claims
-- ---------------------------------------------------------------------------
CREATE INDEX claims_item_idx     ON claims (item_id);
CREATE INDEX claims_claimant_idx ON claims (claimant_id, created_at DESC);
CREATE INDEX claims_reviewer_idx ON claims (reviewed_by);

-- Partial index for the administrator review queue (only pending claims).
CREATE INDEX claims_pending_idx  ON claims (created_at)
  WHERE status = 'pending';

-- Concurrency rule (FR-18): a claimant may hold at most ONE active claim per
-- item. Two simultaneous submissions therefore cannot both succeed; the loser
-- receives a unique-violation which the API maps to HTTP 409.
CREATE UNIQUE INDEX claims_active_unique_idx
  ON claims (item_id, claimant_id)
  WHERE status IN ('pending', 'approved');
