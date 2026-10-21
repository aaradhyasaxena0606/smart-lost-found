/** Administrator audit log listing with filters (FR-24, spec 20). */
import { useState } from 'react';
import { adminApi } from '../api/endpoints.js';
import { useAsyncData } from '../hooks/useAsyncData.js';
import Pagination from '../components/Pagination.jsx';
import { Loading, ErrorMessage, EmptyState, Field } from '../components/Feedback.jsx';

export function AdminAuditPage() {
  const [filters, setFilters] = useState({ action: '', entityType: '', actorUserId: '' });
  const [page, setPage] = useState(1);

  const query = useAsyncData(
    () =>
      adminApi.auditLogs({
        page,
        limit: 20,
        action: filters.action || undefined,
        entityType: filters.entityType || undefined,
        actorUserId: filters.actorUserId || undefined,
      }),
    [page, filters.action, filters.entityType, filters.actorUserId]
  );

  const update = (key) => (event) => {
    setFilters((previous) => ({ ...previous, [key]: event.target.value }));
    setPage(1);
  };

  return (
    <div className="page">
      <header className="page__header">
        <h1>Audit log</h1>
        <p>
          Every important user and administrator action is recorded here. Records are append-only and contain no
          passwords, tokens, private evidence or verification details.
        </p>
      </header>

      <form className="filters" onSubmit={(event) => event.preventDefault()} aria-label="Filter audit records">
        <Field id="audit-action" label="Action">
          <input
            id="audit-action"
            type="text"
            value={filters.action}
            onChange={update('action')}
            placeholder="e.g. claim.approved"
            list="audit-actions"
          />
        </Field>
        <datalist id="audit-actions">
          <option value="user.registered" />
          <option value="user.login" />
          <option value="item.created" />
          <option value="item.updated" />
          <option value="item.status_changed" />
          <option value="item.moderated" />
          <option value="item.soft_deleted" />
          <option value="item.image_uploaded" />
          <option value="matches.recalculated" />
          <option value="match.dismissed" />
          <option value="claim.submitted" />
          <option value="claim.approved" />
          <option value="claim.rejected" />
          <option value="claim.withdrawn" />
        </datalist>

        <Field id="audit-entity" label="Entity type">
          <input id="audit-entity" type="text" value={filters.entityType} onChange={update('entityType')} placeholder="item, claim, match, user" />
        </Field>

        <Field id="audit-actor" label="Actor user id">
          <input id="audit-actor" type="number" min="1" value={filters.actorUserId} onChange={update('actorUserId')} placeholder="e.g. 2" />
        </Field>

        <div className="filters__actions">
          <button
            type="button"
            className="button button--secondary"
            onClick={() => {
              setFilters({ action: '', entityType: '', actorUserId: '' });
              setPage(1);
            }}
          >
            Clear filters
          </button>
        </div>
      </form>

      {query.loading ? <Loading label="Loading audit records…" /> : null}
      <ErrorMessage error={query.error} onRetry={query.reload} />

      {!query.loading && !query.error && (query.data ?? []).length === 0 ? (
        <EmptyState title="No audit records match these filters" />
      ) : null}

      {(query.data ?? []).length > 0 ? (
        <>
          <div className="table-wrap">
            <table className="table">
              <caption className="visually-hidden">Audit trail records, newest first</caption>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Actor</th>
                  <th scope="col">Action</th>
                  <th scope="col">Entity</th>
                  <th scope="col">Details</th>
                </tr>
              </thead>
              <tbody>
                {query.data.map((entry) => (
                  <tr key={entry.auditId}>
                    <td>{new Date(entry.createdAt).toLocaleString()}</td>
                    <td>{entry.actorName ?? 'system'}</td>
                    <td>
                      <code>{entry.action}</code>
                    </td>
                    <td>
                      {entry.entityType} #{entry.entityId ?? '—'}
                    </td>
                    <td>
                      <code className="audit-metadata">{JSON.stringify(entry.metadata)}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination meta={query.meta} onPageChange={setPage} />
        </>
      ) : null}
    </div>
  );
}

export default AdminAuditPage;
