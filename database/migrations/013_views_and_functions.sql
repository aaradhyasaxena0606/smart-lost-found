-- ============================================================================
-- 013_views_and_functions.sql
-- Views and functions used by the API. Each has a documented purpose; nothing
-- here is decorative. (spec 12.2: "Use views, functions, or triggers only when
-- they serve a documented purpose")
-- ============================================================================

-- ---------------------------------------------------------------------------
-- v_public_items
-- Purpose: the single public-safe projection of a report. It joins the
-- reporter and category (demonstrating multi-table joins) and *by construction*
-- omits item_private_details, so a query written against this view cannot leak
-- private verification data. Also exposes latitude/longitude as plain numbers
-- so the API never has to serialise WKB.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_public_items AS
SELECT
  i.item_id,
  i.reporter_id,
  u.full_name                              AS reporter_name,
  i.category_id,
  c.name                                   AS category_name,
  i.report_type,
  i.title,
  i.description,
  i.colour,
  i.brand,
  i.event_time,
  i.location_name,
  i.status,
  i.created_at,
  i.updated_at,
  i.closed_at,
  CASE WHEN i.location IS NULL THEN NULL ELSE ST_Y(i.location::geometry) END AS latitude,
  CASE WHEN i.location IS NULL THEN NULL ELSE ST_X(i.location::geometry) END AS longitude,
  i.location IS NOT NULL                   AS has_location
FROM items i
JOIN users      u ON u.user_id     = i.reporter_id
JOIN categories c ON c.category_id = i.category_id
WHERE i.deleted_at IS NULL;

COMMENT ON VIEW v_public_items IS
  'Public-safe item projection: no private verification data, coordinates as lat/lon numbers.';

-- ---------------------------------------------------------------------------
-- v_pending_claims
-- Purpose: the administrator review queue as a single readable join across
-- claims, items and users. It exposes the claim message (needed for review) but
-- explicitly NOT claims.private_evidence.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_pending_claims AS
SELECT
  cl.claim_id,
  cl.item_id,
  i.title                                AS item_title,
  i.report_type,
  i.status                               AS item_status,
  cl.claimant_id,
  cu.full_name                           AS claimant_name,
  cu.email                               AS claimant_email,
  cl.claim_message,
  cl.status,
  cl.created_at,
  cl.private_evidence IS NOT NULL        AS has_private_evidence,
  d.verification_hint                    AS item_verification_hint
FROM claims cl
JOIN items      i  ON i.item_id     = cl.item_id
JOIN users      cu ON cu.user_id    = cl.claimant_id
LEFT JOIN item_private_details d ON d.item_id = cl.item_id
WHERE cl.status = 'pending';

COMMENT ON VIEW v_pending_claims IS
  'Admin claim queue. Exposes the item verification hint (required to judge ownership) but never claims.private_evidence.';

-- ---------------------------------------------------------------------------
-- v_item_match_stats
-- Purpose: aggregate report used by the dashboard ("N candidates for this
-- report, best score X"). Demonstrates GROUP BY / aggregate in the schema layer
-- so the API does not have to fetch and fold every match row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_item_match_stats AS
SELECT
  i.item_id,
  i.report_type,
  COUNT(m.match_id)                             AS match_count,
  COUNT(m.match_id) FILTER (WHERE m.match_status = 'suggested') AS suggested_count,
  COALESCE(MAX(m.overall_score), 0)::NUMERIC(5,2) AS best_score,
  MAX(m.created_at)                             AS last_match_at
FROM items i
LEFT JOIN matches m
  ON (m.lost_item_id = i.item_id OR m.found_item_id = i.item_id)
WHERE i.deleted_at IS NULL
GROUP BY i.item_id, i.report_type;

COMMENT ON VIEW v_item_match_stats IS 'Per-item match aggregates for dashboards (GROUP BY demonstration).';

-- ---------------------------------------------------------------------------
-- fn_items_within_radius
-- Purpose: reusable, index-friendly radius search in metres. Kept in the
-- database (rather than inlined in the API) so that radius semantics and the
-- coordinate order are defined exactly once.
--   p_latitude  : decimal degrees, -90..90
--   p_longitude : decimal degrees, -180..180
--   p_radius_meters : metres, inclusive boundary (ST_DWithin is <=)
-- Returns distance in metres, ordered nearest-first.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_items_within_radius(
  p_latitude       DOUBLE PRECISION,
  p_longitude      DOUBLE PRECISION,
  p_radius_meters  DOUBLE PRECISION,
  p_report_type    VARCHAR DEFAULT NULL,
  p_limit          INTEGER DEFAULT 100
)
RETURNS TABLE (
  item_id         INTEGER,
  report_type     VARCHAR,
  distance_meters DOUBLE PRECISION
)
LANGUAGE sql
STABLE
AS $$
  WITH origin AS (
    -- geography() interprets (longitude, latitude) — see the table comment.
    SELECT ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::geography AS point
  )
  SELECT
    i.item_id,
    i.report_type,
    ST_Distance(i.location, o.point) AS distance_meters
  FROM items i, origin o
  WHERE i.location IS NOT NULL
    AND i.deleted_at IS NULL
    AND (p_report_type IS NULL OR i.report_type = p_report_type)
    -- ST_DWithin uses the GiST index and returns distances in metres for geography.
    AND ST_DWithin(i.location, o.point, p_radius_meters)
  ORDER BY distance_meters ASC, i.item_id ASC
  LIMIT LEAST(GREATEST(p_limit, 1), 500);
$$;

COMMENT ON FUNCTION fn_items_within_radius IS
  'Indexed PostGIS radius search. Boundary is inclusive (ST_DWithin uses <=). Distances in metres.';

-- ---------------------------------------------------------------------------
-- fn_search_items
-- Purpose: the canonical public report search used by GET /api/v1/items.
-- Centralising it guarantees that every caller (list endpoint, exporter, future
-- admin views) applies identical visibility rules: soft-deleted rows are
-- excluded and private details are impossible to return because only
-- v_public_items columns are exposed.
-- Returns rows *plus* a window-count total so pagination needs a single query.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_search_items(
  p_report_type    VARCHAR DEFAULT NULL,
  p_category_id    INTEGER DEFAULT NULL,
  p_status         VARCHAR DEFAULT NULL,
  p_colour         VARCHAR DEFAULT NULL,
  p_brand          VARCHAR DEFAULT NULL,
  p_query          TEXT    DEFAULT NULL,
  p_from           TIMESTAMPTZ DEFAULT NULL,
  p_to             TIMESTAMPTZ DEFAULT NULL,
  p_latitude       DOUBLE PRECISION DEFAULT NULL,
  p_longitude      DOUBLE PRECISION DEFAULT NULL,
  p_radius_meters  DOUBLE PRECISION DEFAULT NULL,
  p_reporter_id    INTEGER DEFAULT NULL,
  p_sort           VARCHAR DEFAULT 'recent',
  p_limit          INTEGER DEFAULT 20,
  p_offset         INTEGER DEFAULT 0
)
RETURNS TABLE (
  item_id       INTEGER,
  reporter_id   INTEGER,
  reporter_name VARCHAR,
  category_id   INTEGER,
  category_name VARCHAR,
  report_type   VARCHAR,
  title         VARCHAR,
  description   TEXT,
  colour        VARCHAR,
  brand         VARCHAR,
  event_time    TIMESTAMPTZ,
  location_name VARCHAR,
  status        VARCHAR,
  created_at    TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ,
  closed_at     TIMESTAMPTZ,
  latitude      DOUBLE PRECISION,
  longitude     DOUBLE PRECISION,
  has_location  BOOLEAN,
  distance_meters DOUBLE PRECISION,
  relevance     REAL,
  total_count   BIGINT
)
LANGUAGE sql
STABLE
AS $$
  WITH origin AS (
    SELECT CASE
             WHEN p_latitude IS NOT NULL AND p_longitude IS NOT NULL
               THEN ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::geography
           END AS point
  ),
  filtered AS (
    SELECT
      v.*,
      CASE WHEN o.point IS NOT NULL AND i.location IS NOT NULL
           THEN ST_Distance(i.location, o.point) END AS distance_meters,
      CASE WHEN p_query IS NULL OR btrim(p_query) = '' THEN NULL
           ELSE similarity(v.title, p_query) * 2 + similarity(v.description, p_query) END AS relevance
    FROM v_public_items v
    JOIN items i ON i.item_id = v.item_id
    CROSS JOIN origin o
    WHERE (p_report_type  IS NULL OR v.report_type  = p_report_type)
      AND (p_category_id  IS NULL OR v.category_id  = p_category_id)
      AND (p_status       IS NULL OR v.status       = p_status)
      AND (p_colour       IS NULL OR lower(v.colour) = lower(p_colour))
      AND (p_brand        IS NULL OR lower(v.brand)  = lower(p_brand))
      AND (p_from         IS NULL OR v.event_time >= p_from)
      AND (p_to           IS NULL OR v.event_time <= p_to)
      AND (p_reporter_id  IS NULL OR v.reporter_id  = p_reporter_id)
      AND (
        p_query IS NULL OR btrim(p_query) = ''
        OR v.title       ILIKE '%' || p_query || '%'
        OR v.description ILIKE '%' || p_query || '%'
        OR similarity(v.title, p_query) > 0.15
      )
      AND (
        o.point IS NULL
        OR (p_radius_meters IS NULL)
        OR (i.location IS NOT NULL AND ST_DWithin(i.location, o.point, p_radius_meters))
      )
  )
  SELECT
    f.item_id, f.reporter_id, f.reporter_name, f.category_id, f.category_name,
    f.report_type, f.title, f.description, f.colour, f.brand, f.event_time,
    f.location_name, f.status, f.created_at, f.updated_at, f.closed_at,
    f.latitude, f.longitude, f.has_location, f.distance_meters, f.relevance,
    COUNT(*) OVER () AS total_count
  FROM filtered f
  ORDER BY
    CASE WHEN p_sort = 'distance' AND f.distance_meters IS NOT NULL THEN f.distance_meters END ASC NULLS LAST,
    CASE WHEN p_sort = 'relevance' THEN f.relevance END DESC NULLS LAST,
    CASE WHEN p_sort = 'event_time' THEN f.event_time END DESC NULLS LAST,
    f.created_at DESC,
    f.item_id   DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 100)
  OFFSET GREATEST(p_offset, 0);
$$;

COMMENT ON FUNCTION fn_search_items IS
  'Canonical public report search: filters, relevance, radius and window-count pagination in one indexed query.';
