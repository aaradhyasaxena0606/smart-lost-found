/**
 * Administration, moderation, audit and health tests.
 *
 * Acceptance criteria covered (PROJECT_SPEC.md sections 18 and 20):
 *   * administrator endpoints enforce role authorization
 *   * administrators can moderate reports with a recorded reason
 *   * important administrative actions create audit records
 *   * audit listings are filterable and paginated
 *   * database counters are real, not fabricated
 *   * private claim evidence is never exposed, even to administrators
 */
import './helpers/load-test-env.js';
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  api,
  API,
  resetDatabase,
  closeDatabase,
  createUserViaApi,
  createItemViaApi,
  getCategoryId,
} from './helpers/setup.js';
import { query } from '../src/config/db.js';

let owner;
let reporter;
let admin;
let phoneCategory;
let foundItem;

const auth = (token) => ({ Authorization: `Bearer ${token}` });

async function scenario() {
  await resetDatabase();
  phoneCategory = await getCategoryId('Mobile Phone');
  owner = await createUserViaApi({ fullName: 'Queue Owner' });
  reporter = await createUserViaApi({ fullName: 'Queue Reporter' });
  admin = await createUserViaApi({ fullName: 'Queue Admin', role: 'admin' });

  foundItem = await createItemViaApi(reporter.token, {
    categoryId: phoneCategory,
    reportType: 'found',
    title: 'Found a black iPhone on a bench',
    description: 'A black iPhone with a cracked screen protector found on a library bench.',
    verificationHint: 'admin-only verification hint',
  });

  await createItemViaApi(owner.token, {
    categoryId: phoneCategory,
    reportType: 'lost',
    title: 'Lost a black iPhone somewhere on campus',
    description: 'A black iPhone with a cracked screen protector lost somewhere on campus.',
  });
}

before(async () => {
  await scenario();
});

after(async () => {
  await closeDatabase();
});

describe('GET /admin/items', () => {
  test('lists reports with moderation metadata', async () => {
    const response = await api.get(`${API}/admin/items`).set(auth(admin.token));
    assert.equal(response.status, 200);
    assert.equal(response.body.data.length, 2);
    assert.equal(response.body.meta.total, 2);

    const found = response.body.data.find((item) => item.reportType === 'found');
    assert.equal(found.hasPrivateDetails, true);
    assert.equal(typeof found.matchCount, 'number');
    assert.equal(typeof found.pendingClaims, 'number');
    assert.equal(found.privateDetails, undefined, 'the queue must not leak the hint itself');
  });

  test('filters by type, status and reporter', async () => {
    const byType = await api.get(`${API}/admin/items?type=found`).set(auth(admin.token));
    assert.equal(byType.body.data.length, 1);

    const byStatus = await api.get(`${API}/admin/items?status=open`).set(auth(admin.token));
    assert.equal(byStatus.body.data.length, 2);

    const byStatusNone = await api.get(`${API}/admin/items?status=returned`).set(auth(admin.token));
    assert.equal(byStatusNone.body.data.length, 0);

    const byReporter = await api.get(`${API}/admin/items?reporterId=${reporter.user.userId}`).set(auth(admin.token));
    assert.equal(byReporter.body.data.length, 1);
    assert.equal(byReporter.body.data[0].reporter.userId, reporter.user.userId);
  });

  test('includes soft-deleted reports when asked', async () => {
    const removed = await createItemViaApi(owner.token, {
      categoryId: phoneCategory,
      title: 'A report that the administrator will delete',
      description: 'This report exists so the admin listing can include deleted rows.',
    });
    await api.delete(`${API}/items/${removed.itemId}`).set(auth(admin.token));

    const withoutDeleted = await api.get(`${API}/admin/items`).set(auth(admin.token));
    assert.equal(withoutDeleted.body.meta.total, 2);

    const withDeleted = await api.get(`${API}/admin/items?includeDeleted=true`).set(auth(admin.token));
    assert.equal(withDeleted.body.meta.total, 3);
  });

  test('is paginated', async () => {
    const response = await api.get(`${API}/admin/items?limit=1&page=1`).set(auth(admin.token));
    assert.equal(response.body.data.length, 1);
    assert.equal(response.body.meta.limit, 1);
    assert.equal(response.body.meta.hasNextPage, true);
  });

  test('requires administrator privileges (403)', async () => {
    const response = await api.get(`${API}/admin/items`).set(auth(owner.token));
    assert.equal(response.status, 403);
  });
});

