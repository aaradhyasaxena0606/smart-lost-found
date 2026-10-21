/**
 * Item report and search tests.
 *
 * Acceptance criteria covered (PROJECT_SPEC.md section 18 "Reports and Search"):
 *   * valid lost/found reports can be created and updated according to permissions
 *   * invalid fields and invalid coordinates are rejected
 *   * search filters, sorting and pagination work
 *   * private verification data never appears in public responses
 *   * upload type and size restrictions are enforced
 */
import './helpers/load-test-env.js';
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {
  api,
  API,
  resetDatabase,
  closeDatabase,
  createUserViaApi,
  createItemViaApi,
  getCategoryId,
  itemPayload,
} from './helpers/setup.js';
import { query } from '../src/config/db.js';
import config from '../src/config/env.js';

let owner;
let other;
let admin;
let categoryId;

before(async () => {
  await resetDatabase();
  categoryId = await getCategoryId('Mobile Phone');
  owner = await createUserViaApi({ fullName: 'Owner User' });
  other = await createUserViaApi({ fullName: 'Other User' });
  admin = await createUserViaApi({ fullName: 'Admin User', role: 'admin' });
});

after(async () => {
  await closeDatabase();
});

const auth = (token) => ({ Authorization: `Bearer ${token}` });

describe('POST /items', () => {
  test('creates a lost report', async () => {
    const response = await api.post(`${API}/items`).set(auth(owner.token)).send(itemPayload({ categoryId }));

    assert.equal(response.status, 201);
    assert.equal(response.body.data.reportType, 'lost');
    assert.equal(response.body.data.status, 'open');
    assert.equal(response.body.data.location.latitude, 51.5007);
    assert.equal(response.body.data.location.longitude, -0.1246);
    assert.equal(response.body.data.reporter.userId, owner.user.userId);
    assert.deepEqual(response.body.data.images, []);
  });

  test('creates a found report with private verification details', async () => {
    const response = await api
      .post(`${API}/items`)
      .set(auth(owner.token))
      .send(
        itemPayload({
          categoryId,
          reportType: 'found',
          title: 'Found black phone near the library',
          verificationHint: 'cat sticker on the back, crack top-left',
        })
      );

    assert.equal(response.status, 201);
    // The reporter may read back their own private hint...
    assert.equal(response.body.data.privateDetails.verificationHint, 'cat sticker on the back, crack top-left');
  });

  test('requires authentication (401)', async () => {
    const response = await api.post(`${API}/items`).send(itemPayload({ categoryId }));
    assert.equal(response.status, 401);
  });

  test('rejects a missing category with a specific message', async () => {
    const response = await api
      .post(`${API}/items`)
      .set(auth(owner.token))
      .send(itemPayload({ categoryId: 999_999 }));
    assert.equal(response.status, 400);
    assert.match(response.body.error.message, /Category/);
  });

  test('rejects an unknown report type (422)', async () => {
    const response = await api
      .post(`${API}/items`)
      .set(auth(owner.token))
      .send(itemPayload({ categoryId, reportType: 'stolen' }));
    assert.equal(response.status, 422);
  });

  test('rejects a too-short title and description (422)', async () => {
    const response = await api
      .post(`${API}/items`)
      .set(auth(owner.token))
      .send(itemPayload({ categoryId, title: 'ab', description: 'short' }));
    assert.equal(response.status, 422);
    const fields = response.body.error.details.map((detail) => detail.field);
    assert.ok(fields.includes('title'));
    assert.ok(fields.includes('description'));
  });

  test('rejects invalid coordinates (422)', async () => {
    const badLatitude = await api
      .post(`${API}/items`)
      .set(auth(owner.token))
      .send(itemPayload({ categoryId, latitude: 120, longitude: 10 }));
    assert.equal(badLatitude.status, 422);

    const badLongitude = await api
      .post(`${API}/items`)
      .set(auth(owner.token))
      .send(itemPayload({ categoryId, latitude: 10, longitude: 400 }));
    assert.equal(badLongitude.status, 422);
  });

  test('rejects latitude without longitude (422)', async () => {
    const payload = itemPayload({ categoryId, latitude: 51.5 });
    delete payload.longitude;
    const response = await api.post(`${API}/items`).set(auth(owner.token)).send(payload);
    assert.equal(response.status, 422);
    assert.ok(
      response.body.error.details.some((detail) => /together/.test(detail.message)),
      'expected a "provided together" message'
    );
  });

  test('rejects an event time far in the future (400)', async () => {
    const response = await api
      .post(`${API}/items`)
      .set(auth(owner.token))
      .send(itemPayload({ categoryId, eventTime: new Date(Date.now() + 72 * 3600_000).toISOString() }));
    assert.equal(response.status, 400);
  });

  test('stores coordinates in the declared axis order (longitude, latitude)', async () => {
    const created = await createItemViaApi(owner.token, { categoryId });
    const { rows } = await query(
      `SELECT ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude,
              ST_SRID(location::geometry) AS srid, GeometryType(location::geometry) AS geom_type
         FROM items WHERE item_id = $1`,
      [created.itemId]
    );
    assert.equal(rows[0].srid, 4326);
    assert.equal(rows[0].geom_type, 'POINT');
    assert.equal(Number(rows[0].latitude), 51.5007);
    assert.equal(Number(rows[0].longitude), -0.1246);
  });
});

