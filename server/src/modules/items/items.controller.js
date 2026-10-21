/**
 * Items controller — thin HTTP layer over items.service.
 * No SQL and no business rules live here.
 */
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendOk, sendCreated, sendNoContent } from '../../utils/respond.js';
import { notFound } from '../../utils/httpError.js';
import * as itemsService from './items.service.js';

const query = (req) => req.validatedQuery ?? req.query;

export const list = asyncHandler(async (req, res) => {
  const { items, meta } = await itemsService.searchItems(query(req));
  return sendOk(res, items, meta);
});

export const listMine = asyncHandler(async (req, res) => {
  const { items, meta } = await itemsService.listOwnItems(req.user.userId, query(req));
  return sendOk(res, items, meta);
});

export const getOne = asyncHandler(async (req, res) => {
  const viewer = req.user ?? {};
  const includeDeleted = req.user?.role === 'admin';
  const item = await itemsService.getItemById(Number(req.params.itemId), viewer, includeDeleted);
  if (!item) throw notFound(`Report ${req.params.itemId} was not found.`);
  return sendOk(res, item);
});

export const create = asyncHandler(async (req, res) => {
  const item = await itemsService.createItem(req.body, req.user.userId);
  return sendCreated(res, item, `/api/v1/items/${item.itemId}`);
});

export const update = asyncHandler(async (req, res) => {
  const item = await itemsService.updateItem(Number(req.params.itemId), req.body, req.user);
  return sendOk(res, item);
});

export const updateStatus = asyncHandler(async (req, res) => {
  const item = await itemsService.updateStatus(Number(req.params.itemId), req.body.status, req.user);
  return sendOk(res, item);
});

export const remove = asyncHandler(async (req, res) => {
  await itemsService.softDeleteItem(Number(req.params.itemId), req.user);
  return sendNoContent(res);
});

export const uploadImage = asyncHandler(async (req, res) => {
  if (!req.file) throw notFound('No image file was included in the request (expected field "image").');
  const image = await itemsService.addImage(Number(req.params.itemId), req.file, req.user);
  return sendCreated(res, image, `/api/v1/items/${req.params.itemId}/images/${image.imageId}`);
});

export const deleteImage = asyncHandler(async (req, res) => {
  await itemsService.deleteImage(Number(req.params.itemId), Number(req.params.imageId), req.user);
  return sendNoContent(res);
});

export const listCategories = asyncHandler(async (_req, res) => {
  const categories = await itemsService.listCategories();
  return sendOk(res, categories);
});

export default {
  list,
  listMine,
  getOne,
  create,
  update,
  updateStatus,
  remove,
  uploadImage,
  deleteImage,
  listCategories,
};
