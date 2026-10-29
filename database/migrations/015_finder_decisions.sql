-- ============================================================================
-- 015_finder_decisions.sql
--
-- Moves routine claim decisions from administrators to the finder, with the
-- administrator as the appeal path. See docs/design-decisions.md.
--
-- New columns
--   decided_by_role  who made the decision: 'finder' or 'admin'
--   disputed_at      when the claimant contested a rejection
--   dispute_reason   why the claimant contests it
--
-- A dispute returns the claim to 'pending' (so the administrator can decide it)
-- while the original rejection stays in audit_logs.
-- ============================================================================

ALTER TABLE claims
  ADD COLUMN decided_by_role VARCHAR(8),
  ADD COLUMN disputed_at     TIMESTAMPTZ,
  ADD COLUMN dispute_reason  VARCHAR(1000);

-- Existing decided claims were all administrative.
UPDATE claims
   SET decided_by_role = 'admin'
 WHERE status IN ('approved', 'rejected');

ALTER TABLE claims
  ADD CONSTRAINT claims_decided_by_role_chk
    CHECK (decided_by_role IS NULL OR decided_by_role IN ('finder', 'admin')),
  -- A decision role only makes sense on a decided claim, and every decided claim
  -- must record who decided it.
  ADD CONSTRAINT claims_decided_by_role_consistency_chk
    CHECK ((status IN ('approved', 'rejected')) = (decided_by_role IS NOT NULL)),
  ADD CONSTRAINT claims_dispute_chk
    CHECK (disputed_at IS NULL OR dispute_reason IS NOT NULL);

COMMENT ON COLUMN claims.decided_by_role IS
  'finder = the reporter of the found item decided; admin = an administrator decided (appeal or escalation).';

-- The administrator queue is driven by age, so an index on the pending window
-- keeps the "overdue" query cheap as claims accumulate.
CREATE INDEX claims_pending_created_idx ON claims (created_at) WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- New notification kinds for the finder-first workflow.
-- ---------------------------------------------------------------------------
ALTER TABLE notifications DROP CONSTRAINT notifications_type_chk;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_chk CHECK (notification_type IN (
    'item_matched',
    'claim_submitted',
    'claim_approved',
    'claim_rejected',
    'claim_withdrawn',
    'claim_disputed',
    'claim_escalated',
    'item_returned',
    'item_moderated',
    'item_closed'
  ));

