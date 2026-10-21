/**
 * Authentication routes (spec 14 "Authentication").
 *
 *   POST /api/v1/auth/register   create an account
 *   POST /api/v1/auth/login      authenticate and receive a JWT
 *   GET  /api/v1/auth/me         current profile (protected)
 *   POST /api/v1/auth/change-password
 *
 * The register/login endpoints are rate limited because they are the only
 * unauthenticated write paths (spec 16).
 */
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { authLimiter } from '../../middleware/rateLimit.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendOk, sendCreated } from '../../utils/respond.js';
import { PASSWORD_POLICY, isPasswordAcceptable } from '../../utils/password.js';
import * as authService from './auth.service.js';

const passwordSchema = z
  .string()
  .min(PASSWORD_POLICY.minLength, `Password must be at least ${PASSWORD_POLICY.minLength} characters`)
  .max(PASSWORD_POLICY.maxLength)
  .refine(isPasswordAcceptable, { message: `Password must contain ${PASSWORD_POLICY.description}` });

const registerSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email('A valid email address is required').max(254),
  password: passwordSchema,
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('A valid email address is required').max(254),
  password: z.string().min(1, 'Password is required').max(PASSWORD_POLICY.maxLength),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_POLICY.maxLength),
  newPassword: passwordSchema,
});

export const authRouter = Router();

authRouter.post(
  '/register',
  authLimiter,
  validate({ body: registerSchema }),
  asyncHandler(async (req, res) => {
    const result = await authService.register(req.body);
    return sendCreated(res, result, '/api/v1/auth/me');
  })
);

authRouter.post(
  '/login',
  authLimiter,
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const result = await authService.login(req.body);
    return sendOk(res, result);
  })
);

authRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const profile = await authService.getProfile(req.user.userId);
    return sendOk(res, profile);
  })
);

authRouter.post(
  '/change-password',
  authenticate,
  validate({ body: changePasswordSchema }),
  asyncHandler(async (req, res) => {
    await authService.changePassword(req.user.userId, req.body);
    return sendOk(res, { changed: true });
  })
);

export default authRouter;
