/**
 * Items routes (spec 14 "Items").
 *
 *   GET    /api/v1/items                     public search (filters + pagination)
 *   GET    /api/v1/items/:itemId             public details, no private evidence
 *   POST   /api/v1/items                     authenticated create
 *   PATCH  /api/v1/items/:itemId             owner or admin update
 *   PATCH  /api/v1/items/:itemId/status      validated status transition
 *   DELETE /api/v1/items/:itemId             soft delete (owner or admin)
 *   POST   /api/v1/items/:itemId/images      upload an image (owner or admin)
 *   DELETE /api/v1/items/:itemId/images/:imageId
 *   GET    /api/v1/users/me/items            current user's reports
 *   GET    /api/v1/categories                category lookup for the UI
 */
import { Router } from 'express';
import { authenticate, optionalAuthenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { handleImageUpload } from '../../middleware/upload.js';
import * as controller from './items.controller.js';
import { requireItemAccess } from './items.middleware.js';
import {
  createItemSchema,
  updateItemSchema,
  updateStatusSchema,
  listItemsQuerySchema,
  listOwnItemsQuerySchema,
  itemIdParamSchema,
  imageParamSchema,
} from './items.validation.js';

export const itemsRouter = Router();

itemsRouter.get('/', optionalAuthenticate, validate({ query: listItemsQuerySchema }), controller.list);

itemsRouter.post(
  '/',
  authenticate,
  validate({ body: createItemSchema }),
  controller.create
);

itemsRouter.get(
  '/:itemId',
  optionalAuthenticate,
  validate({ params: itemIdParamSchema }),
  controller.getOne
);

itemsRouter.patch(
  '/:itemId',
  authenticate,
  validate({ params: itemIdParamSchema, body: updateItemSchema }),
  requireItemAccess(),
  controller.update
);

itemsRouter.patch(
  '/:itemId/status',
  authenticate,
  validate({ params: itemIdParamSchema, body: updateStatusSchema }),
  requireItemAccess(),
  controller.updateStatus
);

itemsRouter.delete(
  '/:itemId',
  authenticate,
  validate({ params: itemIdParamSchema }),
  requireItemAccess(),
  controller.remove
);

itemsRouter.post(
  '/:itemId/images',
  authenticate,
  validate({ params: itemIdParamSchema }),
  requireItemAccess(),
  handleImageUpload,
  controller.uploadImage
);

itemsRouter.delete(
  '/:itemId/images/:imageId',
  authenticate,
  validate({ params: imageParamSchema }),
  requireItemAccess(),
  controller.deleteImage
);

/** Separate router mounted at /users/me/items. */
export const myItemsRouter = Router();

myItemsRouter.get(
  '/',
  authenticate,
  validate({ query: listOwnItemsQuerySchema }),
  controller.listMine
);

/** Separate router mounted at /categories. */
export const categoriesRouter = Router();

categoriesRouter.get('/', controller.listCategories);

export default { itemsRouter, myItemsRouter, categoriesRouter };
