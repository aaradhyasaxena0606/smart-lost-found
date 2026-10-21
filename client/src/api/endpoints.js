/**
 * Typed wrappers around every endpoint the UI uses.
 * Keeping them here means a page never builds a URL by hand, so the client stays
 * consistent with the documented API contract (spec 14).
 */
import http, { toQuery } from './client.js';

export const authApi = {
  register: (payload) => http.post('/auth/register', payload, { auth: false }),
  login: (payload) => http.post('/auth/login', payload, { auth: false }),
  me: () => http.get('/auth/me'),
  changePassword: (payload) => http.post('/auth/change-password', payload),
};

export const itemsApi = {
  search: (filters) => http.get(`/items${toQuery(filters)}`, { auth: false }),
  get: (itemId) => http.get(`/items/${itemId}`, { auth: false }),
  create: (payload) => http.post('/items', payload),
  update: (itemId, payload) => http.patch(`/items/${itemId}`, payload),
  updateStatus: (itemId, status) => http.patch(`/items/${itemId}/status`, { status }),
  remove: (itemId) => http.delete(`/items/${itemId}`),
  listMine: (filters) => http.get(`/users/me/items${toQuery(filters)}`),
  uploadImage: (itemId, file) => http.upload(`/items/${itemId}/images`, file),
  deleteImage: (itemId, imageId) => http.delete(`/items/${itemId}/images/${imageId}`),
  categories: () => http.get('/categories', { auth: false }),
};

export const matchesApi = {
  list: (filters) => http.get(`/matches${toQuery(filters)}`),
  forItem: (itemId, filters) => http.get(`/items/${itemId}/matches${toQuery(filters)}`),
  dismiss: (matchId) => http.post(`/matches/${matchId}/dismiss`, {}),
  recalculate: (payload = {}) => http.post('/matches/recalculate', payload),
};

export const claimsApi = {
  submit: (itemId, payload) => http.post(`/items/${itemId}/claims`, payload),
  mine: (filters) => http.get(`/claims/me${toQuery(filters)}`),
  withdraw: (claimId) => http.post(`/claims/${claimId}/withdraw`, {}),
  queue: (filters) => http.get(`/admin/claims${toQuery(filters)}`),
  get: (claimId) => http.get(`/admin/claims/${claimId}`),
  decide: (claimId, payload) => http.patch(`/admin/claims/${claimId}`, payload),
};

export const notificationsApi = {
  list: (filters) => http.get(`/notifications${toQuery(filters)}`),
  unreadCount: () => http.get('/notifications/unread-count'),
  markRead: (notificationId) => http.patch(`/notifications/${notificationId}/read`, {}),
  markAllRead: () => http.patch('/notifications/read-all', {}),
};

export const adminApi = {
  items: (filters) => http.get(`/admin/items${toQuery(filters)}`),
  item: (itemId) => http.get(`/admin/items/${itemId}`),
  moderate: (itemId, payload) => http.patch(`/admin/items/${itemId}/moderation`, payload),
  auditLogs: (filters) => http.get(`/admin/audit-logs${toQuery(filters)}`),
  stats: () => http.get('/admin/stats'),
  users: (filters) => http.get(`/admin/users${toQuery(filters)}`),
};

export const healthApi = {
  check: () => http.get('/health?db=1', { auth: false }),
};

export default { authApi, itemsApi, matchesApi, claimsApi, notificationsApi, adminApi, healthApi };
