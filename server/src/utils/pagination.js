/**
 * Pagination helpers (NFR-08: every list endpoint is bounded).
 */
import { badRequest } from './httpError.js';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/**
 * Reads `page` and `limit` from a query object.
 * @param {Record<string, unknown>} query
 * @returns {{page: number, limit: number, offset: number}}
 */
export function parsePagination(query) {
  const page = query.page === undefined ? 1 : Number(query.page);
  const limit = query.limit === undefined ? DEFAULT_PAGE_SIZE : Number(query.limit);

  if (!Number.isInteger(page) || page < 1) {
    throw badRequest('Query parameter "page" must be a positive integer.');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw badRequest(`Query parameter "limit" must be an integer between 1 and ${MAX_PAGE_SIZE}.`);
  }

  return { page, limit, offset: (page - 1) * limit };
}

/**
 * Builds the `meta` block returned with every paginated response.
 * @param {{page: number, limit: number, total: number}} params
 */
export function buildPageMeta({ page, limit, total }) {
  return {
    page,
    limit,
    total,
    totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
    hasNextPage: page * limit < total,
    hasPreviousPage: page > 1,
  };
}

export default { parsePagination, buildPageMeta, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE };
