/**
 * Items service: report search, creation, updates, status transitions, images.
 *
 * Public reads go through the `v_public_items` view / `fn_search_items` function,
 * which by construction cannot return private verification data (FR-26).
 * Private details are only loaded when the caller is the reporter or an
 * administrator, and even then only for a single item.
 */
import { query, withTransaction } from '../../config/db.js';
import { badRequest, conflict, forbidden, notFound } from '../../utils/httpError.js';
import { parsePagination, buildPageMeta } from '../../utils/pagination.js';
import { validateCoordinatePair } from '../../utils/geo.js';
import * as auditService from '../../services/audit.service.js';
import * as matchingService from '../../services/matching.service.js';
import { removeStoredFile } from '../../middleware/upload.js';

/**
 * Allowed status transitions, mirrored by the database trigger
 * fn_validate_item_status_transition() (migration 005). Keeping the same matrix
 * in both layers gives friendly 400s while making the rule impossible to bypass.
 */
export const ALLOWED_TRANSITIONS = Object.freeze({
  open: ['matched', 'claimed', 'closed', 'rejected'],
  matched: ['claimed', 'returned', 'closed', 'rejected'],
  claimed: ['returned', 'closed', 'open'],
  returned: ['closed'],
  closed: ['open'],
  rejected: ['open', 'closed'],
});

export const REPORT_TYPES = Object.freeze(['lost', 'found']);
export const ITEM_STATUSES = Object.freeze(['open', 'matched', 'claimed', 'returned', 'closed', 'rejected']);

const MAX_EVENT_TIME_FUTURE_HOURS = 24;

