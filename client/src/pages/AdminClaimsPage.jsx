/** Administrator claim review queue with approve/reject decisions (FR-19, FR-20). */
import { useEffect, useRef, useState } from 'react';
import { claimsApi } from '../api/endpoints.js';
import { useAsyncData } from '../hooks/useAsyncData.js';
import ClaimCard from '../components/ClaimCard.jsx';
import Pagination from '../components/Pagination.jsx';
import { Loading, ErrorMessage, EmptyState, Field } from '../components/Feedback.jsx';

/**
 * Decision dialog.
 *
 * This used to be an inline form rendered after the claim list, which on a
 * one-claim queue placed it below the fold: clicking "Approve claim" appeared to
 * do nothing. A native <dialog> is always centred, traps focus and closes on Esc.
 */
function DecisionDialog({ decision, busy, error, onSubmit, onClose }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (decision.open && !dialog.open) dialog.showModal();
    if (!decision.open && dialog.open) dialog.close();
  }, [decision.open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const handleCancel = (event) => {
      event.preventDefault();
      onClose();
    };
    dialog.addEventListener('cancel', handleCancel);
    return () => dialog.removeEventListener('cancel', handleCancel);
  }, [onClose]);

  const isApprove = decision.value === 'approved';
  const claimId = decision.claim?.claimId;
  const title = decision.claim?.item?.title;

  return (
    <dialog ref={dialogRef} className="dialog" aria-labelledby="decision-title">
      <h2 id="decision-title">
        {isApprove ? 'Approve' : 'Reject'} claim #{claimId}
      </h2>
      <p>{title}</p>
      <p>
        {isApprove
          ? 'The item will be marked as returned, any competing claims will be rejected, and the claimant will be notified.'
          : 'A reason is required. The claimant sees it, and the item returns to “open” if no other claim is active.'}
      </p>

      <ErrorMessage error={error} />

      <Field
        id="review-reason"
        label="Review reason"
        required={!isApprove}
        hint="Recorded in the audit log and shown to the claimant when rejecting."
      >
        <textarea
          id="review-reason"
          rows={4}
          maxLength={1000}
          value={decision.reason}
          onChange={(event) => onSubmit({ type: 'reason', value: event.target.value })}
        />
      </Field>

      <div className="dialog__actions">
        <button type="button" className="button button--secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className={isApprove ? 'button' : 'button button--danger'}
          onClick={() => onSubmit({ type: 'confirm' })}
          disabled={busy}
        >
          {busy ? 'Saving…' : isApprove ? 'Confirm approval' : 'Confirm rejection'}
        </button>
      </div>
    </dialog>
  );
}

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

  const closeDialog = () => {
    setDecision({ open: false, claim: null, value: 'approved', reason: '' });
    setActionError(null);
  };

  const handleDialogEvent = async ({ type, value }) => {
    if (type === 'reason') {
      setDecision((previous) => ({ ...previous, reason: value }));
      return;
    }

    if (!decision.claim) return;

    // A rejection without a reason is refused by the API too; check here so the
    // dialog can show the message without a round trip.
    if (decision.value === 'rejected' && decision.reason.trim() === '') {
      setActionError(new Error('A review reason is required when rejecting a claim.'));
      return;
    }

    setBusy(true);
    setActionError(null);
    try {
      await claimsApi.decide(decision.claim.claimId, {
        decision: decision.value,
        reviewReason: decision.reason.trim() || null,
      });
      setNotice(`Claim #${decision.claim.claimId} was ${decision.value}.`);
      closeDialog();
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

      {query.loading ? <Loading label="Loading the review queue…" /> : null}
      <ErrorMessage error={query.error} onRetry={query.reload} />

      {!query.loading && !query.error && (query.data ?? []).length === 0 ? (
        <EmptyState title="Nothing to review" description="Pending claims from the whole campus appear here." />
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
                  setActionError(null);
                  setDecision({ open: true, claim: target, value, reason: '' });
                }}
                busy={busy}
              />
            ))}
          </ul>
          <Pagination meta={query.meta} onPageChange={setPage} />
        </>
      ) : null}

      <DecisionDialog
        decision={decision}
        busy={busy}
        error={actionError}
        onSubmit={handleDialogEvent}
        onClose={closeDialog}
      />
    </div>
  );
}

export default AdminClaimsPage;