describe('GET /admin/items/:itemId', () => {
  test('exposes the verification hint to administrators only', async () => {
    const asAdmin = await api.get(`${API}/admin/items/${foundItem.itemId}`).set(auth(admin.token));
    assert.equal(asAdmin.status, 200);
    assert.equal(asAdmin.body.data.privateDetails.verificationHint, 'admin-only verification hint');

    const asUser = await api.get(`${API}/admin/items/${foundItem.itemId}`).set(auth(owner.token));
    assert.equal(asUser.status, 403);
  });

  test('lists claim messages but never private evidence', async () => {
    await api.post(`${API}/items/${foundItem.itemId}/claims`).set(auth(owner.token)).send({
      claimMessage: 'This is my phone with a cracked screen protector from the library bench.',
      privateEvidence: 'serial number 12345 that must stay private',
    });

    const response = await api.get(`${API}/admin/items/${foundItem.itemId}`).set(auth(admin.token));
    assert.equal(response.status, 200);
    assert.equal(response.body.data.claims.length, 1);
    assert.ok(response.body.data.claims[0].claimMessage.length > 0);
    assert.ok(!JSON.stringify(response.body).includes('serial number 12345'));
  });

  test('returns 404 for an unknown report', async () => {
    const response = await api.get(`${API}/admin/items/999999`).set(auth(admin.token));
    assert.equal(response.status, 404);
  });
});