export function canTransition(from, to) {
  if (from === to) return false;
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

/** Maps a row from v_public_items / fn_search_items into the API shape. */
export function mapItemRow(row) {
  return {
    itemId: row.item_id,
    reportType: row.report_type,
    title: row.title,
    description: row.description,
    colour: row.colour,
    brand: row.brand,
    eventTime: row.event_time,
    locationName: row.location_name,
    location:
      row.latitude === null || row.latitude === undefined
        ? null
        : { latitude: row.latitude, longitude: row.longitude },
    status: row.status,
    category: { categoryId: row.category_id, name: row.category_name },
    reporter: { userId: row.reporter_id, fullName: row.reporter_name },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
    ...(row.distance_meters !== undefined ? { distanceMeters: row.distance_meters } : {}),
    ...(row.relevance !== undefined && row.relevance !== null ? { relevance: row.relevance } : {}),
  };
}

/** Attaches images to a list of items using one extra query (no N+1). */
async function attachImages(items, client) {
  if (items.length === 0) return items;

  const runner = client ?? { query };
  const ids = items.map((item) => item.itemId);
  const { rows } = await runner.query(
    `SELECT image_id, item_id, storage_key, mime_type, byte_size, alt_text, uploaded_at
       FROM item_images
      WHERE item_id = ANY($1::int[])
      ORDER BY uploaded_at ASC, image_id ASC`,
    [ids]
  );

  const byItem = new Map();
  for (const row of rows) {
    const list = byItem.get(row.item_id) ?? [];
    list.push({
      imageId: row.image_id,
      imageUrl: `/uploads/${row.storage_key}`,
      storageKey: row.storage_key,
      mimeType: row.mime_type,
      byteSize: row.byte_size,
      altText: row.alt_text,
      uploadedAt: row.uploaded_at,
    });
    byItem.set(row.item_id, list);
  }

  return items.map((item) => ({ ...item, images: byItem.get(item.itemId) ?? [] }));
}

/**
 * Public report search (FR-11, FR-12).
 * Filtering, relevance ranking, radius search and total counting all happen in
 * the database inside fn_search_items (see migration 013).
 */
export async function searchItems(filters) {
  const { page, limit, offset } = parsePagination(filters);

  // The public API exposes `type` (spec 14); the SQL function uses
  // `p_report_type`. Both spellings are accepted here so no caller can silently
  // lose the filter.
  const reportType = filters.reportType ?? filters.type ?? null;

  const coordinateError = validateCoordinatePair(filters.latitude, filters.longitude);
  if (coordinateError) throw badRequest(coordinateError);

  if ((filters.latitude === null || filters.latitude === undefined || filters.longitude === null || filters.longitude === undefined) && filters.radiusMeters !== undefined) {
    throw badRequest('radiusMeters requires latitude and longitude.');
  }

  const { rows } = await query(
    `SELECT * FROM fn_search_items(
        p_report_type   => $1,
        p_category_id   => $2,
        p_status        => $3,
        p_colour        => $4,
        p_brand         => $5,
        p_query         => $6,
        p_from          => $7,
        p_to            => $8,
        p_latitude      => $9,
        p_longitude     => $10,
        p_radius_meters => $11,
        p_reporter_id   => $12,
        p_sort          => $13,
        p_limit         => $14,
        p_offset        => $15
     )`,
    [
      reportType,
      filters.categoryId ?? null,
      filters.status ?? null,
      filters.colour ?? null,
      filters.brand ?? null,
      filters.q ?? null,
      filters.from ?? null,
      filters.to ?? null,
      filters.latitude ?? null,
      filters.longitude ?? null,
      filters.radiusMeters ?? null,
      filters.reporterId ?? null,
      filters.sort ?? 'recent',
      limit,
      offset,
    ]
  );

  const total = rows.length > 0 ? rows[0].total_count : 0;
  const items = await attachImages(rows.map(mapItemRow));

  return { items, meta: buildPageMeta({ page, limit, total }) };
}

/**
 * Loads one report.
 *
 * @param {number} itemId
 * @param {{userId?: number, role?: string}} viewer
 * @param {boolean} [includeDeleted] administrators may look up deleted reports
 * @param {import('pg').PoolClient} [client] reuse the caller's transaction so a
 *        row inserted but not yet committed in that transaction is visible
 */
export async function getItemById(itemId, viewer = {}, includeDeleted = false, client) {
  const runner = client ?? { query };
  const { rows } = await runner.query(
    `SELECT v.*, i.deleted_at
       FROM v_public_items v
       JOIN items i ON i.item_id = v.item_id
      WHERE v.item_id = $1
        AND ($2::boolean OR i.deleted_at IS NULL)`,
    [itemId, includeDeleted]
  );
  if (rows.length === 0) return null;

  const item = mapItemRow(rows[0]);
  item.deletedAt = rows[0].deleted_at;

  const isOwner = viewer.userId !== undefined && viewer.userId === item.reporter.userId;
  const isAdmin = viewer.role === 'admin';

  // Private verification data is returned ONLY to the reporter (to edit their own
  // report) or to an administrator. It is never part of a public response.
  if (isOwner || isAdmin) {
    const privateResult = await runner.query(
      `SELECT verification_hint FROM item_private_details WHERE item_id = $1`,
      [itemId]
    );
    item.privateDetails = {
      hasVerificationHint: privateResult.rows.length > 0,
      verificationHint: privateResult.rows[0]?.verification_hint ?? null,
    };
  }

  const stats = await runner.query(
    `SELECT match_count, suggested_count, best_score
       FROM v_item_match_stats WHERE item_id = $1`,
    [itemId]
  );
  item.matchSummary = stats.rows.length
    ? {
        matchCount: stats.rows[0].match_count,
        suggestedCount: stats.rows[0].suggested_count,
        bestScore: stats.rows[0].best_score,
      }
    : { matchCount: 0, suggestedCount: 0, bestScore: 0 };

  const [withImages] = await attachImages([item], client);
  return withImages;
}

/** Ensures the referenced category exists, giving a specific error message. */
async function assertCategoryExists(categoryId, client) {
  const runner = client ?? { query };
  const { rows } = await runner.query('SELECT 1 FROM categories WHERE category_id = $1', [categoryId]);
  if (rows.length === 0) {
    throw badRequest(`Category ${categoryId} does not exist.`);
  }
}

function assertEventTimeIsSane(eventTime) {
  const limit = Date.now() + MAX_EVENT_TIME_FUTURE_HOURS * 3_600_000;
  if (new Date(eventTime).getTime() > limit) {
    throw badRequest(
      `eventTime cannot be more than ${MAX_EVENT_TIME_FUTURE_HOURS} hours in the future.`
    );
  }
}

/**
 * Creates a lost or found report (FR-06, FR-07, FR-10).
 *
 * The report, its optional private verification hint, the audit record and the
 * initial candidate matches are produced inside ONE transaction, so a report is
 * never left without its private details or without its first matches.
 */
export async function createItem(input, actorUserId) {
  assertEventTimeIsSane(input.eventTime);

  return withTransaction(async (client) => {
    await assertCategoryExists(input.categoryId, client);

    const origin =
      input.latitude !== null && input.latitude !== undefined
        ? `SRID=4326;POINT(${input.longitude} ${input.latitude})`
        : null;

    const { rows } = await client.query(
      `INSERT INTO items
         (reporter_id, category_id, report_type, title, description, colour, brand,
          event_time, location_name, location)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::geography)
       RETURNING item_id, status, created_at`,
      [
        actorUserId,
        input.categoryId,
        input.reportType,
        input.title,
        input.description,
        input.colour ?? null,
        input.brand ?? null,
        input.eventTime,
        input.locationName ?? null,
        origin,
      ]
    );

    const itemId = rows[0].item_id;

    if (input.verificationHint) {
      await client.query(
        `INSERT INTO item_private_details (item_id, verification_hint) VALUES ($1, $2)`,
        [itemId, input.verificationHint]
      );
    }

    await auditService.record(
      {
        actorUserId,
        action: auditService.AUDIT_ACTIONS.ITEM_CREATED,
        entityType: 'item',
        entityId: itemId,
        metadata: {
          reportType: input.reportType,
          categoryId: input.categoryId,
          hasLocation: Boolean(origin),
          hasPrivateDetails: Boolean(input.verificationHint),
        },
      },
      client
    );

    // Generate candidate matches immediately so the reporter gets feedback
    // (workflow 6.1 step 4 / 6.2 step 4). Failures here must not lose the report,
    // so the callee's transaction is reused and any error rolls everything back
    // only if it is a genuine data error.
    await matchingService.recalculateForItem(itemId, { actorUserId, client });

    const created = await getItemById(itemId, { userId: actorUserId, role: 'user' }, true, client);
    return created;
  });
}

/**
 * Updates an existing report. Only the reporter or an administrator may call it
 * (the route enforces authorization; this re-checks ownership defensively).
 */
export async function updateItem(itemId, changes, actor) {
  return withTransaction(async (client) => {
    const current = await client.query(
      `SELECT item_id, reporter_id, report_type, status, deleted_at FROM items
        WHERE item_id = $1 FOR UPDATE`,
      [itemId]
    );
    if (current.rows.length === 0) throw notFound(`Report ${itemId} was not found.`);

    const item = current.rows[0];
    if (item.deleted_at) throw badRequest('Deleted reports cannot be edited.');
    if (actor.role !== 'admin' && actor.userId !== item.reporter_id) {
      throw forbidden('You may only edit your own reports.');
    }
    if (['returned', 'closed'].includes(item.status) && actor.role !== 'admin') {
      throw conflict(`Reports with status "${item.status}" can no longer be edited.`);
    }

    if (changes.categoryId !== undefined) {
      await assertCategoryExists(changes.categoryId, client);
    }
    if (changes.eventTime !== undefined) {
      assertEventTimeIsSane(changes.eventTime);
    }
    if (changes.reportType !== undefined && changes.reportType !== item.report_type) {
      throw badRequest('The report type of an existing report cannot be changed.');
    }

    const hasCoordinates =
      changes.latitude !== undefined || changes.longitude !== undefined;

    // Build the update dynamically but always with placeholders (NFR-02).
    const assignments = [];
    const values = [];

    const set = (column, value) => {
      values.push(value);
      assignments.push(`${column} = $${values.length}`);
    };

    if (changes.title !== undefined) set('title', changes.title);
    if (changes.description !== undefined) set('description', changes.description);
    if (changes.colour !== undefined) set('colour', changes.colour);
    if (changes.brand !== undefined) set('brand', changes.brand);
    if (changes.categoryId !== undefined) set('category_id', changes.categoryId);
    if (changes.eventTime !== undefined) set('event_time', changes.eventTime);
    if (changes.locationName !== undefined) set('location_name', changes.locationName);

    if (hasCoordinates) {
      const latitude = changes.latitude ?? null;
      const longitude = changes.longitude ?? null;
      const coordinateError = validateCoordinatePair(latitude, longitude);
      if (coordinateError) throw badRequest(coordinateError);

      if (latitude === null && longitude === null) {
        assignments.push('location = NULL');
      } else {
        values.push(`SRID=4326;POINT(${longitude} ${latitude})`);
        assignments.push(`location = $${values.length}::geography`);
      }
    }

    if (assignments.length > 0) {
      values.push(itemId);
      await client.query(
        `UPDATE items SET ${assignments.join(', ')} WHERE item_id = $${values.length}`,
        values
      );
    }

    if (changes.verificationHint !== undefined) {
      if (changes.verificationHint === null) {
        await client.query('DELETE FROM item_private_details WHERE item_id = $1', [itemId]);
      } else {
        await client.query(
          `INSERT INTO item_private_details (item_id, verification_hint)
           VALUES ($1, $2)
           ON CONFLICT (item_id) DO UPDATE SET verification_hint = EXCLUDED.verification_hint`,
          [itemId, changes.verificationHint]
        );
      }
    }

    await auditService.record(
      {
        actorUserId: actor.userId,
        action: auditService.AUDIT_ACTIONS.ITEM_UPDATED,
        entityType: 'item',
        entityId: itemId,
        metadata: { changedFields: Object.keys(changes) },
      },
      client
    );

    // FR-13/spec 13.1 step 10: relevant report changes trigger recalculation.
    await matchingService.recalculateForItem(itemId, { actorUserId: actor.userId, client });

    return getItemById(itemId, actor, true, client);
  });
}

/**
 * Validates and applies a status transition (FR-21).
 */
export async function updateStatus(itemId, nextStatus, actor) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT item_id, reporter_id, status, deleted_at FROM items WHERE item_id = $1 FOR UPDATE`,
      [itemId]
    );
    if (rows.length === 0) throw notFound(`Report ${itemId} was not found.`);

    const item = rows[0];
    if (item.deleted_at) throw badRequest('Deleted reports cannot change status.');
    if (actor.role !== 'admin' && actor.userId !== item.reporter_id) {
      throw forbidden('You may only change the status of your own reports.');
    }
    if (!ITEM_STATUSES.includes(nextStatus)) {
      throw badRequest(`"${nextStatus}" is not a valid item status.`);
    }
    if (!canTransition(item.status, nextStatus)) {
      throw conflict(
        `Cannot change status from "${item.status}" to "${nextStatus}".`,
        { allowed: ALLOWED_TRANSITIONS[item.status] ?? [] }
      );
    }

    // Only administrators may move a report to "rejected" (that is a moderation
    // decision); reporters close or withdraw their own reports.
    if (nextStatus === 'rejected' && actor.role !== 'admin') {
      throw forbidden('Only administrators can reject a report.');
    }

    const closingStatuses = new Set(['returned', 'closed', 'rejected']);
    await client.query(
      `UPDATE items
          SET status = $1,
              closed_at = CASE WHEN $2::boolean THEN now() ELSE NULL END
        WHERE item_id = $3`,
      [nextStatus, closingStatuses.has(nextStatus), itemId]
    );

    await auditService.record(
      {
        actorUserId: actor.userId,
        action: auditService.AUDIT_ACTIONS.ITEM_STATUS_CHANGED,
        entityType: 'item',
        entityId: itemId,
        metadata: { from: item.status, to: nextStatus },
      },
      client
    );

    return getItemById(itemId, actor, true, client);
  });
}

/**
 * Soft-deletes a report: the row stays for audit and claim history, but it
 * disappears from every public query (spec 12.2 "prefer report closure/soft
 * deletion ... preserve audit history").
 */
export async function softDeleteItem(itemId, actor) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT item_id, reporter_id, status, deleted_at FROM items WHERE item_id = $1 FOR UPDATE`,
      [itemId]
    );
    if (rows.length === 0) throw notFound(`Report ${itemId} was not found.`);

    const item = rows[0];
    if (item.deleted_at) throw conflict('This report has already been deleted.');
    if (actor.role !== 'admin' && actor.userId !== item.reporter_id) {
      throw forbidden('You may only delete your own reports.');
    }

    const openClaims = await client.query(
      `SELECT 1 FROM claims WHERE item_id = $1 AND status IN ('pending', 'approved')`,
      [itemId]
    );
    if (openClaims.rows.length > 0) {
      throw conflict('This report has an active claim and cannot be deleted.');
    }

    await client.query('UPDATE items SET deleted_at = now() WHERE item_id = $1', [itemId]);
    await auditService.record(
      {
        actorUserId: actor.userId,
        action: auditService.AUDIT_ACTIONS.ITEM_SOFT_DELETED,
        entityType: 'item',
        entityId: itemId,
        metadata: { previousStatus: item.status },
      },
      client
    );
    return true;
  });
}

