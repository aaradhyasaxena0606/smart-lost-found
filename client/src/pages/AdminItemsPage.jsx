/** Administrator report moderation (FR-05, FR-24, spec 6.4). */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../api/endpoints.js';
import { useAsyncData } from '../hooks/useAsyncData.js';
import Pagination from '../components/Pagination.jsx';
import { Loading, ErrorMessage, EmptyState, Field } from '../components/Feedback.jsx';
import { ItemStatusBadge, ReportTypeBadge, formatDateTime } from '../components/Badges.jsx';
import { ITEM_STATUS_OPTIONS } from '../components/Badges.jsx';

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

  const submitModeration = async (event) => {
    event.preventDefault();
    if (!moderation.item) return;

    setBusy(true);
    setActionError(null);
    try {
      await adminApi.moderate(moderation.item.itemId, {
        action: moderation.action,
        reason: moderation.reason || null,
      });
      setNotice(`Report #${moderation.item.itemId} was ${moderation.action}d.`);
      setModeration({ open: false, item: null, action: 'reject', reason: '' });
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
          Rejecting or closing a report notifies the reporter and writes an audit record. Transitions follow the same
          lifecycle rules as the rest of the application.
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
      <ErrorMessage error={actionError} />

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
                {query.data.map((item) => (
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
                        <button
                          type="button"
                          className="button button--secondary button--small"
                          onClick={() => setModeration({ open: true, item, action: 'reject', reason: '' })}
                          disabled={busy || Boolean(item.deletedAt)}
                        >
                          Reject
                        </button>
                        <button
                          type="button"
                          className="button button--secondary button--small"
                          onClick={() => setModeration({ open: true, item, action: 'close', reason: '' })}
                          disabled={busy || Boolean(item.deletedAt)}
                        >
                          Close
                        </button>
                        <button
                          type="button"
                          className="button button--secondary button--small"
                          onClick={() => setModeration({ open: true, item, action: 'approve', reason: '' })}
                          disabled={busy || Boolean(item.deletedAt)}
                        >
                          Reopen
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination meta={query.meta} onPageChange={setPage} />
        </>
      ) : null}

      {moderation.open ? (
        <form className="card form form--dialog" onSubmit={submitModeration}>
          <h2>
            {moderation.action === 'approve' ? 'Reopen' : moderation.action === 'close' ? 'Close' : 'Reject'} report #
            {moderation.item?.itemId}
          </h2>
          <p>{moderation.item?.title}</p>
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
              onChange={(event) => setModeration({ ...moderation, reason: event.target.value })}
            />
          </Field>
          <div className="button-row">
            <button type="submit" className="button" disabled={busy}>
              {busy ? 'Saving…' : 'Confirm'}
            </button>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => setModeration({ open: false, item: null, action: 'reject', reason: '' })}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

export default AdminItemsPage;