describe('PATCH /admin/items/:itemId/moderation', () => {
  test('rejecting records a reason, notifies the reporter and audits the action', async () => {
    await scenario();
    const response = await api
      .patch(`${API}/admin/items/${foundItem.itemId}/moderation`)
      .set(auth(admin.token))
      .send({ action: 'reject', reason: 'Duplicate of an existing report.' });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.status, 'rejected');

    const item = await query('SELECT status, closed_at FROM items WHERE item_id = $1', [foundItem.itemId]);
    assert.equal(item.rows[0].status, 'rejected');
    assert.ok(item.rows[0].closed_at);

    const notification = await query(
      `SELECT notification_type, message FROM notifications
        WHERE user_id = $1 AND related_item_id = $2`,
      [reporter.user.userId, foundItem.itemId]
    );
    assert.ok(notification.rows.some((row) => row.notification_type === 'item_moderated'));

    const audit = await query(
      `SELECT action, metadata FROM audit_logs
        WHERE entity_type = 'item' AND entity_id = $1 AND action = 'item.moderated'
        ORDER BY audit_id DESC`,
      [foundItem.itemId]
    );
    assert.equal(audit.rows.length, 1);
    assert.equal(audit.rows[0].metadata.action, 'reject');
    assert.equal(audit.rows[0].metadata.reason, 'Duplicate of an existing report.');
  });

  test('rejecting without a reason is rejected (422)', async () => {
    await scenario();
    const response = await api
      .patch(`${API}/admin/items/${foundItem.itemId}/moderation`)
      .set(auth(admin.token))
      .send({ action: 'reject' });
    assert.equal(response.status, 422);
  });

  test('closing an open report succeeds', async () => {
    await scenario();
    const response = await api
      .patch(`${API}/admin/items/${foundItem.itemId}/moderation`)
      .set(auth(admin.token))
      .send({ action: 'close', reason: 'No longer relevant.' });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.status, 'closed');
  });

  test('approving a rejected report reopens it', async () => {
    await scenario();
    await api
      .patch(`${API}/admin/items/${foundItem.itemId}/moderation`)
      .set(auth(admin.token))
      .send({ action: 'reject', reason: 'Under review.' });

    const response = await api
      .patch(`${API}/admin/items/${foundItem.itemId}/moderation`)
      .set(auth(admin.token))
      .send({ action: 'approve' });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.status, 'open');
    const item = await query('SELECT closed_at FROM items WHERE item_id = $1', [foundItem.itemId]);
    assert.equal(item.rows[0].closed_at, null);
  });

  test('an illegal moderation transition is refused (409)', async () => {
    await scenario();
    await api
      .patch(`${API}/admin/items/${foundItem.itemId}/moderation`)
      .set(auth(admin.token))
      .send({ action: 'close' });

    // closed -> rejected is not a legal transition in the item lifecycle.
    const response = await api
      .patch(`${API}/admin/items/${foundItem.itemId}/moderation`)
      .set(auth(admin.token))
      .send({ action: 'reject', reason: 'Too late.' });

    assert.equal(response.status, 409);
    assert.ok(Array.isArray(response.body.error.details.allowed));
  });

  test('an unknown action is rejected (422)', async () => {
    await scenario();
    const response = await api
      .patch(`${API}/admin/items/${foundItem.itemId}/moderation`)
      .set(auth(admin.token))
      .send({ action: 'delete-forever' });
    assert.equal(response.status, 422);
  });

  test('a deleted report cannot be moderated (400)', async () => {
    await scenario();
    await api.delete(`${API}/items/${foundItem.itemId}`).set(auth(admin.token));
    const response = await api
      .patch(`${API}/admin/items/${foundItem.itemId}/moderation`)
      .set(auth(admin.token))
      .send({ action: 'close' });
    assert.equal(response.status, 400);
  });

  test('a normal user cannot moderate (403)', async () => {
    await scenario();
    const response = await api
      .patch(`${API}/admin/items/${foundItem.itemId}/moderation`)
      .set(auth(owner.token))
      .send({ action: 'close' });
    assert.equal(response.status, 403);
  });
});

describe('GET /admin/audit-logs', () => {
  test('returns audit records with actor names', async () => {
    await scenario();
    const response = await api.get(`${API}/admin/audit-logs`).set(auth(admin.token));

    assert.equal(response.status, 200);
    assert.ok(response.body.data.length > 0);
    assert.ok(response.body.data.some((entry) => entry.action === 'item.created'));
    assert.ok(response.body.data.every((entry) => typeof entry.auditId === 'number'));
    assert.ok(!JSON.stringify(response.body).includes('password'));
  });

  test('filters by action, entity type and actor', async () => {
    const byAction = await api.get(`${API}/admin/audit-logs?action=item.created`).set(auth(admin.token));
    assert.ok(byAction.body.data.every((entry) => entry.action === 'item.created'));

    const byEntity = await api.get(`${API}/admin/audit-logs?entityType=item`).set(auth(admin.token));
    assert.ok(byEntity.body.data.every((entry) => entry.entityType === 'item'));

    const byActor = await api.get(`${API}/admin/audit-logs?actorUserId=${reporter.user.userId}`).set(auth(admin.token));
    assert.ok(byActor.body.data.every((entry) => entry.actorUserId === reporter.user.userId));

    const none = await api.get(`${API}/admin/audit-logs?action=does.not.exist`).set(auth(admin.token));
    assert.equal(none.body.data.length, 0);
    assert.equal(none.body.meta.total, 0);
  });

  test('is paginated and newest first', async () => {
    const page = await api.get(`${API}/admin/audit-logs?limit=2&page=1`).set(auth(admin.token));
    assert.equal(page.body.data.length, 2);
    assert.equal(page.body.meta.limit, 2);

    const times = page.body.data.map((entry) => new Date(entry.createdAt).getTime());
    assert.deepEqual(times, [...times].sort((a, b) => b - a));
  });

  test('validates the date filters (422)', async () => {
    const response = await api.get(`${API}/admin/audit-logs?from=not-a-date`).set(auth(admin.token));
    assert.equal(response.status, 422);
  });

  test('is forbidden for normal users (403)', async () => {
    const response = await api.get(`${API}/admin/audit-logs`).set(auth(owner.token));
    assert.equal(response.status, 403);
  });
});