describe('GET /items/:itemId', () => {
  test('returns public details to anonymous callers', async () => {
    const created = await createItemViaApi(owner.token, { categoryId, verificationHint: 'secret hint' });
    const response = await api.get(`${API}/items/${created.itemId}`);

    assert.equal(response.status, 200);
    assert.equal(response.body.data.itemId, created.itemId);
    assert.equal(response.body.data.privateDetails, undefined);
    assert.equal(response.body.data.description, created.description);
  });

  test('never exposes private verification data to another user', async () => {
    const created = await createItemViaApi(owner.token, { categoryId, verificationHint: 'top secret hint' });
    const response = await api.get(`${API}/items/${created.itemId}`).set(auth(other.token));

    assert.equal(response.status, 200);
    assert.equal(response.body.data.privateDetails, undefined);
    assert.ok(!JSON.stringify(response.body).includes('top secret hint'));
  });

  test('lets an administrator read the private hint', async () => {
    const created = await createItemViaApi(owner.token, { categoryId, verificationHint: 'admin visible hint' });
    const response = await api.get(`${API}/items/${created.itemId}`).set(auth(admin.token));

    assert.equal(response.status, 200);
    assert.equal(response.body.data.privateDetails.verificationHint, 'admin visible hint');
  });

  test('returns 404 for an unknown report', async () => {
    const response = await api.get(`${API}/items/999999`);
    assert.equal(response.status, 404);
  });

  test('returns 422 for a non-numeric id', async () => {
    const response = await api.get(`${API}/items/abc`);
    assert.equal(response.status, 422);
  });
});

describe('PATCH /items/:itemId', () => {
  test('lets the owner update their report', async () => {
    const created = await createItemViaApi(owner.token, { categoryId });
    const response = await api
      .patch(`${API}/items/${created.itemId}`)
      .set(auth(owner.token))
      .send({ title: 'Updated title for my phone', colour: 'blue' });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.title, 'Updated title for my phone');
    assert.equal(response.body.data.colour, 'blue');
  });

  test('forbids another user from updating the report (403)', async () => {
    const created = await createItemViaApi(owner.token, { categoryId });
    const response = await api
      .patch(`${API}/items/${created.itemId}`)
      .set(auth(other.token))
      .send({ title: 'Not my report to edit' });

    assert.equal(response.status, 403);
  });

  test('lets an administrator update any report', async () => {
    const created = await createItemViaApi(owner.token, { categoryId });
    const response = await api
      .patch(`${API}/items/${created.itemId}`)
      .set(auth(admin.token))
      .send({ brand: 'Moderated Brand' });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.brand, 'Moderated Brand');
  });

  test('can clear the location and the private hint', async () => {
    const created = await createItemViaApi(owner.token, { categoryId, verificationHint: 'to be cleared' });
    const response = await api
      .patch(`${API}/items/${created.itemId}`)
      .set(auth(owner.token))
      .send({ latitude: null, longitude: null, verificationHint: null });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.location, null);
    assert.equal(response.body.data.privateDetails.verificationHint, null);
  });

  test('rejects an empty update body (422)', async () => {
    const created = await createItemViaApi(owner.token, { categoryId });
    const response = await api.patch(`${API}/items/${created.itemId}`).set(auth(owner.token)).send({});
    assert.equal(response.status, 422);
  });

  test('rejects changing the report type (400)', async () => {
    const created = await createItemViaApi(owner.token, { categoryId });
    const response = await api
      .patch(`${API}/items/${created.itemId}`)
      .set(auth(owner.token))
      .send({ reportType: 'found' });
    assert.equal(response.status, 400);
  });
});

