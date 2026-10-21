/** Candidate matches relevant to the signed-in user (FR-13, FR-14, FR-17). */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { matchesApi } from '../api/endpoints.js';
import { useAsyncData } from '../hooks/useAsyncData.js';
import MatchCard from '../components/MatchCard.jsx';
import Pagination from '../components/Pagination.jsx';
import { Loading, ErrorMessage, EmptyState, ConfirmDialog } from '../components/Feedback.jsx';
import { MATCH_STATUS_OPTIONS } from '../components/Badges.jsx';

const STATUS_TABS = [{ value: '', label: 'All statuses' }, ...MATCH_STATUS_OPTIONS];

export function MatchesPage() {
  const [status, setStatus] = useState('suggested');
  const [page, setPage] = useState(1);
  const [pendingDismiss, setPendingDismiss] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const query = useAsyncData(() => matchesApi.list({ status: status || undefined, page, limit: 10 }), [status, page]);

  const handleDismiss = async () => {
    if (!pendingDismiss) return;
    setBusy(true);
    setActionError(null);
    try {
      await matchesApi.dismiss(pendingDismiss.matchId);
      setNotice(`Suggestion #${pendingDismiss.matchId} was dismissed. Recalculating will not bring it back.`);
      setPendingDismiss(null);
      query.reload();
    } catch (caught) {
      setActionError(caught);
      setPendingDismiss(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <header className="page__header">
        <h1>Candidate matches</h1>
        <p>
          These pairs are ranked by an explainable score that combines category, wording, time and distance. A score is
          a suggestion only: an administrator verifies ownership before an item is released.
        </p>
      </header>

      <div className="toolbar">
        <div role="tablist" aria-label="Filter matches by status" className="tabs">
          {STATUS_TABS.map((tab) => (
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

        <button
          type="button"
          className="button button--secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setNotice(null);
            setActionError(null);
            try {
              const { data } = await matchesApi.recalculate({});
              setNotice(
                `Recalculated ${data.itemsProcessed} report(s): ${data.created} new, ${data.updated} updated, ${data.removed} withdrawn, ${data.scanned} candidate pairs examined.`
              );
              query.reload();
            } catch (caught) {
              setActionError(caught);
            } finally {
              setBusy(false);
            }
          }}
        >
          Recalculate my matches
        </button>
      </div>

      {notice ? (
        <div className="state state--success" role="status">
          {notice}
        </div>
      ) : null}
      <ErrorMessage error={actionError} />

      {query.loading ? <Loading label="Loading matches…" /> : null}
      <ErrorMessage error={query.error} onRetry={query.reload} />

      {!query.loading && !query.error && (query.data ?? []).length === 0 ? (
        <EmptyState
          title="No matches to show"
          description="Report a lost or found item and we will look for compatible reports of the opposite type."
          action={
            <div className="button-row">
              <Link className="button" to="/report/lost">
                Report a lost item
              </Link>
              <Link className="button button--secondary" to="/report/found">
                Report a found item
              </Link>
            </div>
          }
        />
      ) : null}

      {(query.data ?? []).length > 0 ? (
        <>
          <ul className="match-list match-list--cards">
            {query.data.map((match) => (
              <MatchCard key={match.matchId} match={match} onDismiss={setPendingDismiss} busy={busy} />
            ))}
          </ul>
          <Pagination meta={query.meta} onPageChange={setPage} />
        </>
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingDismiss)}
        title="Dismiss this suggestion?"
        description="The pair will be marked as dismissed and a recalculation will not resurrect it. You can still view it under the Dismissed tab."
        confirmLabel="Dismiss suggestion"
        busy={busy}
        onConfirm={handleDismiss}
        onCancel={() => setPendingDismiss(null)}
      />
    </div>
  );
}

export default MatchesPage;
