-- ============================================================================
-- 016_public_search_active_only.sql
--
-- Closing a report did not remove it from public browse: the search filtered only
-- soft-deleted rows, so `closed`, `returned` and `rejected` reports stayed in the
-- catalogue and cluttered the listings.
--
-- The function now takes a STATUS ARRAY instead of a single status, so the API can
-- default public browse to the active lifecycle states
-- (open, matched, claimed) while still allowing an explicit filter such as
-- status=closed to inspect history.
-- ============================================================================

DROP FUNCTION IF EXISTS fn_search_items(
  VARCHAR, INTEGER, VARCHAR, VARCHAR, VARCHAR, TEXT,
  TIMESTAMPTZ, TIMESTAMPTZ, DOUBLE PRECISION, DOUBLE PRECISION,
  DOUBLE PRECISION, INTEGER, VARCHAR, INTEGER, INTEGER
);

CREATE OR REPLACE FUNCTION fn_search_items(
  p_report_type    VARCHAR DEFAULT NULL,
  p_category_id    INTEGER DEFAULT NULL,
  p_statuses       VARCHAR[] DEFAULT NULL,
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
      -- Array membership: the API passes ['open','matched','claimed'] for public
      -- browse, or a single status when the caller filters explicitly.
      AND (p_statuses      IS NULL OR v.status = ANY(p_statuses))
      AND (p_colour       IS NULL OR lower(v.colour) = lower(p_colour))
      AND (p_brand        IS NULL OR lower(v.brand)  = lower(p_brand))
      AND (p_from         IS NULL OR v.event_time >= p_from)
      AND (p_to           IS NULL OR v.event_time <= p_to)
      AND (p_reporter_id  IS NULL OR v.reporter_id  = p_reporter_id)
      AND (
        p_query IS NULL OR btrim(p_query) = ''
        OR v.title       ILIKE '%' || p_query || '%'
        OR v.description ILIKE '%' || p_query || '%'
        OR v.title       % p_query
        OR v.description % p_query
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
  'Public report search. Public browse passes the active statuses so closed/returned/rejected reports leave the catalogue; an explicit status filter can still retrieve them.';
