/**
 * Claim workflow tests.
 *
 * Acceptance criteria covered (PROJECT_SPEC.md section 18 "Claims and Audit"):
 *   * valid claims can be submitted and invalid or unauthorized claims rejected
 *   * only authorized administrators can approve/reject claims
 *   * claim review and related item status changes are atomic
 *   * duplicate or concurrent requests do not create inconsistent state
 *   * required notifications and audit records are created
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

let finder;
let claimant;
let otherClaimant;
let admin;
let phoneCategory;

const auth = (token) => ({ Authorization: `Bearer ${token}` });

/** Rebuilds a clean a-scenario world before each case. */
async function scenario() {
  await resetDatabase();
  phoneCategory = await getCategoryId('Mobile Phone');
  finder = await createUserViaApi({ fullName: 'Finder Person' });
  claimant = await createUserViaApi({ fullName: 'Claimant Person' });
  otherClaimant = await createUserViaApi({ fullName: 'Rival Claimant' });
  admin = await createUserViaApi({ fullName: 'Review Admin', role: 'admin' });

  const found = await createItemViaApi(finder.token, {
    categoryId: phoneCategory,
    reportType: 'found',
    title: 'Found black iPhone on a library bench',
    description: 'A black iPhone with a cracked screen protector found on a bench outside the library.',
    colour: 'black',
    brand: 'Apple',
    verificationHint: 'cat sticker on the back and a crack in the top-left corner',
  });

  return { found };
}

function claimPayload(overrides = {}) {
  return {
    claimMessage: 'This is my phone: the screen protector is cracked in the top-left and there is a cat sticker.',
    privateEvidence: 'IMEI ends 4471 — evidence that must never be returned by the API.',
    ...overrides,
  };
}

before(async () => {
  await resetDatabase();
});

after(async () => {
  await closeDatabase();
});