/** Current user's own reports (FR-17), including soft-deleted ones they own. */
export async function listOwnItems(userId, filters) {
  const { page, limit, offset } = parsePagination(filters);
  const conditions = ['i.reporter_id = $1'];
  const values = [userId];

  if (filters.reportType) {
    values.push(filters.reportType);
    conditions.push(`i.report_type = $${values.length}`);
  }
  if (filters.status) {
    values.push(filters.status);
    conditions.push(`i.status = $${values.length}`);
  }
  if (!filters.includeDeleted) {
    conditions.push('i.deleted_at IS NULL');
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const countResult = await query(`SELECT COUNT(*)::bigint AS total FROM items i ${where}`, values);
  values.push(limit, offset);

  // This reads `items` directly rather than v_public_items: the owner is allowed
  // to see their own soft-deleted reports, and the view filters those out by
  // design. Column aliases match the view so the same mapper can be reused.
  const { rows } = await query(
    `SELECT i.item_id, i.report_type, i.title, i.description, i.colour, i.brand,
            i.event_time, i.location_name, i.status, i.created_at, i.updated_at, i.closed_at,
            i.deleted_at, i.category_id, c.name AS category_name,
            i.reporter_id, u.full_name AS reporter_name,
            CASE WHEN i.location IS NULL THEN NULL ELSE ST_Y(i.location::geometry) END AS latitude,
            CASE WHEN i.location IS NULL THEN NULL ELSE ST_X(i.location::geometry) END AS longitude
       FROM items i
       JOIN users u      ON u.user_id     = i.reporter_id
       JOIN categories c ON c.category_id = i.category_id
       ${where}
      ORDER BY i.created_at DESC, i.item_id DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  const items = rows.map((row) => ({ ...mapItemRow(row), deletedAt: row.deleted_at }));
  const total = countResult.rows[0].total;
  const withImages = await attachImages(items);
  return { items: withImages, meta: buildPageMeta({ page, limit, total }) };
}

/**
 * Attaches an uploaded image to a report (FR-09).
 * `file` is the multer file object already validated by handleImageUpload.
 */
export async function addImage(itemId, file, actor) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT item_id, reporter_id FROM items WHERE item_id = $1 AND deleted_at IS NULL`,
      [itemId]
    );
    if (rows.length === 0) throw notFound(`Report ${itemId} was not found.`);
    if (actor.role !== 'admin' && actor.userId !== rows[0].reporter_id) {
      throw forbidden('You may only add images to your own reports.');
    }

    const { rows: imageRows } = await client.query(
      `INSERT INTO item_images (item_id, storage_key, mime_type, byte_size, alt_text)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING image_id, storage_key, mime_type, byte_size, alt_text, uploaded_at`,
      [
        itemId,
        file.filename,
        file.detectedMimeType ?? file.mimetype,
        file.size,
        file.originalname ? file.originalname.slice(0, 200) : null,
      ]
    );

    await auditService.record(
      {
        actorUserId: actor.userId,
        action: auditService.AUDIT_ACTIONS.IMAGE_UPLOADED,
        entityType: 'item',
        entityId: itemId,
        metadata: { imageId: imageRows[0].image_id, mimeType: imageRows[0].mime_type, byteSize: imageRows[0].byte_size },
      },
      client
    );

    const image = imageRows[0];
    return {
      imageId: image.image_id,
      imageUrl: `/uploads/${image.storage_key}`,
      storageKey: image.storage_key,
      mimeType: image.mime_type,
      byteSize: image.byte_size,
      altText: image.alt_text,
      uploadedAt: image.uploaded_at,
    };
  });
}

