/**
 * Shared decision dialog for claim review.
 *
 * Used by both the finder's inbox (routine decisions) and the administrator's
 * appeal queue. It is a native <dialog> so it is always centred and focus-trapped
 * — an inline form below a long list previously landed off-screen and made the
 * buttons look broken.
 */
import { useEffect, useRef } from 'react';
import { Field, ErrorMessage } from './Feedback.jsx';

export function ClaimDecisionDialog({ decision, busy, error, onSubmit, onClose }) {
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

  return (
    <dialog ref={dialogRef} className="dialog dialog--wide" aria-labelledby="decision-title">
      <h2 id="decision-title">
        {isApprove ? 'Approve' : 'Reject'} claim #{decision.claim?.claimId}
      </h2>
      <p>{decision.claim?.item?.title}</p>

      {/* The two descriptions existed before either party saw the other's. */}
      <div className="compare">
        <div>
          <h4>The finder recorded</h4>
          <p className="claim-card__hint">
            {decision.claim?.itemVerificationHint ||
              decision.claim?.item?.verificationHint ||
              'No verification detail was recorded on the found report.'}
          </p>
        </div>
        <div>
          <h4>The owner wrote on their lost report</h4>
          <p className="claim-card__hint">
            {decision.claim?.claimantLostReport?.verificationHint ||
              'No verification detail was recorded on their lost report.'}
          </p>
        </div>
      </div>

      <div className="compare compare--single">
        <div>
          <h4>Why they say it is theirs</h4>
          <p className="claim-card__message">{decision.claim?.claimMessage}</p>
        </div>
      </div>

      <p>
        {isApprove
          ? 'Approving marks the item returned and rejects any competing claims. Tell the claimant where and when to collect it.'
          : 'A reason is required. The claimant can dispute your decision, and an administrator will then decide.'}
      </p>

      <ErrorMessage error={error} />

      <Field
        id="review-reason"
        label={isApprove ? 'Collection instructions (optional)' : 'Reason for rejection'}
        required={!isApprove}
        hint={
          isApprove
            ? 'Where, when and how the claimant should collect the item. Included in their approval notification.'
            : 'Recorded in the audit log and shown to the claimant.'
        }
      >
        <textarea
          id="review-reason"
          rows={3}
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

export default ClaimDecisionDialog;
