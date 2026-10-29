/** Administrator report moderation (FR-05, FR-24, spec 6.4). */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../api/endpoints.js';
import { useAsyncData } from '../hooks/useAsyncData.js';
import Pagination from '../components/Pagination.jsx';
import { Loading, ErrorMessage, EmptyState, Field } from '../components/Feedback.jsx';
import { ItemStatusBadge, ReportTypeBadge, formatDateTime, ITEM_STATUS_OPTIONS } from '../components/Badges.jsx';

/**
 * Which moderation actions make sense for a given status.
 *
 * Offering every button on every row looked tidy but produced avoidable 409s:
 * "Reopen" on an already-open report, "Reject" on a returned one. The mapping
 * mirrors the item lifecycle enforced by the API and by the database trigger.
 * The API action for reopening is `approve`.
 */
const MODERATION_ACTIONS = {
  open: ['reject', 'close'],
  matched: ['reject', 'close'],
  claimed: ['reject', 'close'],
  returned: ['close'],
  closed: ['reopen'],
  rejected: ['reopen', 'close'],
};

const ACTION_LABEL = { reject: 'Reject', close: 'Close', reopen: 'Reopen' };
const ACTION_VALUE = { reject: 'reject', close: 'close', reopen: 'approve' };
const ACTION_VERB = { reject: 'rejected', close: 'closed', approve: 'reopened' };

/** Modal form — same reasoning as the claim decision dialog: never below the fold. */
function ModerationDialog({ moderation, busy, error, onChange, onConfirm, onClose }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (moderation.open && !dialog.open) dialog.showModal();
    if (!moderation.open && dialog.open) dialog.close();
  }, [moderation.open]);

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

  const verb = ACTION_LABEL[moderation.action === 'approve' ? 'reopen' : moderation.action] ?? 'Moderate';

  return (
    <dialog ref={dialogRef} className="dialog" aria-labelledby="moderation-title">
      <h2 id="moderation-title">
        {verb} report #{moderation.item?.itemId}
      </h2>
      <p>{moderation.item?.title}</p>
      <p>
        {moderation.action === 'reject'
          ? 'The reporter sees your reason and the report is closed as rejected.'
          : moderation.action === 'close'
            ? 'The report is closed. The reporter is notified.'
            : 'The report is reopened and becomes visible in public listings again.'}
      </p>

      <ErrorMessage error={error} />

      <Field
        id="moderation-reason"
        label="Reason"
        required={moderation.action === 'reject'}
        hint="Recorded in the audit log and included in the reporter's notification."
      >
        <textarea
          id="moderation-reason"
          rows={3}
          maxLength={1000}
          value={moderation.reason}
          onChange={(event) => onChange(event.target.value)}
        />
      </Field>

      <div className="dialog__actions">
        <button type="button" className="button button--secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="button" onClick={onConfirm} disabled={busy}>
          {busy ? 'Saving…' : 'Confirm'}
        </button>
      </div>
    </dialog>
  );
}

