/** Administrator claim review queue with approve/reject decisions (FR-19, FR-20). */
import { useState } from 'react';
import { claimsApi } from '../api/endpoints.js';
import { useAsyncData } from '../hooks/useAsyncData.js';
import ClaimCard from '../components/ClaimCard.jsx';
import Pagination from '../components/Pagination.jsx';
import { Loading, ErrorMessage, EmptyState, Field } from '../components/Feedback.jsx';

export function AdminClaimsPage() {
  const [includeDecided, setIncludeDecided] = useState(false);
  const [page, setPage] = useState(1);
  const [decision, setDecision] = useState({ open: false, claim: null, value: 'approved', reason: '' });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [notice, setNotice] = useState(null);

  const query = useAsyncData(
    () => claimsApi.queue({ page, limit: 10, includeDecided: includeDecided ? true : undefined }),
    [page, includeDecided]
  );

  const submitDecision = async (event) => {
    event.preventDefault();
    if (!decision.claim) return;

    setBusy(true);
    setActionError(null);
    try {
      await claimsApi.decide(decision.claim.claimId, {
        decision: decision.value,
        reviewReason: decision.reason || null,
      });
      setNotice(`Claim #${decision.claim.claimId} was ${decision.value}.`);
      setDecision({ open: false, claim: null, value: 'approved', reason: '' });
      query.reload();
    } catch (caught) {
      setActionError(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <header className="page__header">
        <h1>Claim review queue</h1>
        <p>
          Reviewers see the finder&apos;s private verification detail to judge ownership. A claimant&apos;s private
          evidence is never returned by the API. Approving a claim marks the item returned and rejects any competing
          claims in the same transaction.
        </p>
      </header>

      <div className="toolbar">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={includeDecided}
            onChange={(event) => {
              setIncludeDecided(event.target.checked);
              setPage(1);
            }}
          />
          Show decided claims as well
        </label>
      </div>

      {notice ? (
        <div className="state state--success" role="status">
          {notice}
        </div>
      ) : null}
      <ErrorMessage error={actionError} />

      {query.loading ? <Loading label="Loading the review queue…" /> : null}
      <ErrorMessage error={query.error} onRetry={query.reload} />

      {!query.loading && !query.error && (query.data ?? []).length === 0 ? (
        <EmptyState
          title="Nothing to review"
          description="Pending claims from the whole campus appear here."
        />
      ) : null}

      {(query.data ?? []).length > 0 ? (
        <>
          <ul className="claim-list">
            {query.data.map((claim) => (
              <ClaimCard
                key={claim.claimId}
                claim={claim}
                variant="admin"
                onDecide={(target, value) => setDecision({ open: true, claim: target, value, reason: '' })}
                busy={busy}
              />
            ))}
          </ul>
          <Pagination meta={query.meta} onPageChange={setPage} />
        </>
      ) : null}

      {decision.open ? (
        <form className="card form form--dialog" onSubmit={submitDecision}>
          <h2>
            {decision.value === 'approved' ? 'Approve' : 'Reject'} claim #{decision.claim?.claimId}
          </h2>
          <p>
            {decision.value === 'approved'
              ? 'The item will be marked as returned and the claimant will be notified.'
              : 'A reason is required. The claimant will see it, and the item stays available if no other claim is active.'}
          </p>
          <Field
            id="review-reason"
            label="Review reason"
            required={decision.value === 'rejected'}
            hint="Recorded in the audit log and shown to the claimant when rejecting."
          >
            <textarea
              id="review-reason"
              rows={3}
              maxLength={1000}
              value={decision.reason}
              onChange={(event) => setDecision({ ...decision, reason: event.target.value })}
            />
          </Field>
          <div className="button-row">
            <button type="submit" className={decision.value === 'approved' ? 'button' : 'button button--danger'} disabled={busy}>
              {busy ? 'Saving…' : `Confirm ${decision.value === 'approved' ? 'approval' : 'rejection'}`}
            </button>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => setDecision({ open: false, claim: null, value: 'approved', reason: '' })}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

export default AdminClaimsPage;
