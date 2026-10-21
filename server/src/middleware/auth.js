/**
 * Authentication and authorization middleware (FR-03, FR-04, FR-05, NFR-05).
 *
 * Authorization is enforced here on the server, never only in the UI. The
 * middleware re-loads the account from the database on every request so that a
 * deactivated or deleted user loses access immediately, even with a valid token.
 */
import { query } from '../config/db.js';
import { unauthorized, forbidden } from '../utils/httpError.js';
import { verifyToken } from '../utils/jwt.js';

function extractBearerToken(req) {
  const header = req.headers.authorization;
  if (!header || typeof header !== 'string') return null;
  const [scheme, token] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim();
}

async function loadUserFromToken(token) {
  let payload;
  try {
    payload = verifyToken(token);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw unauthorized('Your session has expired. Please sign in again.');
    }
    throw unauthorized('The authentication token is invalid.');
  }

  const userId = Number(payload.sub);
  if (!Number.isInteger(userId)) {
    throw unauthorized('The authentication token is invalid.');
  }

  const { rows } = await query(
    `SELECT user_id, full_name, email, role, is_active, created_at
       FROM users
      WHERE user_id = $1`,
    [userId]
  );

  if (rows.length === 0) {
    throw unauthorized('The account for this session no longer exists.');
  }
  if (!rows[0].is_active) {
    throw forbidden('This account has been deactivated.');
  }

  return {
    userId: rows[0].user_id,
    fullName: rows[0].full_name,
    email: rows[0].email,
    role: rows[0].role,
    isActive: rows[0].is_active,
    createdAt: rows[0].created_at,
  };
}

/**
 * Requires a valid token. Attaches `req.user`.
 * Rejects with 401 when the header is missing, malformed, invalid or expired.
 */
export async function authenticate(req, _res, next) {
  try {
    const token = extractBearerToken(req);
    if (!token) throw unauthorized('Authentication is required.');
    req.user = await loadUserFromToken(token);
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Attaches `req.user` when a valid token is present but never rejects.
 * Used by endpoints that show extra information to the owner (for example the
 * owner's own private verification hint on an item detail response).
 */
export async function optionalAuthenticate(req, _res, next) {
  const token = extractBearerToken(req);
  if (!token) {
    req.user = null;
    return next();
  }
  try {
    req.user = await loadUserFromToken(token);
  } catch {
    // An invalid optional token is treated as anonymous rather than an error.
    req.user = null;
  }
  return next();
}

/** FR-05: administrator-only routes. Must run after `authenticate`. */
export function requireAdmin(req, _res, next) {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== 'admin') {
    return next(forbidden('Administrator privileges are required for this action.'));
  }
  return next();
}

/**
 * Allows the request when the caller is an administrator or satisfies the
 * predicate (typically ownership). Used for report editing and match dismissal.
 *
 * @param {(req: import('express').Request) => boolean} predicate
 */
export function requireSelfOrAdmin(predicate) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (req.user.role === 'admin') return next();
    if (predicate(req)) return next();
    return next(forbidden('You may only access or modify your own resources.'));
  };
}

export default { authenticate, optionalAuthenticate, requireAdmin, requireSelfOrAdmin };
