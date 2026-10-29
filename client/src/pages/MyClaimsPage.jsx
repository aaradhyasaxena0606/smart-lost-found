/** The signed-in user's claims, with withdrawal and appeal. */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { claimsApi } from '../api/endpoints.js';
import { useAsyncData } from '../hooks/useAsyncData.js';
import ClaimCard from '../components/ClaimCard.jsx';
import Pagination from '../components/Pagination.jsx';
import { Loading, ErrorMessage, EmptyState, ConfirmDialog, Field } from '../components/Feedback.jsx';
import { CLAIM_STATUS_OPTIONS } from '../components/Badges.jsx';

const TABS = [{ value: '', label: 'All' }, ...CLAIM_STATUS_OPTIONS];

/** Modal for contesting a rejection. */
function DisputeDialog({ dispute, busy, error, onChange, onConfirm, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (dispute.open && !dialog.open) dialog.showModal();
    if (!dispute.open && dialog.open) dialog.close();
  }, [dispute.open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    const handleCancel = (event) => {
      event.preventDefault();
      onClose();
    };
    dialog.addEventListener('cancel', handleCancel);
    return () => dialog.removeEventListener('cancel', handleCancel);
  }, [onClose]);

  return (
    <dialog ref={ref} className="dialog" aria-labelledby="dispute-title">
      <h2 id="dispute-title">Dispute the decision on claim #{dispute.claim?.claimId}</h2>
      <p>
        An administrator will review the claim again and their decision is final. Explain why the rejection was wrong.
      </p>
      <ErrorMessage error={error} />
      <Field id="dispute-reason" label="Why should this be reviewed?" required hint="At least 10 characters.">
        <textarea
          id="dispute-reason"
          rows={4}
          maxLength={1000}
          value={dispute.reason}
          onChange={(event) => onChange(event.target.value)}
        />
      </Field>
      <div className="dialog__actions">
        <button type="button" className="button button--secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="button" onClick={onConfirm} disabled={busy}>
          {busy ? 'Sending…' : 'Send to administrator'}
        </button>
      </div>
    </dialog>
  );
}

export function MyClaimsPage() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pendingWithdraw, setPendingWithdraw] = useState(null);
  const [dispute, setDispute] = useState({ open: false, claim: null, reason: '' });
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

  const closeDispute = () => {
    setDispute({ open: false, claim: null, reason: '' });
    setActionError(null);
  };

  const submitDispute = async () => {
    if (!dispute.claim) return;
    if (dispute.reason.trim().length < 10) {
      setActionError(new Error('Please explain why the decision should be reviewed (at least 10 characters).'));
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await claimsApi.dispute(dispute.claim.claimId, dispute.reason.trim());
      setNotice(`Claim #${dispute.claim.claimId} was sent to an administrator for review.`);
      closeDispute();
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
        <h1>My claims</h1>
        <p>
          Claims you have submitted for found items. The finder decides; if they reject it, you can dispute the
          decision and an administrator will review it.
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
          description="When the engine suggests a found item for one of your lost reports, you can claim it from there."
          action={
            <Link className="button" to="/matches">
              Review my matches
            </Link>
          }
        />
      ) : null}

      {(query.data ?? []).length > 0 ? (
        <>
          <ul className="claim-list">
            {query.data.map((claim) => (
              <ClaimCard
                key={claim.claimId}
                claim={claim}
                onWithdraw={setPendingWithdraw}
                onDispute={(target) => {
                  setActionError(null);
                  setDispute({ open: true, claim: target, reason: '' });
                }}
                busy={busy}
              />
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

      <DisputeDialog
        dispute={dispute}
        busy={busy}
        error={actionError}
        onChange={(reason) => setDispute((previous) => ({ ...previous, reason }))}
        onConfirm={submitDispute}
        onClose={closeDispute}
      />
    </div>
  );
}

export default MyClaimsPage;
