/** Administrator overview with database-backed counters (no fabricated numbers). */
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { adminApi } from '../api/endpoints.js';
import { useAsyncData } from '../hooks/useAsyncData.js';
import { Loading, ErrorMessage, Field } from '../components/Feedback.jsx';
import { ItemStatusBadge, ITEM_STATUS_OPTIONS } from '../components/Badges.jsx';

/** Today's date in the browser's timezone, as YYYY-MM-DD. */
function todayLocal() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function Stat({ label, value, hint }) {
  return (
    <div className="card stat">
      <span className="stat__label">{label}</span>
      <span className="stat__value">{value}</span>
      {hint ? <span className="stat__hint">{hint}</span> : null}
    </div>
  );
}

export function AdminDashboardPage() {
  const statsQuery = useAsyncData(() => adminApi.stats(), []);
  const queueQuery = useAsyncData(() => adminApi.auditLogs({ limit: 5 }), []);
  const [dayFilter, setDayFilter] = useState({ date: todayLocal(), type: 'all' });
  const dayQuery = useAsyncData(
    () => adminApi.reportsByDay({ date: dayFilter.date, type: dayFilter.type }),
    [dayFilter.date, dayFilter.type]
  );

  if (statsQuery.loading) return <Loading label="Loading administrator statistics…" />;
  if (statsQuery.error) return <ErrorMessage error={statsQuery.error} onRetry={statsQuery.reload} />;

  const stats = statsQuery.data;
  if (!stats) return null;

  return (
    <div className="page">
      <header className="page__header">
        <h1>Administrator dashboard</h1>
        <p>
          Counters are read directly from the database, and every moderation or review action is written to the audit
          log.
        </p>
      </header>

      <section className="stat-grid">
        <Stat label="Reports" value={stats.items.total} hint={`${stats.items.lost} lost · ${stats.items.found} found`} />
        <Stat label="Returned" value={stats.items.returned} hint="Approved claims" />
        <Stat label="Candidate matches" value={stats.matches.total} hint={`${stats.matches.suggested} still suggested`} />
        <Stat label="Claims" value={stats.claims.total} hint={`${stats.claims.pending} awaiting review`} />
        <Stat label="Accounts" value={stats.users.total} hint={`${stats.users.inactive} inactive`} />
        <Stat label="PostGIS" value={stats.database.postgisVersion} hint="Spatial engine version" />
      </section>

      <div className="button-row">
        <Link className="button" to="/admin/claims">
          Review claim queue{stats.claims.pending > 0 ? ` (${stats.claims.pending})` : ''}
        </Link>
        <Link className="button button--secondary" to="/admin/items">
          Moderate reports
        </Link>
        <Link className="button button--secondary" to="/admin/audit">
          Audit log
        </Link>
        <Link className="button button--secondary" to="/admin/users">
          Accounts
        </Link>
      </div>

      <section className="card">
        <header className="card__header">
          <h2>Reports marked on a day</h2>
        </header>
        <p className="field-hint">
          Counts reports by the date they were submitted, in the reporting timezone
          {dayQuery.data?.timezone ? ` (${dayQuery.data.timezone})` : ''}.
        </p>

        <form className="filters" onSubmit={(event) => event.preventDefault()} aria-label="Filter reports by day">
          <Field id="day-date" label="Date">
            <input
              id="day-date"
              type="date"
              value={dayFilter.date}
              onChange={(event) => setDayFilter({ ...dayFilter, date: event.target.value })}
            />
          </Field>
          <Field id="day-type" label="Report type">
            <select
              id="day-type"
              value={dayFilter.type}
              onChange={(event) => setDayFilter({ ...dayFilter, type: event.target.value })}
            >
              <option value="all">All reports</option>
              <option value="lost">Lost</option>
              <option value="found">Found</option>
            </select>
          </Field>
        </form>

        {dayQuery.loading ? <Loading label="Counting…" /> : null}
        <ErrorMessage error={dayQuery.error} onRetry={dayQuery.reload} />
        {dayQuery.data ? (
          <>
            {dayFilter.type === 'all' ? (
              <div className="stat-grid">
                <Stat label="Total reports" value={dayQuery.data.total} hint={dayQuery.data.date} />
                <Stat label="Lost that day" value={dayQuery.data.lost} />
                <Stat label="Found that day" value={dayQuery.data.found} />
              </div>
            ) : (
              <div className="stat-grid">
                <Stat
                  label={dayFilter.type === 'lost' ? 'Lost reports' : 'Found reports'}
                  value={dayQuery.data.total}
                  hint={dayQuery.data.date}
                />
              </div>
            )}

            <h3 className="day-status-heading">By status</h3>
            <ul className="day-status-list">
              {ITEM_STATUS_OPTIONS.map((option) => (
                <li key={option.value}>
                  <ItemStatusBadge status={option.value} />
                  <strong>{dayQuery.data.byStatus?.[option.value] ?? 0}</strong>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>

      <section className="card">
        <header className="card__header">
          <h2>Most recent audited actions</h2>
          <Link className="button button--secondary button--small" to="/admin/audit">
            Full log
          </Link>
        </header>
        {queueQuery.loading ? <Loading /> : null}
        <ErrorMessage error={queueQuery.error} onRetry={queueQuery.reload} />
        <ul className="mini-list">
          {(queueQuery.data ?? []).map((entry) => (
            <li key={entry.auditId}>
              <code>{entry.action}</code>
              <span className="mini-list__meta">
                <span>{entry.entityType} #{entry.entityId ?? '—'}</span>
                <span>{entry.actorName ?? 'system'}</span>
                <span>{new Date(entry.createdAt).toLocaleString()}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export default AdminDashboardPage;
