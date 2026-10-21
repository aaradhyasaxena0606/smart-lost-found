/**
 * User dashboard: my reports, my claims, unread notifications and the best
 * candidate matches, all from real API responses.
 */
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useAsyncData } from '../hooks/useAsyncData.js';
import { itemsApi, claimsApi, matchesApi, notificationsApi, healthApi } from '../api/endpoints.js';
import { Loading, ErrorMessage, EmptyState } from '../components/Feedback.jsx';
import {
  ItemStatusBadge,
  ReportTypeBadge,
  ClaimStatusBadge,
  formatDateTime,
  formatDistance,
} from '../components/Badges.jsx';

export function DashboardPage() {
  const { user, isAdmin } = useAuth();

  const itemsQuery = useAsyncData(() => itemsApi.listMine({ limit: 5 }), []);
  const claimsQuery = useAsyncData(() => claimsApi.mine({ limit: 5 }), []);
  const matchesQuery = useAsyncData(() => matchesApi.list({ status: 'suggested', limit: 5 }), []);
  const notificationsQuery = useAsyncData(() => notificationsApi.list({ limit: 5 }), []);
  const healthQuery = useAsyncData(() => healthApi.check(), []);

  return (
    <div className="page">
      <header className="page__header">
        <h1>Welcome, {user?.fullName}</h1>
        <p>Your reports, claims and candidate matches in one place.</p>
      </header>

      <div className="stat-grid">
        <div className="card stat">
          <span className="stat__label">My reports</span>
          <span className="stat__value">{user?.stats?.itemCount ?? 0}</span>
        </div>
        <div className="card stat">
          <span className="stat__label">My claims</span>
          <span className="stat__value">{user?.stats?.claimCount ?? 0}</span>
        </div>
        <div className="card stat">
          <span className="stat__label">Unread notifications</span>
          <span className="stat__value">{user?.stats?.unreadNotificationCount ?? 0}</span>
        </div>
        <div className="card stat">
          <span className="stat__label">Suggested matches</span>
          <span className="stat__value">{matchesQuery.meta?.total ?? (matchesQuery.data?.length ?? 0)}</span>
        </div>
      </div>

      <div className="dashboard-grid">
        <section className="card">
          <header className="card__header">
            <h2>My reports</h2>
            <Link className="button button--secondary button--small" to="/my-items">
              View all
            </Link>
          </header>
          {itemsQuery.loading ? <Loading /> : null}
          <ErrorMessage error={itemsQuery.error} onRetry={itemsQuery.reload} />
          {!itemsQuery.loading && (itemsQuery.data ?? []).length === 0 ? (
            <EmptyState
              title="You have not reported anything yet"
              description="Report a lost item or one you have found to see candidate matches."
              action={
                <div className="button-row">
                  <Link className="button" to="/report/lost">
                    Report a lost item
                  </Link>
                  <Link className="button button--secondary" to="/report/found">
                    Report a found item
                  </Link>
                </div>
              }
            />
          ) : null}
          <ul className="mini-list">
            {(itemsQuery.data ?? []).map((item) => (
              <li key={item.itemId}>
                <Link to={`/items/${item.itemId}`}>{item.title}</Link>
                <span className="mini-list__meta">
                  <ReportTypeBadge reportType={item.reportType} />
                  <ItemStatusBadge status={item.status} />
                  <span>{formatDateTime(item.eventTime)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <header className="card__header">
            <h2>Best candidate matches</h2>
            <Link className="button button--secondary button--small" to="/matches">
              View all
            </Link>
          </header>
          {matchesQuery.loading ? <Loading /> : null}
          <ErrorMessage error={matchesQuery.error} onRetry={matchesQuery.reload} />
          {!matchesQuery.loading && (matchesQuery.data ?? []).length === 0 ? (
            <EmptyState
              title="No candidate matches yet"
              description="Matches appear when a report of the opposite type is similar in category, wording, time and place."
            />
          ) : null}
          <ul className="mini-list">
            {(matchesQuery.data ?? []).map((match) => (
              <li key={match.matchId}>
                <Link to={`/items/${match.foundItem.isMine ? match.lostItem.itemId : match.foundItem.itemId}`}>
                  {match.foundItem.isMine ? match.lostItem.title : match.foundItem.title}
                </Link>
                <span className="mini-list__meta">
                  <strong>{match.overallScore}%</strong>
                  {formatDistance(match.distanceMeters) ? <span>{formatDistance(match.distanceMeters)}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <header className="card__header">
            <h2>My claims</h2>
            <Link className="button button--secondary button--small" to="/claims">
              View all
            </Link>
          </header>
          {claimsQuery.loading ? <Loading /> : null}
          <ErrorMessage error={claimsQuery.error} onRetry={claimsQuery.reload} />
          {!claimsQuery.loading && (claimsQuery.data ?? []).length === 0 ? (
            <EmptyState title="No claims yet" description="When you claim a found item it appears here." />
          ) : null}
          <ul className="mini-list">
            {(claimsQuery.data ?? []).map((claim) => (
              <li key={claim.claimId}>
                <Link to={`/items/${claim.item.itemId}`}>{claim.item.title}</Link>
                <span className="mini-list__meta">
                  <ClaimStatusBadge status={claim.status} />
                  <span>{formatDateTime(claim.createdAt)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <header className="card__header">
            <h2>Notifications</h2>
            <Link className="button button--secondary button--small" to="/notifications">
              View all
            </Link>
          </header>
          {notificationsQuery.loading ? <Loading /> : null}
          <ErrorMessage error={notificationsQuery.error} onRetry={notificationsQuery.reload} />
          {!notificationsQuery.loading && (notificationsQuery.data ?? []).length === 0 ? (
            <EmptyState title="Nothing new" description="Updates about your reports and claims will appear here." />
          ) : null}
          <ul className="mini-list">
            {(notificationsQuery.data ?? []).map((notification) => (
              <li key={notification.notificationId}>
                <strong>{notification.title}</strong>
                <span className="mini-list__meta">
                  <span>{formatDateTime(notification.createdAt)}</span>
                  {notification.isRead ? null : <span className="badge badge--matched">Unread</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="card">
        <h2>System status</h2>
        {healthQuery.loading ? <Loading /> : null}
        <ErrorMessage error={healthQuery.error} />
        {healthQuery.data ? (
          <dl className="item-detail__facts">
            <div>
              <dt>API</dt>
              <dd>{healthQuery.data.status}</dd>
            </div>
            <div>
              <dt>Environment</dt>
              <dd>{healthQuery.data.environment}</dd>
            </div>
            <div>
              <dt>Database</dt>
              <dd>
                {healthQuery.data.checks?.database?.status ?? 'unknown'}
                {healthQuery.data.checks?.database?.postgisVersion
                  ? ` (PostGIS ${healthQuery.data.checks.database.postgisVersion})`
                  : ''}
              </dd>
            </div>
            <div>
              <dt>AI similarity</dt>
              <dd>{healthQuery.data.ai?.enabled ? healthQuery.data.ai.model : 'disabled'}</dd>
            </div>
          </dl>
        ) : null}
        {isAdmin ? (
          <p>
            <Link className="button button--secondary" to="/admin">
              Open the administrator dashboard
            </Link>
          </p>
        ) : null}
      </section>
    </div>
  );
}

export default DashboardPage;