describe('POST /items/:itemId/claims', () => {
  test('submits a claim and moves the item to "claimed"', async () => {
    const { found } = await scenario();

    const response = await api.post(`${API}/items/${found.itemId}/claims`).set(auth(claimant.token)).send(claimPayload());

    assert.equal(response.status, 201);
    assert.equal(response.body.data.status, 'pending');
    assert.equal(response.body.data.claimant.userId, claimant.user.userId);
    assert.equal(response.body.data.item.itemId, found.itemId);
    assert.equal(response.body.data.hasPrivateEvidence, true);

    const item = await query('SELECT status FROM items WHERE item_id = $1', [found.itemId]);
    assert.equal(item.rows[0].status, 'claimed');
  });

  test('never returns private evidence', async () => {
    const { found } = await scenario();
    const response = await api.post(`${API}/items/${found.itemId}/claims`).set(auth(claimant.token)).send(claimPayload());

    assert.equal(response.status, 201);
    assert.equal(response.body.data.privateEvidence, undefined);
    assert.ok(!JSON.stringify(response.body).includes('IMEI ends 4471'));
  });

  test('requires authentication (401)', async () => {
    const { found } = await scenario();
    const response = await api.post(`${API}/items/${found.itemId}/claims`).send(claimPayload());
    assert.equal(response.status, 401);
  });

  test('rejects a claim on a lost-item report (400)', async () => {
    await scenario();
    const lost = await createItemViaApi(claimant.token, { categoryId: phoneCategory, reportType: 'lost' });
    const response = await api.post(`${API}/items/${lost.itemId}/claims`).set(auth(otherClaimant.token)).send(claimPayload());

    assert.equal(response.status, 400);
    assert.match(response.body.error.message, /found-item/);
  });

  test('the finder cannot claim their own found report (409)', async () => {
    const { found } = await scenario();
    const response = await api.post(`${API}/items/${found.itemId}/claims`).set(auth(finder.token)).send(claimPayload());
    assert.equal(response.status, 409);
  });

  test('rejects a duplicate active claim by the same user (409)', async () => {
    const { found } = await scenario();
    const first = await api.post(`${API}/items/${found.itemId}/claims`).set(auth(claimant.token)).send(claimPayload());
    assert.equal(first.status, 201);

    const second = await api.post(`${API}/items/${found.itemId}/claims`).set(auth(claimant.token)).send(claimPayload());
    assert.equal(second.status, 409);
    assert.equal(second.body.error.details.claimId, first.body.data.claimId);
  });

  test('a different user may also claim the same item', async () => {
    const { found } = await scenario();
    const first = await api.post(`${API}/items/${found.itemId}/claims`).set(auth(claimant.token)).send(claimPayload());
    const second = await api.post(`${API}/items/${found.itemId}/claims`).set(auth(otherClaimant.token)).send(claimPayload());

    assert.equal(first.status, 201);
    assert.equal(second.status, 201);

    const { rows } = await query(`SELECT COUNT(*)::int AS n FROM claims WHERE item_id = $1`, [found.itemId]);
    assert.equal(rows[0].n, 2);
  });

  test('rejects a claim message that is too short (422)', async () => {
    const { found } = await scenario();
    const response = await api
      .post(`${API}/items/${found.itemId}/claims`)
      .set(auth(claimant.token))
      .send({ claimMessage: 'short' });
    assert.equal(response.status, 422);
  });

  test('rejects a claim once the item is returned (409)', async () => {
    const { found } = await scenario();
    const first = await api.post(`${API}/items/${found.itemId}/claims`).set(auth(claimant.token)).send(claimPayload());
    await api
      .patch(`${API}/admin/claims/${first.body.data.claimId}`)
      .set(auth(admin.token))
      .send({ decision: 'approved', reviewReason: 'Verified.' });

    const late = await api.post(`${API}/items/${found.itemId}/claims`).set(auth(otherClaimant.token)).send(claimPayload());
    assert.equal(late.status, 409);
  });

  test('concurrent identical submissions produce exactly one claim', async () => {
    const { found } = await scenario();

    const [a, b] = await Promise.all([
      api.post(`${API}/items/${found.itemId}/claims`).set(auth(claimant.token)).send(claimPayload()),
      api.post(`${API}/items/${found.itemId}/claims`).set(auth(claimant.token)).send(claimPayload()),
    ]);

    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [201, 409], `expected one success and one conflict, got ${statuses}`);

    const { rows } = await query(
      `SELECT COUNT(*)::int AS n FROM claims WHERE item_id = $1 AND claimant_id = $2 AND status IN ('pending','approved')`,
      [found.itemId, claimant.user.userId]
    );
    assert.equal(rows[0].n, 1, 'the partial unique index must keep a single active claim');
  });
});

describe('GET /claims/me and withdraw', () => {
  test('lists only the caller\'s claims, without private evidence', async () => {
    const { found } = await scenario();
    await api.post(`${API}/items/${found.itemId}/claims`).set(auth(claimant.token)).send(claimPayload());

    const mine = await api.get(`${API}/claims/me`).set(auth(claimant.token));
    assert.equal(mine.status, 200);
    assert.equal(mine.body.data.length, 1);
    assert.ok(mine.body.data.every((claim) => claim.claimant.userId === claimant.user.userId));
    assert.ok(!JSON.stringify(mine.body).includes('IMEI ends 4471'));

    const theirs = await api.get(`${API}/claims/me`).set(auth(otherClaimant.token));
    assert.equal(theirs.body.data.length, 0);
  });

  test('filters by status', async () => {
    const { found } = await scenario();
    await api.post(`${API}/items/${found.itemId}/claims`).set(auth(claimant.token)).send(claimPayload());

    const pending = await api.get(`${API}/claims/me?status=pending`).set(auth(claimant.token));
    assert.equal(pending.body.data.length, 1);

    const approved = await api.get(`${API}/claims/me?status=approved`).set(auth(claimant.token));
    assert.equal(approved.body.data.length, 0);
  });

  test('the claimant can withdraw and the item reopens', async () => {
    const { found } = await scenario();
    const created = await api.post(`${API}/items/${found.itemId}/claims`).set(auth(claimant.token)).send(claimPayload());

    const withdrawn = await api.post(`${API}/claims/${created.body.data.claimId}/withdraw`).set(auth(claimant.token)).send({});
    assert.equal(withdrawn.status, 200);
    assert.equal(withdrawn.body.data.status, 'withdrawn');

    const item = await query('SELECT status FROM items WHERE item_id = $1', [found.itemId]);
    assert.equal(item.rows[0].status, 'open', 'the item must reopen when no active claim remains');
  });

  test('another user cannot withdraw the claim (403)', async () => {
    const { found } = await scenario();
    const created = await api.post(`${API}/items/${found.itemId}/claims`).set(auth(claimant.token)).send(claimPayload());

    const response = await api.post(`${API}/claims/${created.body.data.claimId}/withdraw`).set(auth(otherClaimant.token)).send({});
    assert.equal(response.status, 403);
  });

  test('a decided claim cannot be withdrawn (409)', async () => {
    const { found } = await scenario();
    const created = await api.post(`${API}/items/${found.itemId}/claims`).set(auth(claimant.token)).send(claimPayload());
    await api
      .patch(`${API}/admin/claims/${created.body.data.claimId}`)
      .set(auth(admin.token))
      .send({ decision: 'rejected', reviewReason: 'Details did not match.' });

    const response = await api.post(`${API}/claims/${created.body.data.claimId}/withdraw`).set(auth(claimant.token)).send({});
    assert.equal(response.status, 409);
  });
});