describe('PATCH /items/:itemId/status', () => {
  test('accepts a legal transition and records closed_at', async () => {
    const created = await createItemViaApi(owner.token, { categoryId });
    const response = await api
      .patch(`${API}/items/${created.itemId}/status`)
      .set(auth(owner.token))
      .send({ status: 'closed' });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.status, 'closed');
    assert.ok(response.body.data.closedAt);
  });

  test('rejects an illegal transition with 409 and lists allowed targets', async () => {
    const created = await createItemViaApi(owner.token, { categoryId });
    const response = await api
      .patch(`${API}/items/${created.itemId}/status`)
      .set(auth(owner.token))
      .send({ status: 'returned' });

    assert.equal(response.status, 409);
    assert.ok(Array.isArray(response.body.error.details.allowed));
    assert.deepEqual(response.body.error.details.allowed, ['matched', 'claimed', 'closed', 'rejected']);
  });

  test('rejects an unknown status value (422)', async () => {
    const created = await createItemViaApi(owner.token, { categoryId });
    const response = await api
      .patch(`${API}/items/${created.itemId}/status`)
      .set(auth(owner.token))
      .send({ status: 'lost' });
    assert.equal(response.status, 422);
  });

  test('only an administrator may reject a report (403)', async () => {
    const created = await createItemViaApi(owner.token, { categoryId });
    const response = await api
      .patch(`${API}/items/${created.itemId}/status`)
      .set(auth(owner.token))
      .send({ status: 'rejected' });
    assert.equal(response.status, 403);
  });

  test('forbids changing another user\'s report status (403)', async () => {
    const created = await createItemViaApi(owner.token, { categoryId });
    const response = await api
      .patch(`${API}/items/${created.itemId}/status`)
      .set(auth(other.token))
      .send({ status: 'closed' });
    assert.equal(response.status, 403);
  });
});

