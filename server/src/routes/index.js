/**
 * Versioned API router: everything the client can call lives under /api/v1.
 * Keeping the version in one place makes a future /api/v2 additive (spec 10).
 */
import { Router } from 'express';
import authRouter from '../modules/auth/auth.routes.js';
import { itemsRouter, myItemsRouter, categoriesRouter } from '../modules/items/items.routes.js';
import { matchesRouter, itemMatchesRouter } from '../modules/matches/matches.routes.js';
import { claimsRouter, itemClaimsRouter, adminClaimsRouter } from '../modules/claims/claims.routes.js';
import notificationsRouter from '../modules/notifications/notifications.routes.js';
import adminRouter from '../modules/admin/admin.routes.js';
import healthRouter from '../modules/health/health.routes.js';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/categories', categoriesRouter);
apiRouter.use('/users/me/items', myItemsRouter);

// Nested resources are mounted before their parent router so the more specific
// paths win, and they carry their own authorization checks.
apiRouter.use('/items/:itemId/matches', itemMatchesRouter);
apiRouter.use('/items/:itemId/claims', itemClaimsRouter);
apiRouter.use('/items', itemsRouter);

apiRouter.use('/matches', matchesRouter);
apiRouter.use('/claims', claimsRouter);
apiRouter.use('/notifications', notificationsRouter);

apiRouter.use('/admin/claims', adminClaimsRouter);
apiRouter.use('/admin', adminRouter);

export default apiRouter;
