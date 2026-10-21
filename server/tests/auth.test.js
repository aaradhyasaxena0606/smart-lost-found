/**
 * Authentication and authorization tests.
 *
 * Acceptance criteria covered (PROJECT_SPEC.md section 18):
 *   * registration succeeds for valid input; duplicate normalized email rejected
 *   * invalid credentials rejected; passwords stored as hashes
 *   * protected endpoints reject missing, invalid and expired tokens
 *   * normal users cannot access administrator endpoints
 */
import './helpers/load-test-env.js';
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { api, API, resetDatabase, closeDatabase, createUserViaApi, createUserDirect, config } from './helpers/setup.js';
import { query } from '../src/config/db.js';

before(async () => {
  await resetDatabase();
});

after(async () => {
  await closeDatabase();
});

describe('POST /auth/register', () => {
  test('creates an account and returns a usable token', async () => {
    const response = await api
      .post(`${API}/auth/register`)
      .send({ fullName: 'Ada Lovelace', email: 'ada@campus.test', password: 'Password123' });

    assert.equal(response.status, 201);
    assert.equal(response.body.data.user.email, 'ada@campus.test');
    assert.equal(response.body.data.user.role, 'user');
    assert.equal(typeof response.body.data.token, 'string');

    const me = await api.get(`${API}/auth/me`).set('Authorization', `Bearer ${response.body.data.token}`);
    assert.equal(me.status, 200);
    assert.equal(me.body.data.email, 'ada@campus.test');
  });

  test('never returns the password hash', async () => {
    const response = await api
      .post(`${API}/auth/register`)
      .send({ fullName: 'No Hash', email: 'nohash@campus.test', password: 'Password123' });

    assert.equal(response.status, 201);
    assert.equal(response.body.data.user.password_hash, undefined);
    assert.equal(response.body.data.user.passwordHash, undefined);
    assert.ok(!JSON.stringify(response.body).includes('$2'));
  });

  test('stores the password only as a bcrypt hash', async () => {
    await api
      .post(`${API}/auth/register`)
      .send({ fullName: 'Hash Check', email: 'hashcheck@campus.test', password: 'Password123' });

    const { rows } = await query('SELECT password_hash FROM users WHERE email = $1', ['hashcheck@campus.test']);
    assert.equal(rows.length, 1);
    assert.match(rows[0].password_hash, /^\$2[aby]\$\d{2}\$/);
    assert.notEqual(rows[0].password_hash, 'Password123');
  });

  test('rejects a duplicate email differing only by case (normalized)', async () => {
    const first = await api
      .post(`${API}/auth/register`)
      .send({ fullName: 'Case One', email: 'case@campus.test', password: 'Password123' });
    assert.equal(first.status, 201);

    const duplicate = await api
      .post(`${API}/auth/register`)
      .send({ fullName: 'Case Two', email: 'CASE@campus.test', password: 'Password123' });

    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.error.code, 'CONFLICT');
  });

  test('rejects invalid input with 422 and field details', async () => {
    const response = await api
      .post(`${API}/auth/register`)
      .send({ fullName: 'X', email: 'not-an-email', password: 'short' });

    assert.equal(response.status, 422);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
    assert.ok(Array.isArray(response.body.error.details));
    const fields = response.body.error.details.map((detail) => detail.field);
    assert.ok(fields.includes('email'));
    assert.ok(fields.includes('password'));
    assert.ok(fields.includes('fullName'));
  });

  test('rejects a password without a digit or a letter', async () => {
    const noDigit = await api
      .post(`${API}/auth/register`)
      .send({ fullName: 'No Digit', email: 'nodigit@campus.test', password: 'onlyletters' });
    assert.equal(noDigit.status, 422);

    const noLetter = await api
      .post(`${API}/auth/register`)
      .send({ fullName: 'No Letter', email: 'noletter@campus.test', password: '12345678' });
    assert.equal(noLetter.status, 422);
  });
});

describe('POST /auth/login', () => {
  test('returns a token for valid credentials', async () => {
    const response = await api
      .post(`${API}/auth/login`)
      .send({ email: 'ada@campus.test', password: 'Password123' });

    assert.equal(response.status, 200);
    assert.equal(typeof response.body.data.token, 'string');
  });

  test('rejects a wrong password with 401', async () => {
    const response = await api
      .post(`${API}/auth/login`)
      .send({ email: 'ada@campus.test', password: 'WrongPassword1' });
    assert.equal(response.status, 401);
  });

  test('rejects an unknown email with the same message (no user enumeration)', async () => {
    const unknown = await api
      .post(`${API}/auth/login`)
      .send({ email: 'ghost@campus.test', password: 'Password123' });
    const wrongPassword = await api
      .post(`${API}/auth/login`)
      .send({ email: 'ada@campus.test', password: 'WrongPassword1' });

    assert.equal(unknown.status, 401);
    assert.equal(unknown.body.error.message, wrongPassword.body.error.message);
  });

  test('rejects a deactivated account', async () => {
    await createUserDirect({ email: 'inactive@campus.test', isActive: false });
    const response = await api
      .post(`${API}/auth/login`)
      .send({ email: 'inactive@campus.test', password: 'Password123' });
    assert.equal(response.status, 401);
  });
});