export function AdminItemsPage() {
  const [filters, setFilters] = useState({ type: '', status: '', includeDeleted: false });
  const [page, setPage] = useState(1);
  const [moderation, setModeration] = useState({ open: false, item: null, action: 'reject', reason: '' });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [notice, setNotice] = useState(null);

  const query = useAsyncData(
    () =>
      adminApi.items({
        page,
        limit: 10,
        type: filters.type || undefined,
        status: filters.status || undefined,
        includeDeleted: filters.includeDeleted ? true : undefined,
      }),
    [page, filters.type, filters.status, filters.includeDeleted]
  );

  const closeDialog = () => {
    setModeration({ open: false, item: null, action: 'reject', reason: '' });
    setActionError(null);
  };

  const submitModeration = async () => {
    if (!moderation.item) return;

    if (moderation.action === 'reject' && moderation.reason.trim() === '') {
      setActionError(new Error('A reason is required when rejecting a report.'));
      return;
    }

    setBusy(true);
    setActionError(null);
    try {
      await adminApi.moderate(moderation.item.itemId, {
        action: moderation.action,
        reason: moderation.reason.trim() || null,
      });
      setNotice(`Report #${moderation.item.itemId} was ${ACTION_VERB[moderation.action] ?? moderation.action}.`);
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
        <h1>Moderate reports</h1>
        <p>
          Rejecting or closing a report notifies the reporter and writes an audit record. Only actions valid for the
          report&apos;s current status are offered.
        </p>
      </header>

      <form className="filters" onSubmit={(event) => event.preventDefault()} aria-label="Filter reports">
        <Field id="admin-filter-type" label="Report type">
          <select
            id="admin-filter-type"
            value={filters.type}
            onChange={(event) => {
              setFilters({ ...filters, type: event.target.value });
              setPage(1);
            }}
          >
            <option value="">All types</option>
            <option value="lost">Lost</option>
            <option value="found">Found</option>
          </select>
        </Field>
        <Field id="admin-filter-status" label="Status">
          <select
            id="admin-filter-status"
            value={filters.status}
            onChange={(event) => {
              setFilters({ ...filters, status: event.target.value });
              setPage(1);
            }}
          >
            <option value="">Any status</option>
            {ITEM_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <div className="filters__actions">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={filters.includeDeleted}
              onChange={(event) => {
                setFilters({ ...filters, includeDeleted: event.target.checked });
                setPage(1);
              }}
            />
            Include deleted
          </label>
        </div>
      </form>

      {notice ? (
        <div className="state state--success" role="status">
          {notice}
        </div>
      ) : null}

      {query.loading ? <Loading label="Loading reports…" /> : null}
      <ErrorMessage error={query.error} onRetry={query.reload} />

      {!query.loading && !query.error && (query.data ?? []).length === 0 ? (
        <EmptyState title="No reports match these filters" />
      ) : null}

      {(query.data ?? []).length > 0 ? (
        <>
          <div className="table-wrap">
            <table className="table">
              <caption className="visually-hidden">Reports awaiting or having received moderation</caption>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Report</th>
                  <th scope="col">Reporter</th>
                  <th scope="col">Status</th>
                  <th scope="col">Signals</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {query.data.map((item) => {
                  const actions = item.deletedAt ? [] : (MODERATION_ACTIONS[item.status] ?? []);
                  return (
                    <tr key={item.itemId}>
                      <td>{item.itemId}</td>
                      <td>
                        <Link to={`/items/${item.itemId}`}>{item.title}</Link>
                        <div className="table__meta">
                          <ReportTypeBadge reportType={item.reportType} /> {item.category?.name} ·{' '}
                          {formatDateTime(item.eventTime)}
                        </div>
                      </td>
                      <td>{item.reporter?.fullName}</td>
                      <td>
                        <ItemStatusBadge status={item.status} />
                        {item.deletedAt ? <div className="table__meta">deleted</div> : null}
                      </td>
                      <td className="table__meta">
                        {item.matchCount} matches
                        <br />
                        {item.pendingClaims} pending claim(s)
                        <br />
                        {item.hasPrivateDetails ? 'has verification hint' : 'no verification hint'}
                      </td>
                      <td>
                        <div className="button-row button-row--tight">
                          {actions.map((action) => (
                            <button
                              key={action}
                              type="button"
                              className="button button--secondary button--small"
                              onClick={() => {
                                setActionError(null);
                                setModeration({
                                  open: true,
                                  item,
                                  action: ACTION_VALUE[action],
                                  reason: '',
                                });
                              }}
                              disabled={busy}
                            >
                              {ACTION_LABEL[action]}
                            </button>
                          ))}
                          {actions.length === 0 ? <span className="table__meta">—</span> : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination meta={query.meta} onPageChange={setPage} />
        </>
      ) : null}

      <ModerationDialog
        moderation={moderation}
        busy={busy}
        error={actionError}
        onChange={(reason) => setModeration((previous) => ({ ...previous, reason }))}
        onConfirm={submitModeration}
        onClose={closeDialog}
      />
    </div>
  );
}

export default AdminItemsPage;
