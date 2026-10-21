/** Administrator account listing. Password hashes are never returned by the API. */
import { useState } from 'react';
import { adminApi } from '../api/endpoints.js';
import { useAsyncData } from '../hooks/useAsyncData.js';
import Pagination from '../components/Pagination.jsx';
import { Loading, ErrorMessage, EmptyState, Field } from '../components/Feedback.jsx';
import { formatDateTime } from '../components/Badges.jsx';

export function AdminUsersPage() {
  const [filters, setFilters] = useState({ role: '', isActive: '' });
  const [page, setPage] = useState(1);

  const query = useAsyncData(
    () =>
      adminApi.users({
        page,
        limit: 20,
        role: filters.role || undefined,
        isActive: filters.isActive || undefined,
      }),
    [page, filters.role, filters.isActive]
  );

  return (
    <div className="page">
      <header className="page__header">
        <h1>Accounts</h1>
        <p>
          Registered accounts and their roles. Password hashes are stored with bcrypt and are never returned by any
          endpoint.
        </p>
      </header>

      <form className="filters" onSubmit={(event) => event.preventDefault()} aria-label="Filter accounts">
        <Field id="users-role" label="Role">
          <select
            id="users-role"
            value={filters.role}
            onChange={(event) => {
              setFilters({ ...filters, role: event.target.value });
              setPage(1);
            }}
          >
            <option value="">All roles</option>
            <option value="user">Student / user</option>
            <option value="admin">Administrator</option>
          </select>
        </Field>
        <Field id="users-active" label="Account state">
          <select
            id="users-active"
            value={filters.isActive}
            onChange={(event) => {
              setFilters({ ...filters, isActive: event.target.value });
              setPage(1);
            }}
          >
            <option value="">Any state</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </Field>
      </form>

      {query.loading ? <Loading label="Loading accounts…" /> : null}
      <ErrorMessage error={query.error} onRetry={query.reload} />

      {!query.loading && !query.error && (query.data ?? []).length === 0 ? <EmptyState title="No accounts found" /> : null}

      {(query.data ?? []).length > 0 ? (
        <>
          <div className="table-wrap">
            <table className="table">
              <caption className="visually-hidden">Registered accounts</caption>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Role</th>
                  <th scope="col">State</th>
                  <th scope="col">Registered</th>
                </tr>
              </thead>
              <tbody>
                {query.data.map((user) => (
                  <tr key={user.userId}>
                    <td>{user.userId}</td>
                    <td>{user.fullName}</td>
                    <td>{user.email}</td>
                    <td>{user.role}</td>
                    <td>{user.isActive ? 'Active' : 'Inactive'}</td>
                    <td>{formatDateTime(user.createdAt)}</td>
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

export default AdminUsersPage;
