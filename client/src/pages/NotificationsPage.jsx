/** In-app notifications (FR-23). */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { notificationsApi } from '../api/endpoints.js';
import { useAsyncData } from '../hooks/useAsyncData.js';
import Pagination from '../components/Pagination.jsx';
import { Loading, ErrorMessage, EmptyState } from '../components/Feedback.jsx';
import { formatDateTime } from '../components/Badges.jsx';

export function NotificationsPage() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const query = useAsyncData(
    () => notificationsApi.list({ page, limit: 15, unreadOnly: unreadOnly ? true : undefined }),
    [page, unreadOnly]
  );

  const markRead = async (notificationId) => {
    setBusy(true);
    setActionError(null);
    try {
      await notificationsApi.markRead(notificationId);
      query.reload();
    } catch (caught) {
      setActionError(caught);
    } finally {
      setBusy(false);
    }
  };

  const markAll = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await notificationsApi.markAllRead();
      query.reload();
    } catch (caught) {
      setActionError(caught);
    } finally {
      setBusy(false);
    }
  };

  const unread = query.meta?.unreadCount ?? 0;

  return (
    <div className="page page--narrow">
      <header className="page__header">
        <h1>Notifications</h1>
        <p>{unread > 0 ? `You have ${unread} unread notification${unread === 1 ? '' : 's'}.` : 'You are up to date.'}</p>
      </header>

      <div className="toolbar">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(event) => {
              setUnreadOnly(event.target.checked);
              setPage(1);
            }}
          />
          Show unread only
        </label>
        <button type="button" className="button button--secondary" onClick={markAll} disabled={busy || unread === 0}>
          Mark all as read
        </button>
      </div>

      <ErrorMessage error={actionError} />

      {query.loading ? <Loading label="Loading notifications…" /> : null}
      <ErrorMessage error={query.error} onRetry={query.reload} />

      {!query.loading && !query.error && (query.data ?? []).length === 0 ? (
        <EmptyState
          title="No notifications"
          description="Matches, claims and moderation updates about your reports appear here."
        />
      ) : null}

      {(query.data ?? []).length > 0 ? (
        <>
          <ul className="notification-list">
            {query.data.map((notification) => (
              <li key={notification.notificationId} className={notification.isRead ? 'notification' : 'notification notification--unread'}>
                <div>
                  <h2>{notification.title}</h2>
                  <p>{notification.message}</p>
                  <p className="notification__meta">
                    {formatDateTime(notification.createdAt)}
                    {notification.relatedItemId ? (
                      <>
                        {' · '}
                        <Link to={`/items/${notification.relatedItemId}`}>Open the report</Link>
                      </>
                    ) : null}
                    {notification.relatedClaimId ? (
                      <>
                        {' · '}
                        <Link to="/claims">View my claims</Link>
                      </>
                    ) : null}
                  </p>
                </div>
                {notification.isRead ? (
                  <span className="badge badge--muted">Read</span>
                ) : (
                  <button
                    type="button"
                    className="button button--secondary button--small"
                    onClick={() => markRead(notification.notificationId)}
                    disabled={busy}
                  >
                    Mark as read
                  </button>
                )}
              </li>
            ))}
          </ul>
          <Pagination meta={query.meta} onPageChange={setPage} />
        </>
      ) : null}
    </div>
  );
}

export default NotificationsPage;