describe('GET /items search', () => {
  before(async () => {
    // A clearly separated set of reports for the search assertions.
    await resetDatabase();
    categoryId = await getCategoryId('Mobile Phone');
    owner = await createUserViaApi({ fullName: 'Search Owner' });
    other = await createUserViaApi({ fullName: 'Search Other' });

    await createItemViaApi(owner.token, {
      categoryId,
      reportType: 'lost',
      title: 'Lost red umbrella near the fountain',
      description: 'A red umbrella with a wooden handle left beside the fountain.',
      colour: 'red',
      brand: 'Umbrella Co',
      latitude: 51.51,
      longitude: -0.12,
    });
    await createItemViaApi(other.token, {
      categoryId,
      reportType: 'found',
      title: 'Found blue umbrella at the gate',
      description: 'A blue umbrella found at the west gate this morning.',
      colour: 'blue',
      brand: 'RainPro',
      latitude: 51.52,
      longitude: -0.11,
    });
    const backpack = await getCategoryId('Bag & Backpack');
    await createItemViaApi(other.token, {
      categoryId: backpack,
      reportType: 'found',
      title: 'Found a green backpack in the cafeteria',
      description: 'A green backpack with a broken zip found under a table in the cafeteria.',
      colour: 'green',
      brand: 'Campus Gear',
      latitude: 51.5007,
      longitude: -0.1246,
    });
  });

  test('returns every report by default with pagination metadata', async () => {
    const response = await api.get(`${API}/items`);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.length, 3);
    assert.equal(response.body.meta.total, 3);
    assert.equal(response.body.meta.page, 1);
    assert.equal(response.body.meta.limit, 20);
    assert.equal(response.body.meta.totalPages, 1);
    assert.equal(response.body.meta.hasNextPage, false);
  });

  test('filters by type', async () => {
    const lost = await api.get(`${API}/items?type=lost`);
    assert.equal(lost.body.data.length, 1);
    assert.ok(lost.body.data.every((item) => item.reportType === 'lost'));

    const found = await api.get(`${API}/items?type=found`);
    assert.equal(found.body.data.length, 2);
  });

  test('filters by category', async () => {
    const backpack = await getCategoryId('Bag & Backpack');
    const response = await api.get(`${API}/items?categoryId=${backpack}`);
    assert.equal(response.body.data.length, 1);
    assert.equal(response.body.data[0].category.name, 'Bag & Backpack');
  });

  test('filters by colour case-insensitively', async () => {
    const response = await api.get(`${API}/items?colour=RED`);
    assert.equal(response.body.data.length, 1);
    assert.equal(response.body.data[0].colour, 'red');
  });

  test('searches title and description text', async () => {
    const response = await api.get(`${API}/items?q=backpack`);
    assert.equal(response.body.data.length, 1);
    assert.match(response.body.data[0].title, /backpack/i);
  });

  test('filters by event-time window', async () => {
    const future = new Date(Date.now() + 24 * 3600_000).toISOString();
    const none = await api.get(`${API}/items?from=${future}`);
    assert.equal(none.body.data.length, 0);

    const past = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
    const all = await api.get(`${API}/items?from=${past}`);
    assert.equal(all.body.data.length, 3);
  });

  test('sorts by event time when asked', async () => {
    const response = await api.get(`${API}/items?sort=event_time`);
    const times = response.body.data.map((item) => new Date(item.eventTime).getTime());
    const sorted = [...times].sort((a, b) => b - a);
    assert.deepEqual(times, sorted);
  });

  test('paginates with a bounded limit', async () => {
    const page1 = await api.get(`${API}/items?limit=2&page=1`);
    assert.equal(page1.body.data.length, 2);
    assert.equal(page1.body.meta.hasNextPage, true);

    const page2 = await api.get(`${API}/items?limit=2&page=2`);
    assert.equal(page2.body.data.length, 1);
    assert.equal(page2.body.meta.hasNextPage, false);
    assert.equal(page2.body.meta.hasPreviousPage, true);

    // No overlap between pages.
    const ids = new Set([...page1.body.data, ...page2.body.data].map((item) => item.itemId));
    assert.equal(ids.size, 3);
  });

  test('rejects an out-of-range limit (422)', async () => {
    const tooBig = await api.get(`${API}/items?limit=5000`);
    assert.equal(tooBig.status, 422);

    const zero = await api.get(`${API}/items?limit=0`);
    assert.equal(zero.status, 422);
  });

  test('never includes private verification data in a listing', async () => {
    const response = await api.get(`${API}/items`);
    const body = JSON.stringify(response.body);
    assert.ok(!body.includes('verificationHint'));
    assert.ok(!body.includes('verification_hint'));
    assert.ok(!body.includes('privateEvidence'));
  });

  test('excludes soft-deleted reports', async () => {
    const created = await createItemViaApi(owner.token, {
      categoryId,
      title: 'Report that will be deleted',
      description: 'A report created only to be soft deleted in this test case.',
    });
    const before = await api.get(`${API}/items`);
    assert.equal(before.body.meta.total, 4);

    const deleted = await api.delete(`${API}/items/${created.itemId}`).set(auth(owner.token));
    assert.equal(deleted.status, 204);

    const after = await api.get(`${API}/items`);
    assert.equal(after.body.meta.total, 3);
    const stillInDatabase = await query('SELECT deleted_at FROM items WHERE item_id = $1', [created.itemId]);
    assert.ok(stillInDatabase.rows[0].deleted_at, 'soft delete must keep the row');
  });

  test('forbids deleting another user\'s report (403)', async () => {
    const created = await createItemViaApi(owner.token, { categoryId });
    const response = await api.delete(`${API}/items/${created.itemId}`).set(auth(other.token));
    assert.equal(response.status, 403);
  });
});

describe('GET /users/me/items', () => {
  test('returns only the current user\'s reports', async () => {
    await resetDatabase();
    categoryId = await getCategoryId('Mobile Phone');
    owner = await createUserViaApi();
    other = await createUserViaApi();

    await createItemViaApi(owner.token, { categoryId });
    await createItemViaApi(other.token, { categoryId, title: 'A report belonging to someone else entirely' });

    const response = await api.get(`${API}/users/me/items`).set(auth(owner.token));
    assert.equal(response.status, 200);
    assert.equal(response.body.data.length, 1);
    assert.ok(response.body.data.every((item) => item.reporter.userId === owner.user.userId));
  });

  test('can include deleted reports on request', async () => {
    const created = await createItemViaApi(owner.token, { categoryId });
    await api.delete(`${API}/items/${created.itemId}`).set(auth(owner.token));

    // The owner already has one undeleted report from the previous test case.
    const withoutDeleted = await api.get(`${API}/users/me/items`).set(auth(owner.token));
    assert.equal(withoutDeleted.body.data.length, 1);
    assert.ok(withoutDeleted.body.data.every((item) => item.deletedAt === null || item.deletedAt === undefined));

    const withDeleted = await api.get(`${API}/users/me/items?includeDeleted=true`).set(auth(owner.token));
    assert.equal(withDeleted.body.data.length, 2);
    assert.ok(withDeleted.body.data.some((item) => item.deletedAt));
  });

  test('requires authentication (401)', async () => {
    const response = await api.get(`${API}/users/me/items`);
    assert.equal(response.status, 401);
  });
});

