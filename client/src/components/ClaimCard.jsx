/**
 * Claim card.
 *
 * The claimant's private evidence is never sent by the API, so nothing here can
 * reveal it. The administrator variant additionally shows the item's private
 * verification hint, which reviewers need to judge ownership.
 */
import { Link } from 'react-router-dom';
import { ClaimStatusBadge, ReportTypeBadge, formatDateTime } from './Badges.jsx';

/**
 * @param {{
 *   claim: object,
 *   variant?: 'user' | 'admin',
 *   onWithdraw?: (claim: object) => void,
 *   onDecide?: (claim: object, decision: 'approved'|'rejected') => void,
 *   busy?: boolean
 * }} props
 */
export function ClaimCard({ claim, variant = 'user', onWithdraw, onDecide, busy = false }) {
  const isAdmin = variant === 'admin';

  return (
    <li className="claim-card">
      <header className="claim-card__header">
        <div>
          <h3>
            <Link to={`/items/${claim.item.itemId}`}>{claim.item.title}</Link>
          </h3>
          <p className="claim-card__subtitle">
            <ReportTypeBadge reportType={claim.item.reportType} /> {claim.item.categoryName} · submitted{' '}
            {formatDateTime(claim.createdAt)}
          </p>
        </div>
        <ClaimStatusBadge status={claim.status} />
      </header>

      <div className="claim-card__grid">
        <div>
          <h4>Claim message</h4>
          <p className="claim-card__message">{claim.claimMessage}</p>
          <p className="claim-card__note">
            {claim.hasPrivateEvidence
              ? 'The claimant also supplied private evidence. For privacy it is not returned by the API; verify ownership using the verification hint and the claim message.'
              : 'No private evidence was supplied.'}
          </p>
        </div>

        {isAdmin ? (
          <div>
            <h4>Private verification hint (administrators only)</h4>
            {claim.itemVerificationHint ? (
              <p className="claim-card__hint">{claim.itemVerificationHint}</p>
            ) : (
              <p className="claim-card__note">The report has no verification hint recorded.</p>
            )}
            <h4>Claimant</h4>
            <p>
              {claim.claimant.fullName}
              {claim.claimant.email ? ` · ${claim.claimant.email}` : ''}
            </p>
          </div>
        ) : null}

        {claim.review?.reviewedAt ? (
          <div>
            <h4>Review</h4>
            <p>
              {claim.review.reviewerName ? `Reviewed by ${claim.review.reviewerName} · ` : ''}
              {formatDateTime(claim.review.reviewedAt)}
            </p>
            {claim.review.reviewReason ? <p>Reason: {claim.review.reviewReason}</p> : null}
          </div>
        ) : null}
      </div>

      {onDecide && claim.status === 'pending' ? (
        <div className="claim-card__actions">
          <button type="button" className="button" onClick={() => onDecide(claim, 'approved')} disabled={busy}>
            Approve claim
          </button>
          <button
            type="button"
            className="button button--danger"
            onClick={() => onDecide(claim, 'rejected')}
            disabled={busy}
          >
            Reject claim
          </button>
        </div>
      ) : null}

      {onWithdraw && claim.status === 'pending' ? (
        <div className="claim-card__actions">
          <button type="button" className="button button--secondary" onClick={() => onWithdraw(claim)} disabled={busy}>
            Withdraw claim
          </button>
        </div>
      ) : null}
    </li>
  );
}

export default ClaimCard;
