/**
 * Matches module (spec 14 "Matches").
 *
 *   GET  /api/v1/matches                       matches relevant to the current user
 *   GET  /api/v1/items/:itemId/matches         matches for one report (owner/admin)
 *   POST /api/v1/matches/:matchId/dismiss      dismiss a suggestion
 *   POST /api/v1/matches/recalculate           recalculate candidates
 */
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendOk } from '../../utils/respond.js';
import { forbidden, notFound } from '../../utils/httpError.js';
import { query } from '../../config/db.js';
import * as matchingService from '../../services/matching.service.js';
import * as itemsService from '../items/items.service.js';

const listMatchesQuerySchema = z.object({
  status: z.enum(['suggested', 'dismissed', 'claimed', 'resolved']).optional(),
  itemId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const itemMatchQuerySchema = z.object({
  status: z.enum(['suggested', 'dismissed', 'claimed', 'resolved']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const matchIdParamSchema = z.object({ matchId: z.coerce.number().int().positive() });
const itemIdParamSchema = z.object({ itemId: z.coerce.number().int().positive() });

const recalculateSchema = z.object({
  itemId: z.number().int().positive().optional(),
  all: z.boolean().optional(),
});

/**
 * Loads the match and confirms the caller is a reporter of one of its items (or
 * an administrator). Prevents users from dismissing matches between two reports
 * that are not theirs.
 */
const requireMatchAccess = asyncHandler(async (req, _res, next) => {
  const matchId = Number(req.params.matchId);
  const raw = await matchingService.findMatchById(matchId);
  if (!raw) throw notFound(`Match ${matchId} was not found.`);

  const isParticipant =
    raw.lost_reporter_id === req.user.userId || raw.found_reporter_id === req.user.userId;
  if (req.user.role !== 'admin' && !isParticipant) {
    throw forbidden('You can only manage matches for your own reports.');
  }

  req.match = raw;
  return next();
});

export const matchesRouter = Router();

matchesRouter.get(
  '/',
  authenticate,
  validate({ query: listMatchesQuerySchema }),
  asyncHandler(async (req, res) => {
    const params = req.validatedQuery ?? req.query;
    const offset = (params.page - 1) * params.limit;
    const { rows, total } = await matchingService.listForUser(req.user.userId, { ...params, offset });
    return sendOk(res, rows, {
      page: params.page,
      limit: params.limit,
      total,
      totalPages: Math.ceil(total / params.limit) || 0,
      hasNextPage: params.page * params.limit < total,
      hasPreviousPage: params.page > 1,
    });
  })
);

matchesRouter.post(
  '/recalculate',
  authenticate,
  validate({ body: recalculateSchema }),
  asyncHandler(async (req, res) => {
    const { itemId, all = false } = req.body;

    // A specific item: the caller must own it (or be an admin).
    if (itemId) {
      const item = await itemsService.getItemById(itemId, req.user, true);
      if (!item) throw notFound(`Report ${itemId} was not found.`);
      if (req.user.role !== 'admin' && item.reporter.userId !== req.user.userId) {
        throw forbidden('You can only recalculate matches for your own reports.');
      }
      const summary = await matchingService.recalculateForItem(itemId, {
        actorUserId: req.user.userId,
        notify: true,
      });
      return sendOk(res, summary);
    }

    // No itemId: recalculate the caller's own open reports. Only administrators
    // may recalculate the whole database.
    if (all && req.user.role !== 'admin') {
      throw forbidden('Only administrators can recalculate all reports.');
    }
    const summary = await matchingService.recalculateForUser({
      userId: req.user.userId,
      all: Boolean(all),
      actorUserId: req.user.userId,
    });
    return sendOk(res, summary);
  })
);

matchesRouter.post(
  '/:matchId/dismiss',
  authenticate,
  validate({ params: matchIdParamSchema }),
  requireMatchAccess,
  asyncHandler(async (req, res) => {
    const match = await matchingService.dismissMatch(Number(req.params.matchId), {
      actorUserId: req.user.userId,
    });
    return sendOk(res, match);
  })
);

/** Mounted at /api/v1/items/:itemId/matches. */
export const itemMatchesRouter = Router({ mergeParams: true });

itemMatchesRouter.get(
  '/',
  authenticate,
  validate({ params: itemIdParamSchema, query: itemMatchQuerySchema }),
  asyncHandler(async (req, res) => {
    const itemId = Number(req.params.itemId);

    // Authorization: only the reporter of the item (or an admin) may read the
    // candidate list for a report.
    const { rows: ownerRows } = await query(
      `SELECT reporter_id, deleted_at FROM items WHERE item_id = $1`,
      [itemId]
    );
    if (ownerRows.length === 0) throw notFound(`Report ${itemId} was not found.`);
    if (
      req.user.role !== 'admin' &&
      ownerRows[0].reporter_id !== req.user.userId
    ) {
      throw forbidden('You can only view matches for your own reports.');
    }

    const params = req.validatedQuery ?? req.query;
    const offset = (params.page - 1) * params.limit;
    const { rows, total } = await matchingService.listForItem(itemId, {
      ...params,
      offset,
      viewerUserId: req.user.userId,
    });

    return sendOk(res, rows, {
      page: params.page,
      limit: params.limit,
      total,
      totalPages: Math.ceil(total / params.limit) || 0,
      hasNextPage: params.page * params.limit < total,
      hasPreviousPage: params.page > 1,
    });
  })
);

export default { matchesRouter, itemMatchesRouter };
