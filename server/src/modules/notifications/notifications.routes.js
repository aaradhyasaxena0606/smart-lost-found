/**
 * Notifications routes (spec 14 "Notifications").
 *
 *   GET   /api/v1/notifications                        current user's notifications
 *   GET   /api/v1/notifications/unread-count           badge count
 *   PATCH /api/v1/notifications/:notificationId/read   mark one as read
 *   PATCH /api/v1/notifications/read-all               mark all as read
 *
 * Every route is scoped to the authenticated user: there is no way to read or
 * modify another user's notifications.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendOk } from '../../utils/respond.js';
import { notFound } from '../../utils/httpError.js';
import * as notificationService from '../../services/notification.service.js';

const listQuerySchema = z.object({
  unreadOnly: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const notificationIdParamSchema = z.object({
  notificationId: z.coerce.number().int().positive(),
});

export const notificationsRouter = Router();

notificationsRouter.use(authenticate);

notificationsRouter.get(
  '/',
  validate({ query: listQuerySchema }),
  asyncHandler(async (req, res) => {
    const params = req.validatedQuery ?? req.query;
    const offset = (params.page - 1) * params.limit;
    const { rows, total, unreadCount } = await notificationService.listForUser(req.user.userId, {
      ...params,
      offset,
    });
    return sendOk(res, rows, {
      page: params.page,
      limit: params.limit,
      total,
      totalPages: Math.ceil(total / params.limit) || 0,
      unreadCount,
      hasNextPage: params.page * params.limit < total,
      hasPreviousPage: params.page > 1,
    });
  })
);

notificationsRouter.get(
  '/unread-count',
  asyncHandler(async (req, res) => {
    const unread = await notificationService.unreadCount(req.user.userId);
    return sendOk(res, { unreadCount: unread });
  })
);

notificationsRouter.patch(
  '/read-all',
  asyncHandler(async (req, res) => {
    const updated = await notificationService.markAllRead(req.user.userId);
    return sendOk(res, { updated });
  })
);

notificationsRouter.patch(
  '/:notificationId/read',
  validate({ params: notificationIdParamSchema }),
  asyncHandler(async (req, res) => {
    const ok = await notificationService.markRead(req.user.userId, Number(req.params.notificationId));
    if (!ok) throw notFound(`Notification ${req.params.notificationId} was not found.`);
    return sendOk(res, { notificationId: Number(req.params.notificationId), isRead: true });
  })
);

export default notificationsRouter;