describe('Image uploads', () => {
  const pngBytes = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001' +
      '0d0a2db40000000049454e44ae426082',
    'hex'
  );

  test('accepts a real PNG within the limits', async () => {
    const created = await createItemViaApi(owner.token, { categoryId });
    const response = await api
      .post(`${API}/items/${created.itemId}/images`)
      .set(auth(owner.token))
      .attach('image', pngBytes, { filename: 'photo.png', contentType: 'image/png' });

    assert.equal(response.status, 201);
    assert.match(response.body.data.imageUrl, /^\/uploads\/[0-9a-f-]+\.png$/);
    assert.equal(response.body.data.mimeType, 'image/png');

    const detail = await api.get(`${API}/items/${created.itemId}`);
    assert.equal(detail.body.data.images.length, 1);
  });

  test('rejects a disallowed MIME type (400)', async () => {
    const created = await createItemViaApi(owner.token, { categoryId });
    const response = await api
      .post(`${API}/items/${created.itemId}/images`)
      .set(auth(owner.token))
      .attach('image', Buffer.from('MZ\x90\x00executable'), {
        filename: 'malware.exe',
        contentType: 'application/x-msdownload',
      });

    assert.equal(response.status, 400);
  });

  test('rejects a file whose contents do not match an image (400)', async () => {
    const created = await createItemViaApi(owner.token, { categoryId });
    const response = await api
      .post(`${API}/items/${created.itemId}/images`)
      .set(auth(owner.token))
      .attach('image', Buffer.from('this is not a png at all'), {
        filename: 'fake.png',
        contentType: 'image/png',
      });

    assert.equal(response.status, 400);
    assert.match(response.body.error.message, /valid JPEG, PNG or WebP/);
  });

  test('rejects a file larger than MAX_UPLOAD_MB (413)', async () => {
    const created = await createItemViaApi(owner.token, { categoryId });
    const oversized = Buffer.concat([pngBytes, Buffer.alloc(config.maxUploadBytes + 1024)]);

    const response = await api
      .post(`${API}/items/${created.itemId}/images`)
      .set(auth(owner.token))
      .attach('image', oversized, { filename: 'huge.png', contentType: 'image/png' });

    assert.equal(response.status, 413);
  });

  test('forbids uploading to another user\'s report (403)', async () => {
    const created = await createItemViaApi(owner.token, { categoryId });
    const response = await api
      .post(`${API}/items/${created.itemId}/images`)
      .set(auth(other.token))
      .attach('image', pngBytes, { filename: 'photo.png', contentType: 'image/png' });

    assert.equal(response.status, 403);
  });

  test('the uploaded file is stored outside the source tree with a generated name', async () => {
    const created = await createItemViaApi(owner.token, { categoryId });
    const response = await api
      .post(`${API}/items/${created.itemId}/images`)
      .set(auth(owner.token))
      .attach('image', pngBytes, { filename: '../../evil name.png', contentType: 'image/png' });

    assert.equal(response.status, 201);
    const storedPath = path.join(config.uploadDir, response.body.data.storageKey);
    assert.ok(fs.existsSync(storedPath));
    assert.ok(!response.body.data.storageKey.includes('..'));
    fs.rmSync(storedPath, { force: true });
  });

  test('deletes an image and its stored file', async () => {
    const created = await createItemViaApi(owner.token, { categoryId });
    const uploaded = await api
      .post(`${API}/items/${created.itemId}/images`)
      .set(auth(owner.token))
      .attach('image', pngBytes, { filename: 'photo.png', contentType: 'image/png' });

    const imageId = uploaded.body.data.imageId;
    const storedPath = path.join(config.uploadDir, uploaded.body.data.storageKey);

    const response = await api.delete(`${API}/items/${created.itemId}/images/${imageId}`).set(auth(owner.token));
    assert.equal(response.status, 204);
    assert.ok(!fs.existsSync(storedPath));
  });
});
