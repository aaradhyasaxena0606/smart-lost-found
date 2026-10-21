/** The signed-in user's claims, with withdrawal for pending claims. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { claimsApi } from '../api/endpoints.js';
import { useAsyncData } from '../hooks/useAsyncData.js';
import ClaimCard from '../components/ClaimCard.jsx';
import Pagination from '../components/Pagination.jsx';
import { Loading, ErrorMessage, EmptyState, ConfirmDialog } from '../components/Feedback.jsx';
import { CLAIM_STATUS_OPTIONS } from '../components/Badges.jsx';

const TABS = [{ value: '', label: 'All' }, ...CLAIM_STATUS_OPTIONS];

export function MyClaimsPage() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pendingWithdraw, setPendingWithdraw] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [notice, setNotice] = useState(null);

  const query = useAsyncData(() => claimsApi.mine({ status: status || undefined, page, limit: 10 }), [status, page]);

  const handleWithdraw = async () => {
    if (!pendingWithdraw) return;
    setBusy(true);
    setActionError(null);
    try {
      await claimsApi.withdraw(pendingWithdraw.claimId);
      setNotice(`Claim #${pendingWithdraw.claimId} was withdrawn.`);
      setPendingWithdraw(null);
      query.reload();
    } catch (caught) {
      setActionError(caught);
      setPendingWithdraw(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <header className="page__header">
        <h1>My claims</h1>
        <p>
          Claims you have submitted for found items. Any private evidence you supplied is stored but never returned by
          the API.
        </p>
      </header>

      <div className="toolbar">
        <div role="tablist" aria-label="Filter claims by status" className="tabs">
          {TABS.map((tab) => (
            <button
              key={tab.value || 'all'}
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
      </div>

      {notice ? (
        <div className="state state--success" role="status">
          {notice}
        </div>
      ) : null}
      <ErrorMessage error={actionError} />

      {query.loading ? <Loading label="Loading your claims…" /> : null}
      <ErrorMessage error={query.error} onRetry={query.reload} />

      {!query.loading && !query.error && (query.data ?? []).length === 0 ? (
        <EmptyState
          title="No claims found"
          description="Browse the found reports and submit a claim when you recognise your item."
          action={
            <Link className="button" to="/items?type=found">
              Browse found items
            </Link>
          }
        />
      ) : null}

      {(query.data ?? []).length > 0 ? (
        <>
          <ul className="claim-list">
            {query.data.map((claim) => (
              <ClaimCard key={claim.claimId} claim={claim} onWithdraw={setPendingWithdraw} busy={busy} />
            ))}
          </ul>
          <Pagination meta={query.meta} onPageChange={setPage} />
        </>
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingWithdraw)}
        title="Withdraw this claim?"
        description="The claim becomes final for you and cannot be re-opened. You can submit a new claim later while the item is still available."
        confirmLabel="Withdraw claim"
        busy={busy}
        onConfirm={handleWithdraw}
        onCancel={() => setPendingWithdraw(null)}
      />
    </div>
  );
}

export default MyClaimsPage;
