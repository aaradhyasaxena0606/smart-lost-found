/**
 * In-app notification service (FR-23).
 *
 * Notifications are created inside the same transaction as the action that
 * triggered them, so a notification is never recorded for a rolled-back change
 * and never missing for a committed one.
 *
 * Messages are built only from public information: a notification must never
 * contain private verification hints or claim evidence.
 */
import { query as dbQuery } from '../config/db.js';

export const NOTIFICATION_TYPES = Object.freeze({
  ITEM_MATCHED: 'item_matched',
  CLAIM_SUBMITTED: 'claim_submitted',
  CLAIM_APPROVED: 'claim_approved',
  CLAIM_REJECTED: 'claim_rejected',
  CLAIM_WITHDRAWN: 'claim_withdrawn',
  ITEM_RETURNED: 'item_returned',
  ITEM_MODERATED: 'item_moderated',
  ITEM_CLOSED: 'item_closed',
});

/**
 * Creates one notification.
 *
 * @param {{userId: number, type: string, title: string, message: string,
 *          relatedItemId?: number|null, relatedClaimId?: number|null}} input
 * @param {import('pg').PoolClient|undefined} client
 */
export async function create(input, client) {
  const runner = client ?? { query: dbQuery };
  const { userId, type, title, message, relatedItemId = null, relatedClaimId = null } = input;

  const { rows } = await runner.query(
    `INSERT INTO notifications
       (user_id, notification_type, title, message, related_item_id, related_claim_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING notification_id, created_at`,
    [userId, type, title, message, relatedItemId, relatedClaimId]
  );

  return { notificationId: rows[0].notification_id, createdAt: rows[0].created_at };
}

/**
 * Lists a user's notifications, newest first.
 * @param {number} userId
 * @param {{page: number, limit: number, offset: number, unreadOnly?: boolean}} params
 */
export async function listForUser(userId, params) {
  const unreadOnly = Boolean(params.unreadOnly);
  const where = unreadOnly ? 'WHERE user_id = $1 AND is_read = FALSE' : 'WHERE user_id = $1';

  const totalResult = await dbQuery(`SELECT COUNT(*)::bigint AS total FROM notifications ${where}`, [userId]);
  const unreadResult = await dbQuery(
    'SELECT COUNT(*)::bigint AS unread FROM notifications WHERE user_id = $1 AND is_read = FALSE',
    [userId]
  );

  const { rows } = await dbQuery(
    `SELECT notification_id, notification_type, title, message,
            related_item_id, related_claim_id, is_read, created_at
       FROM notifications
       ${where}
      ORDER BY created_at DESC, notification_id DESC
      LIMIT $2 OFFSET $3`,
    [userId, params.limit, params.offset]
  );

  return {
    total: totalResult.rows[0].total,
    unreadCount: unreadResult.rows[0].unread,
    rows: rows.map((row) => ({
      notificationId: row.notification_id,
      type: row.notification_type,
      title: row.title,
      message: row.message,
      relatedItemId: row.related_item_id,
      relatedClaimId: row.related_claim_id,
      isRead: row.is_read,
      createdAt: row.created_at,
    })),
  };
}

/**
 * Marks one notification as read. Returns false when the notification does not
 * belong to the user, so callers can answer 404 without leaking existence.
 */
export async function markRead(userId, notificationId) {
  const { rowCount } = await dbQuery(
    'UPDATE notifications SET is_read = TRUE WHERE notification_id = $1 AND user_id = $2',
    [notificationId, userId]
  );
  return rowCount > 0;
}

/** Marks every unread notification of a user as read. */
export async function markAllRead(userId) {
  const { rowCount } = await dbQuery(
    'UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE',
    [userId]
  );
  return rowCount;
}

/** Count of unread notifications, used by the UI badge. */
export async function unreadCount(userId) {
  const { rows } = await dbQuery(
    'SELECT COUNT(*)::bigint AS unread FROM notifications WHERE user_id = $1 AND is_read = FALSE',
    [userId]
  );
  return rows[0].unread;
}

export default { create, listForUser, markRead, markAllRead, unreadCount, NOTIFICATION_TYPES };
