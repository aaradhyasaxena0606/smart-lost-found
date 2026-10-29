/** Administrator appeal queue: disputed, escalated and exceptional claims (FR-19, FR-20). */
import { useState } from 'react';
import { claimsApi } from '../api/endpoints.js';
import { useAsyncData } from '../hooks/useAsyncData.js';
import ClaimCard from '../components/ClaimCard.jsx';
import ClaimDecisionDialog from '../components/ClaimDecisionDialog.jsx';
import Pagination from '../components/Pagination.jsx';
import { Loading, ErrorMessage, EmptyState } from '../components/Feedback.jsx';

export function AdminClaimsPage() {
  const [escalatedOnly, setEscalatedOnly] = useState(true);
  const [includeDecided, setIncludeDecided] = useState(false);
  const [page, setPage] = useState(1);
  const [decision, setDecision] = useState({ open: false, claim: null, value: 'approved', reason: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const query = useAsyncData(
    () =>
      claimsApi.queue({
        page,
        limit: 10,
        includeDecided: includeDecided ? true : undefined,
        escalatedOnly: escalatedOnly ? true : undefined,
      }),
    [page, includeDecided, escalatedOnly]
  );

  const closeDialog = () => {
    setDecision({ open: false, claim: null, value: 'approved', reason: '' });
    setError(null);
  };

  const handleDecision = async ({ type, value }) => {
    if (type === 'reason') {
      setDecision((previous) => ({ ...previous, reason: value }));
      return;
    }
    if (!decision.claim) return;

    if (decision.value === 'rejected' && decision.reason.trim() === '') {
      setError(new Error('A review reason is required when rejecting a claim.'));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await claimsApi.decideAsAdmin(decision.claim.claimId, {
        decision: decision.value,
        reviewReason: decision.reason.trim() || null,
      });
      setNotice(`Claim #${decision.claim.claimId} was ${decision.value} as an administrator.`);
      closeDialog();
      query.reload();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <header className="page__header">
        <h1>Claim appeals and escalations</h1>
        <p>
          Finders decide routine claims. This queue shows what needs an administrator: claims disputed by the
          claimant, and claims still pending after 48 hours. Deciding here overrides the finder.
        </p>
      </header>

      <div className="toolbar">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={escalatedOnly}
            onChange={(event) => {
              setEscalatedOnly(event.target.checked);
              setPage(1);
            }}
          />
          Only disputed or overdue claims
        </label>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={includeDecided}
            onChange={(event) => {
              setIncludeDecided(event.target.checked);
              setPage(1);
            }}
          />
          Include decided claims
        </label>
      </div>

      {notice ? (
        <div className="state state--success" role="status">
          {notice}
        </div>
      ) : null}

      {query.loading ? <Loading label="Loading the appeal queue…" /> : null}
      <ErrorMessage error={query.error} onRetry={query.reload} />

      {!query.loading && !query.error && (query.data ?? []).length === 0 ? (
        <EmptyState
          title="Nothing needs your attention"
          description="No disputed or overdue claims. Uncheck the filter to see all pending claims."
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
                onDecide={(target, value) => {
                  setError(null);
                  setDecision({ open: true, claim: target, value, reason: '' });
                }}
                busy={busy}
              />
            ))}
          </ul>
          <Pagination meta={query.meta} onPageChange={setPage} />
        </>
      ) : null}

      <ClaimDecisionDialog
        decision={decision}
        busy={busy}
        error={error}
        onSubmit={handleDecision}
        onClose={closeDialog}
      />
    </div>
  );
}

export default AdminClaimsPage;
