/**
 * Claims routes (spec 14 "Claims").
 *
 *   POST   /api/v1/items/:itemId/claims          submit a claim (authenticated)
 *   GET    /api/v1/claims/me                     current user's claims
 *   POST   /api/v1/claims/:claimId/withdraw      withdraw a pending claim
 *   GET    /api/v1/admin/claims                  administrator review queue
 *   GET    /api/v1/admin/claims/:claimId         one claim with verification hint
 *   PATCH  /api/v1/admin/claims/:claimId         approve / reject (admin)
 */
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAdmin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendOk, sendCreated } from '../../utils/respond.js';
import { notFound } from '../../utils/httpError.js';
import * as claimsService from './claims.service.js';

const claimIdParamSchema = z.object({ claimId: z.coerce.number().int().positive() });
const itemIdParamSchema = z.object({ itemId: z.coerce.number().int().positive() });

const submitClaimSchema = z.object({
  claimMessage: z.string().trim().min(10, 'Describe your ownership in at least 10 characters').max(2000),
  privateEvidence: z.string().trim().max(2000).nullish(),
});

const myClaimsQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'withdrawn']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const queueQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'withdrawn']).optional(),
  includeDecided: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  itemId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const decisionSchema = z
  .object({
    decision: z.enum(['approved', 'rejected']),
    reviewReason: z.string().trim().max(1000).nullish(),
  })
  .refine((value) => value.decision !== 'rejected' || (value.reviewReason && value.reviewReason.length > 0), {
    path: ['reviewReason'],
    message: 'A reviewReason is required when rejecting a claim',
  });

// ---------------------------------------------------------------------------
// User-facing routes
// ---------------------------------------------------------------------------
export const claimsRouter = Router();

claimsRouter.get(
  '/me',
  authenticate,
  validate({ query: myClaimsQuerySchema }),
  asyncHandler(async (req, res) => {
    const { rows, meta } = await claimsService.listMyClaims(
      req.user.userId,
      req.validatedQuery ?? req.query
    );
    return sendOk(res, rows, meta);
  })
);

claimsRouter.post(
  '/:claimId/withdraw',
  authenticate,
  validate({ params: claimIdParamSchema }),
  asyncHandler(async (req, res) => {
    const claim = await claimsService.withdrawClaim(Number(req.params.claimId), req.user);
    return sendOk(res, claim);
  })
);

/** Mounted at /api/v1/items/:itemId/claims. */
export const itemClaimsRouter = Router({ mergeParams: true });

itemClaimsRouter.post(
  '/',
  authenticate,
  validate({ params: itemIdParamSchema, body: submitClaimSchema }),
  asyncHandler(async (req, res) => {
    const claim = await claimsService.submitClaim(Number(req.params.itemId), req.body, req.user);
    return sendCreated(res, claim, `/api/v1/claims/${claim.claimId}`);
  })
);

// ---------------------------------------------------------------------------
// Administrator routes (role enforced server-side by requireAdmin)
// ---------------------------------------------------------------------------
export const adminClaimsRouter = Router();

adminClaimsRouter.use(authenticate, requireAdmin);

adminClaimsRouter.get(
  '/',
  validate({ query: queueQuerySchema }),
  asyncHandler(async (req, res) => {
    const { rows, meta } = await claimsService.listClaimQueue(req.validatedQuery ?? req.query);
    return sendOk(res, rows, meta);
  })
);

adminClaimsRouter.get(
  '/:claimId',
  validate({ params: claimIdParamSchema }),
  asyncHandler(async (req, res) => {
    const claim = await claimsService.getClaimForReview(Number(req.params.claimId));
    if (!claim) throw notFound(`Claim ${req.params.claimId} was not found.`);
    return sendOk(res, claim);
  })
);

adminClaimsRouter.patch(
  '/:claimId',
  validate({ params: claimIdParamSchema, body: decisionSchema }),
  asyncHandler(async (req, res) => {
    const claim = await claimsService.decideClaim(Number(req.params.claimId), req.body, req.user);
    return sendOk(res, claim);
  })
);

export default { claimsRouter, itemClaimsRouter, adminClaimsRouter };