/** Removes an image and deletes the stored file. */
export async function deleteImage(itemId, imageId, actor) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT im.storage_key, i.reporter_id
         FROM item_images im
         JOIN items i ON i.item_id = im.item_id
        WHERE im.image_id = $1 AND im.item_id = $2
        FOR UPDATE`,
      [imageId, itemId]
    );
    if (rows.length === 0) throw notFound(`Image ${imageId} was not found on report ${itemId}.`);
    if (actor.role !== 'admin' && actor.userId !== rows[0].reporter_id) {
      throw forbidden('You may only remove images from your own reports.');
    }

    await client.query('DELETE FROM item_images WHERE image_id = $1', [imageId]);
    removeStoredFile(rows[0].storage_key);

    await auditService.record(
      {
        actorUserId: actor.userId,
        action: 'item.image_deleted',
        entityType: 'item',
        entityId: itemId,
        metadata: { imageId },
      },
      client
    );
    return true;
  });
}

/** Category lookup used by the UI forms. */
export async function listCategories() {
  const { rows } = await query(
    `SELECT c.category_id, c.name, c.description, COUNT(i.item_id)::bigint AS item_count
       FROM categories c
       LEFT JOIN items i ON i.category_id = c.category_id AND i.deleted_at IS NULL
      GROUP BY c.category_id, c.name, c.description
      ORDER BY c.name ASC`
  );
  return rows.map((row) => ({
    categoryId: row.category_id,
    name: row.name,
    description: row.description,
    itemCount: row.item_count,
  }));
}

export { ALLOWED_TRANSITIONS as ITEM_TRANSITIONS };
export default {
  ALLOWED_TRANSITIONS,
  REPORT_TYPES,
  ITEM_STATUSES,
  canTransition,
  mapItemRow,
  searchItems,
  getItemById,
  createItem,
  updateItem,
  updateStatus,
  softDeleteItem,
  listOwnItems,
  addImage,
  deleteImage,
  listCategories,
};
