/**
 * Request validation schemas for the items module (zod).
 *
 * Every bound here mirrors a database constraint, so invalid data is rejected
 * with a friendly 422 before it ever reaches PostgreSQL.
 */
import { z } from 'zod';
import { ALLOWED_TRANSITIONS } from './items.service.js';

const reportType = z.enum(['lost', 'found']);
const itemStatus = z.enum(['open', 'matched', 'claimed', 'returned', 'closed', 'rejected']);

const latitude = z
  .number()
  .min(-90, 'latitude must be between -90 and 90')
  .max(90, 'latitude must be between -90 and 90');

const longitude = z
  .number()
  .min(-180, 'longitude must be between -180 and 180')
  .max(180, 'longitude must be between -180 and 180');

/** Ensures latitude and longitude are provided together (or both omitted). */
function requireCoordinatePair(value, ctx) {
  const hasLat = value.latitude !== undefined && value.latitude !== null;
  const hasLon = value.longitude !== undefined && value.longitude !== null;
  if (hasLat !== hasLon) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: hasLat ? ['longitude'] : ['latitude'],
      message: 'latitude and longitude must be provided together',
    });
  }
}

const trimmed = (max, min = 1) => z.string().trim().min(min).max(max);

export const createItemSchema = z
  .object({
    reportType,
    categoryId: z.number().int().positive(),
    title: trimmed(200, 3),
    description: trimmed(5000, 10),
    colour: trimmed(50).nullish(),
    brand: trimmed(100).nullish(),
    eventTime: z.coerce.date(),
    locationName: trimmed(200).nullish(),
    latitude: latitude.nullish(),
    longitude: longitude.nullish(),
    verificationHint: trimmed(500).nullish(),
  })
  .superRefine(requireCoordinatePair);

export const updateItemSchema = z
  .object({
    // Accepted so that an attempt to change it produces a precise 400 from the
    // service instead of being silently dropped by validation.
    reportType: reportType.optional(),
    categoryId: z.number().int().positive().optional(),
    title: trimmed(200, 3).optional(),
    description: trimmed(5000, 10).optional(),
    colour: trimmed(50).nullish(),
    brand: trimmed(100).nullish(),
    eventTime: z.coerce.date().optional(),
    locationName: trimmed(200).nullish(),
    latitude: latitude.nullish(),
    longitude: longitude.nullish(),
    verificationHint: trimmed(500).nullish(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  })
  .superRefine(requireCoordinatePair);

export const updateStatusSchema = z.object({
  status: itemStatus,
});

export const listItemsQuerySchema = z
  .object({
    type: reportType.optional(),
    categoryId: z.coerce.number().int().positive().optional(),
    status: itemStatus.optional(),
    colour: trimmed(50).optional(),
    brand: trimmed(100).optional(),
    q: z.string().trim().max(200).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
    radiusMeters: z.coerce.number().positive().max(200_000).optional(),
    reporterId: z.coerce.number().int().positive().optional(),
    sort: z.enum(['recent', 'relevance', 'distance', 'event_time']).default('recent'),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  })
  .superRefine(requireCoordinatePair);

export const listOwnItemsQuerySchema = z
  .object({
    type: reportType.optional(),
    status: itemStatus.optional(),
    includeDeleted: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  })
  .passthrough();

export const itemIdParamSchema = z.object({
  itemId: z.coerce.number().int().positive(),
});

export const imageParamSchema = z.object({
  itemId: z.coerce.number().int().positive(),
  imageId: z.coerce.number().int().positive(),
});

/** Exposed for documentation and tests. */
export const TRANSITIONS = ALLOWED_TRANSITIONS;
