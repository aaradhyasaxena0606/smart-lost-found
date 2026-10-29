/**
 * The finder's inbox: claims against found reports they created.
 *
 * The finder is the decision-maker for routine claims — they recorded what the
 * item looks like and they hand it over. Administrators only see appeals,
 * escalations and suspected fraud.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { claimsApi } from '../api/endpoints.js';
import { useAsyncData } from '../hooks/useAsyncData.js';
import ClaimCard from '../components/ClaimCard.jsx';
import ClaimDecisionDialog from '../components/ClaimDecisionDialog.jsx';
import Pagination from '../components/Pagination.jsx';
import { Loading, ErrorMessage, EmptyState } from '../components/Feedback.jsx';
import { CLAIM_STATUS_OPTIONS } from '../components/Badges.jsx';

const TABS = [{ value: 'pending', label: 'Awaiting your decision' }, ...CLAIM_STATUS_OPTIONS];

export function ReceivedClaimsPage() {
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const [decision, setDecision] = useState({ open: false, claim: null, value: 'approved', reason: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const query = useAsyncData(() => claimsApi.received({ status, page, limit: 10 }), [status, page]);

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
      setError(new Error('A reason is required when rejecting a claim.'));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await claimsApi.decide(decision.claim.claimId, {
        decision: decision.value,
        reviewReason: decision.reason.trim() || null,
      });
      setNotice(`Claim #${decision.claim.claimId} was ${decision.value}.`);
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
        <h1>Claims to review</h1>
        <p>
          People claiming items you reported as found. Decide using what you recorded and what they described. If the
          item is returned, approving marks the report completed. A claimant who disagrees can escalate to an
          administrator.
        </p>
      </header>

      <div className="toolbar">
        <div role="tablist" aria-label="Filter received claims" className="tabs">
          {TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={status === tab.value}
              className={status === tab.value ? 'tab tab--active' : 'tab'}
              onClick={() => {
                setStatus(tab.value);
                setPage(1);
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <Link className="button button--secondary" to="/my-items">
          My reports
        </Link>
      </div>

      {notice ? (
        <div className="state state--success" role="status">
          {notice}
        </div>
      ) : null}

      {query.loading ? <Loading label="Loading claims…" /> : null}
      <ErrorMessage error={query.error} onRetry={query.reload} />

      {!query.loading && !query.error && (query.data ?? []).length === 0 ? (
        <EmptyState
          title="Nothing to review"
          description="When someone claims an item you reported as found, it appears here."
        />
      ) : null}

      {(query.data ?? []).length > 0 ? (
        <>
          <ul className="claim-list">
            {query.data.map((claim) => (
              <ClaimCard
                key={claim.claimId}
                claim={claim}
                variant="finder"
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

export default ReceivedClaimsPage;
