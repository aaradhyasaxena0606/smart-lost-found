-- ============================================================================
-- 001_init_extensions.sql
-- Enables the PostgreSQL extensions the schema depends on.
-- ============================================================================

-- PostGIS provides the geographic types (geography/geometry), the distance
-- and proximity functions, and the GiST spatial index used for radius search.
CREATE EXTENSION IF NOT EXISTS postgis;

-- pgcrypto provides gen_random_uuid(), used to generate opaque, non-guessable
-- filenames for uploaded images so that user-supplied names are never trusted.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- plpgsql is the procedural language used by the schema's validation triggers.
CREATE EXTENSION IF NOT EXISTS plpgsql;

-- pg_trgm powers indexed fuzzy/substring text search on item titles and
-- descriptions (GIN trigram index in 012_indexes.sql), so keyword search does
-- not degenerate into a sequential scan.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
