/**
 * Administration routes (spec 14 "Administration and Health").
 *
 *   GET   /api/v1/admin/items                      moderation queue
 *   GET   /api/v1/admin/items/:itemId              report detail incl. private hint
 *   PATCH /api/v1/admin/items/:itemId/moderation   approve / reject / close
 *   GET   /api/v1/admin/audit-logs                 audit listing
 *   GET   /api/v1/admin/stats                      database-backed counters
 *   GET   /api/v1/admin/users                      account listing
 *
 * All routes are protected by authenticate + requireAdmin, and every state change
 * is written to audit_logs.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAdmin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendOk } from '../../utils/respond.js';
import { notFound, badRequest, conflict } from '../../utils/httpError.js';
import { query, withTransaction } from '../../config/db.js';
import { parsePagination, buildPageMeta } from '../../utils/pagination.js';
import { canTransition, ALLOWED_TRANSITIONS } from '../items/items.service.js';
import * as auditService from '../../services/audit.service.js';
import * as notificationService from '../../services/notification.service.js';

const itemIdParamSchema = z.object({ itemId: z.coerce.number().int().positive() });

const moderationSchema = z
  .object({
    action: z.enum(['approve', 'reject', 'close']),
    reason: z.string().trim().max(1000).nullish(),
  })
  .refine((value) => value.action !== 'reject' || (value.reason && value.reason.length > 0), {
    path: ['reason'],
    message: 'A reason is required when rejecting a report',
  });

const adminItemsQuerySchema = z.object({
  type: z.enum(['lost', 'found']).optional(),
  status: z.enum(['open', 'matched', 'claimed', 'returned', 'closed', 'rejected']).optional(),
  reporterId: z.coerce.number().int().positive().optional(),
  includeDeleted: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const auditQuerySchema = z.object({
  actorUserId: z.coerce.number().int().positive().optional(),
  action: z.string().trim().max(60).optional(),
  entityType: z.string().trim().max(40).optional(),
  entityId: z.coerce.number().int().positive().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const usersQuerySchema = z.object({
  role: z.enum(['user', 'admin']).optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const adminRouter = Router();

adminRouter.use(authenticate, requireAdmin);

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
adminRouter.get(
  '/items',
  validate({ query: adminItemsQuerySchema }),
  asyncHandler(async (req, res) => {
    const params = req.validatedQuery ?? req.query;
    const { page, limit, offset } = parsePagination(params);

    const conditions = [];
    const values = [];
    if (params.type) {
      values.push(params.type);
      conditions.push(`i.report_type = $${values.length}`);
    }
    if (params.status) {
      values.push(params.status);
      conditions.push(`i.status = $${values.length}`);
    }
    if (params.reporterId) {
      values.push(params.reporterId);
      conditions.push(`i.reporter_id = $${values.length}`);
    }
    if (!params.includeDeleted) conditions.push('i.deleted_at IS NULL');

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countResult = await query(`SELECT COUNT(*)::bigint AS total FROM items i ${where}`, values);
    values.push(limit, offset);

    const { rows } = await query(
      `SELECT v.*, i.deleted_at,
              d.verification_hint IS NOT NULL AS has_private_details,
              COALESCE(s.match_count, 0)          AS match_count,
              COALESCE(s.suggested_count, 0)      AS suggested_count,
              COALESCE(cl.pending_claims, 0)      AS pending_claims
         FROM items i
         JOIN v_public_items v ON v.item_id = i.item_id
         LEFT JOIN item_private_details d ON d.item_id = i.item_id
         LEFT JOIN v_item_match_stats s ON s.item_id = i.item_id
         LEFT JOIN (
           SELECT item_id, COUNT(*)::bigint AS pending_claims
             FROM claims WHERE status = 'pending' GROUP BY item_id
         ) cl ON cl.item_id = i.item_id
         ${where}
        ORDER BY i.created_at DESC, i.item_id DESC
        LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );

    const items = rows.map((row) => ({
      itemId: row.item_id,
      reportType: row.report_type,
      title: row.title,
      description: row.description,
      colour: row.colour,
      brand: row.brand,
      eventTime: row.event_time,
      locationName: row.location_name,
      location: row.latitude === null ? null : { latitude: row.latitude, longitude: row.longitude },
      status: row.status,
      category: { categoryId: row.category_id, name: row.category_name },
      reporter: { userId: row.reporter_id, fullName: row.reporter_name },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      closedAt: row.closed_at,
      deletedAt: row.deleted_at,
      hasPrivateDetails: row.has_private_details,
      matchCount: row.match_count,
      suggestedCount: row.suggested_count,
      pendingClaims: row.pending_claims,
    }));

    return sendOk(res, items, buildPageMeta({ page, limit, total: countResult.rows[0].total }));
  })
);

adminRouter.get(
  '/items/:itemId',
  validate({ params: itemIdParamSchema }),
  asyncHandler(async (req, res) => {
    const itemId = Number(req.params.itemId);
    const { rows } = await query(
      `SELECT v.*, i.deleted_at, d.verification_hint, d.created_at AS private_detail_created_at
         FROM items i
         JOIN v_public_items v ON v.item_id = i.item_id
         LEFT JOIN item_private_details d ON d.item_id = i.item_id
        WHERE i.item_id = $1`,
      [itemId]
    );
    if (rows.length === 0) throw notFound(`Report ${itemId} was not found.`);

    const row = rows[0];
    const claims = await query(
      `SELECT cl.claim_id, cl.status, cl.claim_message, cl.created_at,
              cu.full_name AS claimant_name, cu.user_id AS claimant_id,
              cl.reviewed_at, cl.review_reason
         FROM claims cl
         JOIN users cu ON cu.user_id = cl.claimant_id
        WHERE cl.item_id = $1
        ORDER BY cl.created_at DESC`,
      [itemId]
    );

    return sendOk(res, {
      itemId: row.item_id,
      reportType: row.report_type,
      title: row.title,
      description: row.description,
      colour: row.colour,
      brand: row.brand,
      eventTime: row.event_time,
      locationName: row.location_name,
      location: row.latitude === null ? null : { latitude: row.latitude, longitude: row.longitude },
      status: row.status,
      category: { categoryId: row.category_id, name: row.category_name },
      reporter: { userId: row.reporter_id, fullName: row.reporter_name },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      closedAt: row.closed_at,
      deletedAt: row.deleted_at,
      // Access-restricted: only administrators ever see the verification hint.
      privateDetails: {
        hasVerificationHint: row.verification_hint !== null,
        verificationHint: row.verification_hint ?? null,
      },
      // private_evidence of claims is deliberately NOT returned (spec 16).
      claims: claims.rows.map((claim) => ({
        claimId: claim.claim_id,
        status: claim.status,
        claimMessage: claim.claim_message,
        claimant: { userId: claim.claimant_id, fullName: claim.claimant_name },
        reviewedAt: claim.reviewed_at,
        reviewReason: claim.review_reason,
        createdAt: claim.created_at,
      })),
    });
  })
);

adminRouter.patch(
  '/items/:itemId/moderation',
  validate({ params: itemIdParamSchema, body: moderationSchema }),
  asyncHandler(async (req, res) => {
    const itemId = Number(req.params.itemId);
    const { action, reason } = req.body;

    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT item_id, reporter_id, title, status, deleted_at FROM items WHERE item_id = $1 FOR UPDATE`,
        [itemId]
      );
      if (rows.length === 0) throw notFound(`Report ${itemId} was not found.`);

      const item = rows[0];
      if (item.deleted_at) throw badRequest('This report has been deleted.');

      const nextStatus = action === 'approve' ? 'open' : action === 'reject' ? 'rejected' : 'closed';
      if (item.status === nextStatus) {
        throw badRequest(`This report already has status "${nextStatus}".`);
      }
      // Moderation obeys the same transition matrix as every other status change,
      // so an administrator cannot create an illegal lifecycle (spec 12.4).
      if (!canTransition(item.status, nextStatus)) {
        throw conflict(`Cannot change status from "${item.status}" to "${nextStatus}" via moderation.`, {
          allowed: ALLOWED_TRANSITIONS[item.status] ?? [],
        });
      }

      await client.query(
        `UPDATE items
            SET status = $1,
                closed_at = CASE WHEN $2::boolean THEN now() ELSE NULL END
          WHERE item_id = $3`,
        [nextStatus, nextStatus === 'closed' || nextStatus === 'rejected', itemId]
      );

      await auditService.record(
        {
          actorUserId: req.user.userId,
          action: auditService.AUDIT_ACTIONS.ITEM_MODERATED,
          entityType: 'item',
          entityId: itemId,
          metadata: { action, from: item.status, to: nextStatus, reason: reason ?? null },
        },
        client
      );

      await notificationService.create(
        {
          userId: item.reporter_id,
          type: notificationService.NOTIFICATION_TYPES.ITEM_MODERATED,
          title: `Your report was ${action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'closed'}`,
          message:
            `An administrator reviewed "${item.title}" and set its status to "${nextStatus}".` +
            (reason ? ` Reason: ${reason}` : ''),
          relatedItemId: itemId,
        },
        client
      );

      return { itemId, status: nextStatus, action, reason: reason ?? null };
    });

    return sendOk(res, result);
  })
);

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------
adminRouter.get(
  '/audit-logs',
  validate({ query: auditQuerySchema }),
  asyncHandler(async (req, res) => {
    const params = req.validatedQuery ?? req.query;
    const { page, limit, offset } = parsePagination(params);
    const { rows, total } = await auditService.list({ ...params, offset });
    return sendOk(res, rows, buildPageMeta({ page, limit, total }));
  })
);

// ---------------------------------------------------------------------------
// Counters and accounts
// ---------------------------------------------------------------------------
adminRouter.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const { rows } = await query(`
      SELECT
        (SELECT COUNT(*)::bigint FROM users)                                              AS total_users,
        (SELECT COUNT(*)::bigint FROM users WHERE is_active = FALSE)                       AS inactive_users,
        (SELECT COUNT(*)::bigint FROM items WHERE deleted_at IS NULL)                      AS total_items,
        (SELECT COUNT(*)::bigint FROM items WHERE report_type = 'lost' AND deleted_at IS NULL)  AS lost_items,
        (SELECT COUNT(*)::bigint FROM items WHERE report_type = 'found' AND deleted_at IS NULL) AS found_items,
        (SELECT COUNT(*)::bigint FROM items WHERE status = 'returned')                     AS returned_items,
        (SELECT COUNT(*)::bigint FROM matches)                                             AS total_matches,
        (SELECT COUNT(*)::bigint FROM matches WHERE match_status = 'suggested')             AS suggested_matches,
        (SELECT COUNT(*)::bigint FROM claims)                                             AS total_claims,
        (SELECT COUNT(*)::bigint FROM claims WHERE status = 'pending')                      AS pending_claims,
        (SELECT COUNT(*)::bigint FROM claims WHERE status = 'approved')                    AS approved_claims,
        (SELECT extversion FROM pg_extension WHERE extname = 'postgis')                     AS postgis_version
    `);

    const row = rows[0];
    return sendOk(res, {
      users: { total: row.total_users, inactive: row.inactive_users },
      items: {
        total: row.total_items,
        lost: row.lost_items,
        found: row.found_items,
        returned: row.returned_items,
      },
      matches: { total: row.total_matches, suggested: row.suggested_matches },
      claims: { total: row.total_claims, pending: row.pending_claims, approved: row.approved_claims },
      database: { postgisVersion: row.postgis_version },
    });
  })
);

adminRouter.get(
  '/users',
  validate({ query: usersQuerySchema }),
  asyncHandler(async (req, res) => {
    const params = req.validatedQuery ?? req.query;
    const { page, limit, offset } = parsePagination(params);

    const conditions = [];
    const values = [];
    if (params.role) {
      values.push(params.role);
      conditions.push(`role = $${values.length}`);
    }
    if (params.isActive !== undefined) {
      values.push(params.isActive);
      conditions.push(`is_active = $${values.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await query(`SELECT COUNT(*)::bigint AS total FROM users ${where}`, values);
    values.push(limit, offset);

    const { rows } = await query(
      `SELECT user_id, full_name, email, role, is_active, created_at
         FROM users ${where}
        ORDER BY created_at DESC, user_id DESC
        LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );

    const users = rows.map((row) => ({
      userId: row.user_id,
      fullName: row.full_name,
      email: row.email,
      role: row.role,
      isActive: row.is_active,
      createdAt: row.created_at,
    }));

    return sendOk(res, users, buildPageMeta({ page, limit, total: countResult.rows[0].total }));
  })
);

export default adminRouter;
