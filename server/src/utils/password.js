/**
 * Password hashing (NFR-03).
 *
 * bcryptjs is a maintained, pure-JavaScript bcrypt implementation: hashes are
 * salted automatically and stored in the standard `$2a$...` format. Cost factor
 * 12 is a reasonable 2020s default (tests use a lower cost for speed, see
 * tests/helpers/setup.js).
 */
import bcrypt from 'bcryptjs';
import config from '../config/env.js';

const SALT_ROUNDS = config.isTest ? 4 : 12;

/** @param {string} plainPassword */
export function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

/**
 * Constant-time comparison. Always returns a boolean and never throws for a
 * malformed stored hash.
 *
 * @param {string} plainPassword
 * @param {string} passwordHash
 */
export async function verifyPassword(plainPassword, passwordHash) {
  try {
    return await bcrypt.compare(plainPassword, passwordHash);
  } catch {
    return false;
  }
}

/**
 * Password policy: at least 8 characters with a letter and a digit.
 * Kept intentionally simple and documented; it is enforced server-side.
 */
export const PASSWORD_POLICY = Object.freeze({
  minLength: 8,
  maxLength: 128,
  description: 'at least 8 characters and must include a letter and a number',
});

export function isPasswordAcceptable(password) {
  if (typeof password !== 'string') return false;
  if (password.length < PASSWORD_POLICY.minLength || password.length > PASSWORD_POLICY.maxLength) return false;
  return /[A-Za-z]/.test(password) && /\d/.test(password);
}

export default { hashPassword, verifyPassword, isPasswordAcceptable, PASSWORD_POLICY };
