/**
 * JSON Web Token issuing and verification.
 *
 * Tokens carry only the user id (`sub`) and role; the auth middleware re-loads
 * the account on every request so deactivating a user takes effect immediately.
 * Tokens are sent in the `Authorization: Bearer ...` header and never in URLs
 * (spec 16).
 */
import jwt from 'jsonwebtoken';
import config from '../config/env.js';

/**
 * @param {{userId: number, role: string}} user
 * @returns {string}
 */
export function signToken(user) {
  return jwt.sign({ sub: String(user.userId), role: user.role }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
    issuer: 'smart-lost-found',
  });
}

/**
 * Verifies a token. Throws a jsonwebtoken error (TokenExpiredError /
 * JsonWebTokenError) which the auth middleware converts to HTTP 401.
 *
 * @param {string} token
 * @returns {{sub: string, role: string, iat: number, exp: number}}
 */
export function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret, { issuer: 'smart-lost-found' });
}

export default { signToken, verifyToken };
