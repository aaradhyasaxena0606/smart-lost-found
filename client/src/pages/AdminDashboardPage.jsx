/** Administrator overview with database-backed counters (no fabricated numbers). */
import { Link } from 'react-router-dom';
import { adminApi } from '../api/endpoints.js';
import { useAsyncData } from '../hooks/useAsyncData.js';
import { Loading, ErrorMessage } from '../components/Feedback.jsx';

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
