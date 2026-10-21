/**
 * Item details page.
 *
 * Shows public-safe data to everyone. The owner (and administrators) additionally
 * see the private verification hint, and the owner can submit a claim, change
 * status, edit or delete the report. The API decides what is returned; this page
 * only renders what it receives.
 */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { itemsApi, claimsApi, matchesApi } from '../api/endpoints.js';
import { assetUrl } from '../api/client.js';
import { useAsyncData } from '../hooks/useAsyncData.js';
import { useAuth } from '../context/AuthContext.jsx';
import {
  ItemStatusBadge,
  ReportTypeBadge,
  MatchStatusBadge,
  formatDateTime,
  formatCoordinates,
  formatDistance,
} from '../components/Badges.jsx';
import { Loading, ErrorMessage, EmptyState, ConfirmDialog, Field, SuccessMessage } from '../components/Feedback.jsx';

const ALLOWED_TRANSITIONS = {
  open: ['matched', 'claimed', 'closed'],
  matched: ['claimed', 'returned', 'closed'],
  claimed: ['returned', 'closed', 'open'],
  returned: ['closed'],
  closed: ['open'],
  rejected: ['open', 'closed'],
};

export function ItemDetailPage() {
  const { itemId } = useParams();
  const navigate = useNavigate();
  const { user, isAuthenticated, isAdmin } = useAuth();

  const itemQuery = useAsyncData(() => itemsApi.get(itemId), [itemId]);
  const item = itemQuery.data;

  const isOwner = Boolean(item && user && item.reporter?.userId === user.userId);
  const canManage = isOwner || isAdmin;

  const matchesQuery = useAsyncData(
    () => (canManage ? matchesApi.forItem(itemId, { limit: 5 }) : Promise.resolve({ data: [] })),
    [itemId, canManage]
  );

  const [claimForm, setClaimForm] = useState({ claimMessage: '', privateEvidence: '' });
  const [claimOpen, setClaimOpen] = useState(false);
  const [claimError, setClaimError] = useState(null);
  const [claimSubmitted, setClaimSubmitted] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [statusError, setStatusError] = useState(null);
  const [statusMessage, setStatusMessage] = useState(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [imageError, setImageError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (itemQuery.loading) return <Loading label="Loading the report…" />;
  if (itemQuery.error) return <ErrorMessage error={itemQuery.error} onRetry={itemQuery.reload} />;
  if (!item) {
    return (
      <EmptyState
        title="Report not found"
        description="It may have been deleted, or the link is incorrect."
        action={
          <Link className="button" to="/items">
            Back to reports
          </Link>
        }
      />
    );
  }

  const transitions = ALLOWED_TRANSITIONS[item.status] ?? [];

  const handleClaimSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setClaimError(null);
    try {
      const { data } = await claimsApi.submit(itemId, {
        claimMessage: claimForm.claimMessage,
        privateEvidence: claimForm.privateEvidence || null,
      });
      setClaimSubmitted(data);
      setClaimOpen(false);
      itemQuery.reload();
    } catch (caught) {
      setClaimError(caught);
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (status) => {
    setBusy(true);
    setStatusError(null);
    setStatusMessage(null);
    try {
      await itemsApi.updateStatus(itemId, status);
      setStatusMessage(`Status changed to "${status}".`);
      itemQuery.reload();
    } catch (caught) {
      setStatusError(caught);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    try {
      await itemsApi.remove(itemId);
      navigate('/my-items', { replace: true });
    } catch (caught) {
      setStatusError(caught);
      setDeleteOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const handleImageUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setImageError(null);
    try {
      await itemsApi.uploadImage(itemId, file);
      itemQuery.reload();
    } catch (caught) {
      setImageError(caught);
    } finally {
      setBusy(false);
      event.target.value = '';
    }
  };

  const claimable = isAuthenticated && !isOwner && item.reportType === 'found' && ['open', 'matched', 'claimed'].includes(item.status);

  return (
    <div className="page">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/items">Reports</Link>
        <span aria-hidden="true"> / </span>
        <span>{item.title}</span>
      </nav>

      <article className="card item-detail">
        <header className="item-detail__header">
          <div className="item-detail__badges">
            <ReportTypeBadge reportType={item.reportType} />
            <ItemStatusBadge status={item.status} />
            {item.deletedAt ? <span className="badge badge--rejected">Deleted</span> : null}
          </div>
          <h1>{item.title}</h1>
          <p className="item-detail__meta">
            {item.category?.name}
            {item.colour ? ` · ${item.colour}` : ''}
            {item.brand ? ` · ${item.brand}` : ''} · reported by {item.reporter?.fullName}
          </p>
        </header>

        <p className="item-detail__description">{item.description}</p>

        <dl className="item-detail__facts">
          <div>
            <dt>{item.reportType === 'lost' ? 'Lost on' : 'Found on'}</dt>
            <dd>{formatDateTime(item.eventTime)}</dd>
          </div>
          <div>
            <dt>Location</dt>
            <dd>{item.locationName || 'Not recorded'}</dd>
          </div>
          <div>
            <dt>Coordinates</dt>
            <dd>{formatCoordinates(item.location)}</dd>
          </div>
          <div>
            <dt>Reported</dt>
            <dd>{formatDateTime(item.createdAt)}</dd>
          </div>
          {item.closedAt ? (
            <div>
              <dt>Closed</dt>
              <dd>{formatDateTime(item.closedAt)}</dd>
            </div>
          ) : null}
        </dl>

        {item.images?.length ? (
          <section className="item-detail__images">
            <h2>Photos</h2>
            <ul>
              {item.images.map((image) => (
                <li key={image.imageId}>
                  <img src={assetUrl(image.imageUrl)} alt={image.altText || `Photo of ${item.title}`} />
                  {canManage ? (
                    <button
                      type="button"
                      className="button button--secondary button--small"
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await itemsApi.deleteImage(itemId, image.imageId);
                          itemQuery.reload();
                        } catch (caught) {
                          setImageError(caught);
                        } finally {
                          setBusy(false);
                        }
                      }}
                      disabled={busy}
                    >
                      Remove photo
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {canManage ? (
          <section className="item-detail__private">
            <h2>Private verification detail</h2>
            {item.privateDetails?.verificationHint ? (
              <p className="claim-card__hint">{item.privateDetails.verificationHint}</p>
            ) : (
              <p className="claim-card__note">No verification detail was recorded for this report.</p>
            )}
            <p className="field-hint">
              This is visible only to {isOwner ? 'you and administrators' : 'administrators'} and is never included in
              public responses.
            </p>
          </section>
        ) : null}

        <section className="item-detail__matches">
          <h2>Candidate matches</h2>
          <p className="field-hint">
            Scores rank candidates by similarity. They are advisory and never prove ownership.
          </p>
          {matchesQuery.loading && canManage ? <Loading label="Loading matches…" /> : null}
          <ErrorMessage error={matchesQuery.error} />
          {canManage && !matchesQuery.loading && (matchesQuery.data ?? []).length === 0 ? (
            <p className="claim-card__note">No candidate matches yet. Recalculating can help after edits.</p>
          ) : null}
          <ul className="match-list">
            {(matchesQuery.data ?? []).map((match) => (
              <li key={match.matchId} className="match-list__row">
                <span className="match-list__score">{match.overallScore}%</span>
                <span>
                  {match.lostItem.isMine ? 'Your lost report' : 'Lost report'}: {match.lostItem.title} ↔{' '}
                  {match.foundItem.isMine ? 'your found report' : 'found report'}: {match.foundItem.title}
                </span>
                {formatDistance(match.distanceMeters) ? (
                  <span className="badge badge--muted">{formatDistance(match.distanceMeters)}</span>
                ) : null}
                <MatchStatusBadge status={match.matchStatus} />
              </li>
            ))}
          </ul>
          {canManage ? (
            <div className="button-row">
              <Link className="button button--secondary" to="/matches">
                Open the full matches view
              </Link>
              <button
                type="button"
                className="button button--secondary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await matchesApi.recalculate({ itemId: Number(itemId) });
                    matchesQuery.reload();
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Recalculate matches
              </button>
            </div>
          ) : null}
        </section>

        {canManage ? (
          <section className="item-detail__manage">
            <h2>Manage this report</h2>
            <ErrorMessage error={statusError} />
            <SuccessMessage>{statusMessage}</SuccessMessage>
            <ErrorMessage error={imageError} />

            {transitions.length > 0 ? (
              <div className="button-row">
                <span id="status-change-label">Change status:</span>
                {transitions.map((status) => (
                  <button
                    key={status}
                    type="button"
                    className="button button--secondary button--small"
                    onClick={() => handleStatusChange(status)}
                    disabled={busy}
                  >
                    {status}
                  </button>
                ))}
              </div>
            ) : (
              <p className="claim-card__note">No further status changes are available for this report.</p>
            )}

            <div className="button-row">
              <Field id="item-add-photo" label="Add another photo">
                <input id="item-add-photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={handleImageUpload} />
              </Field>
            </div>

            <button type="button" className="button button--danger" onClick={() => setDeleteOpen(true)} disabled={busy}>
              Delete this report
            </button>
            <p className="field-hint">
              Deleting hides the report from every listing while keeping its history for audits. Reports with an active
              claim cannot be deleted.
            </p>
          </section>
        ) : null}

        {isAuthenticated && !isOwner && item.reportType === 'found' ? (
          <section className="item-detail__claim">
            <h2>Think this is yours?</h2>
            {claimSubmitted ? (
              <SuccessMessage>
                Your claim (reference #{claimSubmitted.claimId}) was submitted and is awaiting administrator review.
                You can follow it under <Link to="/claims">My claims</Link>.
              </SuccessMessage>
            ) : null}

            {!claimable && !claimSubmitted ? (
              <p className="claim-card__note">
                This report cannot receive new claims while its status is “{item.status}”.
              </p>
            ) : null}

            {claimable && !claimSubmitted ? (
              claimOpen ? (
                <form className="form" onSubmit={handleClaimSubmit} noValidate>
                  <ErrorMessage error={claimError} />
                  <Field
                    id="claim-message"
                    label="Why is this yours?"
                    required
                    hint="Describe details from memory rather than copying the description. Administrators compare this with the finder's private verification detail."
                    error={claimError?.fieldErrors?.claimMessage}
                  >
                    <textarea
                      id="claim-message"
                      required
                      minLength={10}
                      maxLength={2000}
                      rows={5}
                      value={claimForm.claimMessage}
                      onChange={(event) => setClaimForm({ ...claimForm, claimMessage: event.target.value })}
                    />
                  </Field>
                  <Field
                    id="claim-evidence"
                    label="Private evidence (optional)"
                    hint="For privacy this is stored but never returned by the API. Provide a serial number, an IMEI or a short description of proof."
                    error={claimError?.fieldErrors?.privateEvidence}
                  >
                    <textarea
                      id="claim-evidence"
                      rows={3}
                      maxLength={2000}
                      value={claimForm.privateEvidence}
                      onChange={(event) => setClaimForm({ ...claimForm, privateEvidence: event.target.value })}
                    />
                  </Field>
                  <div className="button-row">
                    <button type="submit" className="button" disabled={submitting}>
                      {submitting ? 'Submitting…' : 'Submit claim'}
                    </button>
                    <button type="button" className="button button--secondary" onClick={() => setClaimOpen(false)}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <button type="button" className="button" onClick={() => setClaimOpen(true)}>
                  Submit a claim
                </button>
              )
            ) : null}
          </section>
        ) : null}

        {!isAuthenticated ? (
          <p className="notice">
            <Link to="/login">Sign in</Link> to submit a claim or report a matching item.
          </p>
        ) : null}
      </article>

      <ConfirmDialog
        open={deleteOpen}
        title="Delete this report?"
        description="It will be hidden from all public listings. The record and its history are kept for auditing."
        confirmLabel="Delete report"
        busy={busy}
        onConfirm={handleDelete}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
}

export default ItemDetailPage;