describe('Administrator review', () => {
  test('the queue shows the verification hint but never private evidence', async () => {
    const { found } = await scenario();
    await api.post(`${API}/items/${found.itemId}/claims`).set(auth(claimant.token)).send(claimPayload());

    const queue = await api.get(`${API}/admin/claims`).set(auth(admin.token));
    assert.equal(queue.status, 200);
    assert.equal(queue.body.data.length, 1);
    assert.equal(queue.body.data[0].itemVerificationHint, 'cat sticker on the back and a crack in the top-left corner');
    assert.equal(queue.body.data[0].hasPrivateEvidence, true);
    assert.ok(!JSON.stringify(queue.body).includes('IMEI ends 4471'));
  });

  test('a non-administrator cannot read the queue (403)', async () => {
    await scenario();
    const response = await api.get(`${API}/admin/claims`).set(auth(claimant.token));
    assert.equal(response.status, 403);
  });

  test('approving marks the item returned and notifies both parties', async () => {
    const { found } = await scenario();
    const created = await api.post(`${API}/items/${found.itemId}/claims`).set(auth(claimant.token)).send(claimPayload());
    const claimId = created.body.data.claimId;

    const approved = await api
      .patch(`${API}/admin/claims/${claimId}`)
      .set(auth(admin.token))
      .send({ decision: 'approved', reviewReason: 'Ownership details matched the verification hint.' });

    assert.equal(approved.status, 200);
    assert.equal(approved.body.data.status, 'approved');
    assert.equal(approved.body.data.review.reviewedBy, admin.user.userId);
    assert.ok(approved.body.data.review.reviewedAt);

    const item = await query('SELECT status, closed_at FROM items WHERE item_id = $1', [found.itemId]);
    assert.equal(item.rows[0].status, 'returned');
    assert.ok(item.rows[0].closed_at);

    const claimantNotifications = await query(
      `SELECT notification_type FROM notifications WHERE user_id = $1 AND related_claim_id = $2`,
      [claimant.user.userId, claimId]
    );
    assert.ok(claimantNotifications.rows.some((row) => row.notification_type === 'claim_approved'));

    const finderNotifications = await query(
      `SELECT notification_type FROM notifications WHERE user_id = $1 AND related_item_id = $2`,
      [finder.user.userId, found.itemId]
    );
    assert.ok(finderNotifications.rows.some((row) => row.notification_type === 'item_returned'));

    const audit = await query(
      `SELECT action, metadata FROM audit_logs WHERE entity_type = 'claim' AND entity_id = $1 ORDER BY audit_id DESC`,
      [claimId]
    );
    assert.equal(audit.rows[0].action, 'claim.approved');
    assert.equal(audit.rows[0].metadata.decision, 'approved');
    assert.ok(!JSON.stringify(audit.rows).includes('IMEI'));
  });

  test('rejecting requires a reason and reopens the item', async () => {
    const { found } = await scenario();
    const created = await api.post(`${API}/items/${found.itemId}/claims`).set(auth(claimant.token)).send(claimPayload());
    const claimId = created.body.data.claimId;

    const withoutReason = await api.patch(`${API}/admin/claims/${claimId}`).set(auth(admin.token)).send({ decision: 'rejected' });
    assert.equal(withoutReason.status, 422);

    const rejected = await api
      .patch(`${API}/admin/claims/${claimId}`)
      .set(auth(admin.token))
      .send({ decision: 'rejected', reviewReason: 'The claimant could not describe the sticker.' });

    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.data.status, 'rejected');
    assert.equal(rejected.body.data.review.reviewReason, 'The claimant could not describe the sticker.');

    const item = await query('SELECT status, closed_at FROM items WHERE item_id = $1', [found.itemId]);
    assert.equal(item.rows[0].status, 'open');
    assert.equal(item.rows[0].closed_at, null);

    const notification = await query(
      `SELECT message FROM notifications WHERE user_id = $1 AND notification_type = 'claim_rejected'`,
      [claimant.user.userId]
    );
    assert.equal(notification.rows.length, 1);
    assert.match(notification.rows[0].message, /sticker/);
  });

  test('rejecting one of two claims keeps the item claimed', async () => {
    const { found } = await scenario();
    const first = await api.post(`${API}/items/${found.itemId}/claims`).set(auth(claimant.token)).send(claimPayload());
    await api.post(`${API}/items/${found.itemId}/claims`).set(auth(otherClaimant.token)).send(claimPayload());

    await api
      .patch(`${API}/admin/claims/${first.body.data.claimId}`)
      .set(auth(admin.token))
      .send({ decision: 'rejected', reviewReason: 'First claimant did not match.' });

    const item = await query('SELECT status FROM items WHERE item_id = $1', [found.itemId]);
    assert.equal(item.rows[0].status, 'claimed', 'a competing pending claim keeps the item claimed');
  });

  test('approving one claim rejects the competing pending claim', async () => {
    const { found } = await scenario();
    const first = await api.post(`${API}/items/${found.itemId}/claims`).set(auth(claimant.token)).send(claimPayload());
    const second = await api.post(`${API}/items/${found.itemId}/claims`).set(auth(otherClaimant.token)).send(claimPayload());

    await api
      .patch(`${API}/admin/claims/${first.body.data.claimId}`)
      .set(auth(admin.token))
      .send({ decision: 'approved', reviewReason: 'Verified with the verification hint.' });

    const rival = await query('SELECT status, review_reason FROM claims WHERE claim_id = $1', [second.body.data.claimId]);
    assert.equal(rival.rows[0].status, 'rejected');
    assert.match(rival.rows[0].review_reason, /another claim/i);

    const approvedCount = await query(`SELECT COUNT(*)::int AS n FROM claims WHERE item_id = $1 AND status = 'approved'`, [
      found.itemId,
    ]);
    assert.equal(approvedCount.rows[0].n, 1);

    const resolvedMatches = await query(
      `SELECT COUNT(*)::int AS n FROM matches WHERE (lost_item_id = $1 OR found_item_id = $1) AND match_status <> 'resolved'`,
      [found.itemId]
    );
    assert.equal(resolvedMatches.rows[0].n, 0, 'related matches must be resolved');
  });

  test('a claim cannot be reviewed twice (409)', async () => {
    const { found } = await scenario();
    const created = await api.post(`${API}/items/${found.itemId}/claims`).set(auth(claimant.token)).send(claimPayload());
    const claimId = created.body.data.claimId;

    const first = await api.patch(`${API}/admin/claims/${claimId}`).set(auth(admin.token)).send({ decision: 'approved', reviewReason: 'ok' });
    const second = await api.patch(`${API}/admin/claims/${claimId}`).set(auth(admin.token)).send({ decision: 'rejected', reviewReason: 'changed my mind' });

    assert.equal(first.status, 200);
    assert.equal(second.status, 409);
    assert.equal(second.body.error.details.currentStatus, 'approved');
  });

  test('concurrent approvals of the same claim yield one success and one conflict', async () => {
    const { found } = await scenario();
    const created = await api.post(`${API}/items/${found.itemId}/claims`).set(auth(claimant.token)).send(claimPayload());
    const claimId = created.body.data.claimId;
    const secondAdmin = await createUserViaApi({ fullName: 'Second Admin', role: 'admin' });

    const [a, b] = await Promise.all([
      api.patch(`${API}/admin/claims/${claimId}`).set(auth(admin.token)).send({ decision: 'approved', reviewReason: 'Approved by A.' }),
      api.patch(`${API}/admin/claims/${claimId}`).set(auth(secondAdmin.token)).send({ decision: 'rejected', reviewReason: 'Rejected by B.' }),
    ]);

    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [200, 409], `expected one success and one conflict, got ${statuses}`);

    const approved = await query(`SELECT COUNT(*)::int AS n FROM claims WHERE claim_id = $1 AND status = 'approved'`, [claimId]);
    const rejected = await query(`SELECT COUNT(*)::int AS n FROM claims WHERE claim_id = $1 AND status = 'rejected'`, [claimId]);
    assert.equal(approved.rows[0].n + rejected.rows[0].n, 1, 'exactly one decision must be recorded');
  });

  test('an administrator cannot review their own claim (403)', async () => {
    const { found } = await scenario();
    // The reviewing administrator is also the claimant.
    const created = await api.post(`${API}/items/${found.itemId}/claims`).set(auth(admin.token)).send(claimPayload());
    assert.equal(created.status, 201);

    const response = await api
      .patch(`${API}/admin/claims/${created.body.data.claimId}`)
      .set(auth(admin.token))
      .send({ decision: 'approved', reviewReason: 'Approving myself.' });

    assert.equal(response.status, 403);
    assert.match(response.body.error.message, /your own claim/);

    // The database constraint must also protect against a direct UPDATE.
    await assert.rejects(
      () =>
        query(
          `UPDATE claims SET status = 'approved', reviewed_by = claimant_id, reviewed_at = now() WHERE claim_id = $1`,
          [created.body.data.claimId]
        ),
      /claims_no_self_review_chk/
    );
  });

  test('a failed review leaves no partial state behind (transaction rollback)', async () => {
    const { found } = await scenario();
    const created = await api.post(`${API}/items/${found.itemId}/claims`).set(auth(admin.token)).send(claimPayload());
    const claimId = created.body.data.claimId;

    const notificationsBefore = await query('SELECT COUNT(*)::int AS n FROM notifications');
    const auditBefore = await query('SELECT COUNT(*)::int AS n FROM audit_logs');

    const failed = await api
      .patch(`${API}/admin/claims/${claimId}`)
      .set(auth(admin.token))
      .send({ decision: 'approved', reviewReason: 'Self approval attempt.' });
    assert.equal(failed.status, 403);

    const claim = await query('SELECT status, reviewed_by FROM claims WHERE claim_id = $1', [claimId]);
    assert.equal(claim.rows[0].status, 'pending');
    assert.equal(claim.rows[0].reviewed_by, null);

    const item = await query('SELECT status FROM items WHERE item_id = $1', [found.itemId]);
    assert.equal(item.rows[0].status, 'claimed');

    const notificationsAfter = await query('SELECT COUNT(*)::int AS n FROM notifications');
    const auditAfter = await query('SELECT COUNT(*)::int AS n FROM audit_logs');
    assert.equal(notificationsAfter.rows[0].n, notificationsBefore.rows[0].n, 'no notification may be created');
    assert.equal(auditAfter.rows[0].n, auditBefore.rows[0].n, 'no audit entry may be created');
  });

  test('claim review is recorded in the audit log with the reviewer', async () => {
    const { found } = await scenario();
    const created = await api.post(`${API}/items/${found.itemId}/claims`).set(auth(claimant.token)).send(claimPayload());
    await api
      .patch(`${API}/admin/claims/${created.body.data.claimId}`)
      .set(auth(admin.token))
      .send({ decision: 'rejected', reviewReason: 'Not enough detail provided.' });

    const { rows } = await query(
      `SELECT al.action, al.actor_user_id, u.role
         FROM audit_logs al JOIN users u ON u.user_id = al.actor_user_id
        WHERE al.entity_type = 'claim' AND al.entity_id = $1 AND al.action = 'claim.rejected'`,
      [created.body.data.claimId]
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].actor_user_id, admin.user.userId);
    assert.equal(rows[0].role, 'admin');
  });
});
