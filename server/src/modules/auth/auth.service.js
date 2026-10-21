/**
 * Authentication service (FR-01 .. FR-04, NFR-03).
 */
import { query, withTransaction } from '../../config/db.js';
import { conflict, unauthorized } from '../../utils/httpError.js';
import { hashPassword, verifyPassword } from '../../utils/password.js';
import { signToken } from '../../utils/jwt.js';
import * as auditService from '../../services/audit.service.js';

/** Public shape of a user. Never includes password_hash. */
export function mapUser(row) {
  return {
    userId: row.user_id,
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Registers a new account (FR-01, FR-02).
 *
 * The email is normalized (trimmed + lower-cased) before insertion, which is what
 * makes the UNIQUE constraint on `users.email` reject duplicates reliably.
 */
export async function register({ fullName, email, password }) {
  const normalizedEmail = email.trim().toLowerCase();

  return withTransaction(async (client) => {
    const existing = await client.query('SELECT 1 FROM users WHERE email = $1', [normalizedEmail]);
    if (existing.rows.length > 0) {
      throw conflict('An account with this email address already exists.');
    }

    const passwordHash = await hashPassword(password);

    const { rows } = await client.query(
      `INSERT INTO users (full_name, email, password_hash, role)
       VALUES ($1, $2, $3, 'user')
       RETURNING user_id, full_name, email, role, is_active, created_at, updated_at`,
      [fullName.trim(), normalizedEmail, passwordHash]
    );

    await auditService.record(
      {
        actorUserId: rows[0].user_id,
        action: auditService.AUDIT_ACTIONS.USER_REGISTERED,
        entityType: 'user',
        entityId: rows[0].user_id,
        // No password material is ever put in metadata.
        metadata: { role: rows[0].role },
      },
      client
    );

    const user = mapUser(rows[0]);
    return { user, token: signToken({ userId: user.userId, role: user.role }) };
  });
}

/**
 * Authenticates a user (FR-03).
 *
 * A wrong password and an unknown email produce the same 401 message so the
 * endpoint cannot be used to enumerate accounts.
 */
export async function login({ email, password }) {
  const normalizedEmail = email.trim().toLowerCase();

  const { rows } = await query(
    `SELECT user_id, full_name, email, password_hash, role, is_active, created_at, updated_at
       FROM users WHERE email = $1`,
    [normalizedEmail]
  );

  const INVALID = 'The email address or password is incorrect.';
  if (rows.length === 0) throw unauthorized(INVALID);

  const record = rows[0];
  const passwordMatches = await verifyPassword(password, record.password_hash);
  if (!passwordMatches) throw unauthorized(INVALID);
  if (!record.is_active) throw unauthorized('This account has been deactivated.');

  await auditService.record({
    actorUserId: record.user_id,
    action: auditService.AUDIT_ACTIONS.USER_LOGIN,
    entityType: 'user',
    entityId: record.user_id,
    metadata: {},
  });

  const user = mapUser(record);
  return { user, token: signToken({ userId: user.userId, role: user.role }) };
}

/** Loads the authenticated user's profile (FR-03 / GET /auth/me). */
export async function getProfile(userId) {
  const { rows } = await query(
    `SELECT u.user_id, u.full_name, u.email, u.role, u.is_active, u.created_at, u.updated_at,
            (SELECT COUNT(*)::bigint FROM items i WHERE i.reporter_id = u.user_id AND i.deleted_at IS NULL) AS item_count,
            (SELECT COUNT(*)::bigint FROM claims c WHERE c.claimant_id = u.user_id) AS claim_count,
            (SELECT COUNT(*)::bigint FROM notifications n WHERE n.user_id = u.user_id AND n.is_read = FALSE) AS unread_notification_count
       FROM users u WHERE u.user_id = $1`,
    [userId]
  );
  if (rows.length === 0) throw unauthorized('The account no longer exists.');

  return {
    ...mapUser(rows[0]),
    stats: {
      itemCount: rows[0].item_count,
      claimCount: rows[0].claim_count,
      unreadNotificationCount: rows[0].unread_notification_count,
    },
  };
}

/** Allows a user to change their own password. */
export async function changePassword(userId, { currentPassword, newPassword }) {
  const { rows } = await query('SELECT password_hash FROM users WHERE user_id = $1', [userId]);
  if (rows.length === 0) throw unauthorized('The account no longer exists.');

  const matches = await verifyPassword(currentPassword, rows[0].password_hash);
  if (!matches) throw unauthorized('The current password is incorrect.');

  const newHash = await hashPassword(newPassword);
  await query('UPDATE users SET password_hash = $1 WHERE user_id = $2', [newHash, userId]);

  await auditService.record({
    actorUserId: userId,
    action: 'user.password_changed',
    entityType: 'user',
    entityId: userId,
    metadata: {},
  });

  return true;
}

export default { mapUser, register, login, getProfile, changePassword };