describe('Protected endpoints', () => {
  test('rejects a missing token with 401', async () => {
    const response = await api.get(`${API}/auth/me`);
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, 'UNAUTHORIZED');
  });

  test('rejects a malformed token with 401', async () => {
    const response = await api.get(`${API}/auth/me`).set('Authorization', 'Bearer not.a.jwt');
    assert.equal(response.status, 401);
  });

  test('rejects a token signed with the wrong secret', async () => {
    const forged = jwt.sign({ sub: '1', role: 'admin' }, 'a-completely-different-secret', {
      issuer: 'smart-lost-found',
      expiresIn: '1h',
    });
    const response = await api.get(`${API}/auth/me`).set('Authorization', `Bearer ${forged}`);
    assert.equal(response.status, 401);
  });

  test('rejects an expired token with 401', async () => {
    const expired = jwt.sign({ sub: '1', role: 'user' }, config.jwtSecret, {
      issuer: 'smart-lost-found',
      expiresIn: '-10s',
    });
    const response = await api.get(`${API}/auth/me`).set('Authorization', `Bearer ${expired}`);
    assert.equal(response.status, 401);
    assert.match(response.body.error.message, /expired/i);
  });

  test('rejects a token for a user that no longer exists', async () => {
    const user = await createUserDirect({ email: 'vanishing@campus.test' });
    const login = await api
      .post(`${API}/auth/login`)
      .send({ email: user.email, password: 'Password123' });
    const token = login.body.data.token;

    await query('DELETE FROM users WHERE user_id = $1', [user.user_id]);

    const response = await api.get(`${API}/auth/me`).set('Authorization', `Bearer ${token}`);
    assert.equal(response.status, 401);
  });

  test('rejects a valid token once the account is deactivated', async () => {
    const user = await createUserDirect({ email: 'toggle@campus.test' });
    const login = await api
      .post(`${API}/auth/login`)
      .send({ email: user.email, password: 'Password123' });
    const token = login.body.data.token;

    await query('UPDATE users SET is_active = FALSE WHERE user_id = $1', [user.user_id]);

    const response = await api.get(`${API}/auth/me`).set('Authorization', `Bearer ${token}`);
    assert.equal(response.status, 403);
  });
});

describe('Role enforcement', () => {
  test('a normal user cannot reach administrator endpoints', async () => {
    const { token } = await createUserViaApi();
    const endpoints = [
      ['get', `${API}/admin/items`],
      ['get', `${API}/admin/claims`],
      ['get', `${API}/admin/audit-logs`],
      ['get', `${API}/admin/stats`],
      ['get', `${API}/admin/users`],
    ];

    for (const [method, url] of endpoints) {
      const response = await api[method](url).set('Authorization', `Bearer ${token}`);
      assert.equal(response.status, 403, `${url} should be forbidden for a normal user`);
      assert.equal(response.body.error.code, 'FORBIDDEN');
    }
  });

  test('an administrator can reach administrator endpoints', async () => {
    const { token } = await createUserViaApi({ role: 'admin' });
    const response = await api.get(`${API}/admin/stats`).set('Authorization', `Bearer ${token}`);
    assert.equal(response.status, 200);
    assert.ok(response.body.data.items);
  });

  test('GET /auth/me returns profile statistics', async () => {
    const { token } = await createUserViaApi();
    const response = await api.get(`${API}/auth/me`).set('Authorization', `Bearer ${token}`);
    assert.equal(response.status, 200);
    assert.equal(typeof response.body.data.stats.itemCount, 'number');
    assert.equal(typeof response.body.data.stats.claimCount, 'number');
  });
});

describe('POST /auth/change-password', () => {
  test('changes the password and invalidates the old one', async () => {
    const { token, email } = await createUserViaApi();

    const changed = await api
      .post(`${API}/auth/change-password`)
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'Password123', newPassword: 'NewPassword456' });
    assert.equal(changed.status, 200);

    const oldPassword = await api.post(`${API}/auth/login`).send({ email, password: 'Password123' });
    assert.equal(oldPassword.status, 401);

    const newPassword = await api.post(`${API}/auth/login`).send({ email, password: 'NewPassword456' });
    assert.equal(newPassword.status, 200);
  });

  test('rejects a wrong current password', async () => {
    const { token } = await createUserViaApi();
    const response = await api
      .post(`${API}/auth/change-password`)
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'NotMyPassword1', newPassword: 'AnotherPassword1' });
    assert.equal(response.status, 401);
  });
});