describe('GET /admin/stats', () => {
  test('reports counters that match the database', async () => {
    await scenario();
    const response = await api.get(`${API}/admin/stats`).set(auth(admin.token));
    assert.equal(response.status, 200);

    const { rows } = await query(`
      SELECT (SELECT COUNT(*)::int FROM items WHERE deleted_at IS NULL) AS items,
             (SELECT COUNT(*)::int FROM users)                            AS users,
             (SELECT COUNT(*)::int FROM items WHERE report_type = 'lost')  AS lost
    `);

    assert.equal(response.body.data.items.total, rows[0].items);
    assert.equal(response.body.data.users.total, rows[0].users);
    assert.equal(response.body.data.items.lost, rows[0].lost);
    assert.ok(response.body.data.database.postgisVersion.startsWith('3.'));
  });
});

describe('GET /admin/users', () => {
  test('lists accounts without password hashes', async () => {
    const response = await api.get(`${API}/admin/users`).set(auth(admin.token));
    assert.equal(response.status, 200);
    assert.ok(response.body.data.length >= 3);
    assert.ok(!JSON.stringify(response.body).includes('password_hash'));
    assert.ok(!JSON.stringify(response.body).includes('$2'));
  });

  test('filters by role and active state', async () => {
    const admins = await api.get(`${API}/admin/users?role=admin`).set(auth(admin.token));
    assert.ok(admins.body.data.every((user) => user.role === 'admin'));

    const users = await api.get(`${API}/admin/users?role=user`).set(auth(admin.token));
    assert.ok(users.body.data.every((user) => user.role === 'user'));

    const inactive = await api.get(`${API}/admin/users?isActive=false`).set(auth(admin.token));
    assert.equal(inactive.body.data.length, 0);
  });
});

describe('GET /health', () => {
  test('reports application status without secrets', async () => {
    const response = await api.get(`${API}/health`);
    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'ok');
    assert.equal(response.body.ai.provider, 'disabled');
    assert.equal(response.body.ai.enabled, false);
    assert.ok(response.body.matching.weights);

    const body = JSON.stringify(response.body);
    assert.ok(!body.includes('postgresql://'), 'the connection string must never be exposed');
    assert.ok(!body.includes('JWT'), 'no secret names must appear');
  });

  test('reports database readiness when requested', async () => {
    const response = await api.get(`${API}/health?db=1`);
    assert.equal(response.status, 200);
    assert.equal(response.body.checks.database.status, 'ok');
    assert.ok(response.body.checks.database.postgisVersion);
    assert.ok(!JSON.stringify(response.body).includes('postgresql://'));
  });
});

describe('Consistent error responses', () => {
  test('unknown routes return the standard error envelope', async () => {
    const response = await api.get(`${API}/does-not-exist`);
    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, 'NOT_FOUND');
    assert.equal(typeof response.body.error.message, 'string');
  });

  test('malformed JSON returns 400', async () => {
    const response = await api
      .post(`${API}/auth/login`)
      .set('Content-Type', 'application/json')
      .send('{"email": "broken"');
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'MALFORMED_JSON');
  });

  test('errors never expose stack traces or SQL', async () => {
    const response = await api.get(`${API}/items/abc`);
    const body = JSON.stringify(response.body);
    assert.ok(!body.includes('at Object.'), 'no stack frames');
    assert.ok(!/SELECT|INSERT|UPDATE|FROM items/.test(body), 'no SQL fragments');
  });
});
