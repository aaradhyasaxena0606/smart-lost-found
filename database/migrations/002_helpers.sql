-- ============================================================================
-- 002_helpers.sql
-- Small, reusable trigger helpers shared by several tables.
-- ============================================================================

-- Maintains `updated_at` on UPDATE without relying on the application layer,
-- so manual SQL and administrative fixes stay consistent too.
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_set_updated_at() IS
  'BEFORE UPDATE trigger helper that stamps updated_at with the current timestamp.';
