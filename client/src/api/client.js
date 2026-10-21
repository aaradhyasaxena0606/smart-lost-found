/**
 * HTTP client for the Smart Lost & Found API.
 *
 * Design notes
 * ------------
 * * The base URL defaults to the relative "/api/v1", which works both behind the
 *   Vite dev proxy and behind a production reverse proxy. Set VITE_API_URL to
 *   point at a different origin; set VITE_API_ORIGIN when uploaded images are
 *   served from a different origin than the page.
 * * The JWT is kept in localStorage. Storing it there is readable by JavaScript,
 *   so it is vulnerable to XSS — the trade-off is that the session survives a page
 *   reload, which the assignment requires. A production hardening step would be an
 *   HttpOnly, SameSite cookie (documented in docs/security.md). Tokens are always
 *   sent in the Authorization header, never in a URL.
 * * Every failure is normalised into an ApiError carrying the server's error code,
 *   message and field-level details so forms can render them.
 */

const API_BASE = import.meta.env.VITE_API_URL ?? '/api/v1';
const API_ORIGIN = import.meta.env.VITE_API_ORIGIN ?? '';
const TOKEN_KEY = 'sllf.token';

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Field errors keyed by field name, for inline form messages. */
  get fieldErrors() {
    if (!Array.isArray(this.details)) return {};
    return this.details.reduce((accumulator, detail) => {
      if (detail && detail.field) accumulator[detail.field] = detail.message;
      return accumulator;
    }, {});
  }

  /** True when the session is missing, invalid or expired. */
  get isAuthError() {
    return this.status === 401;
  }
}

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage may be unavailable in private mode; the session then lasts one page view */
  }
}

/** Absolute URL for a server-relative asset such as "/uploads/abc.png". */
export function assetUrl(path) {
  if (!path) return '';
  if (/^https?:\/\//.test(path)) return path;
  return `${API_ORIGIN}${path}`;
}

async function request(path, { method = 'GET', body, signal, auth = true } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const token = auth ? getToken() : null;
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check that the API is running.');
  }

  if (response.status === 204) return null;

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const error = payload?.error ?? {};
    throw new ApiError(
      response.status,
      error.code ?? 'UNKNOWN_ERROR',
      error.message ?? `The request failed with status ${response.status}.`,
      error.details
    );
  }

  return payload;
}

/** Uploads a file as multipart/form-data. */
async function upload(path, file) {
  const form = new FormData();
  form.append('image', file);

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken()}` },
      body: form,
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server to upload the image.');
  }

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = payload?.error ?? {};
    throw new ApiError(response.status, error.code ?? 'UPLOAD_FAILED', error.message ?? 'The upload failed.', error.details);
  }
  return payload;
}

/**
 * Builds a query string, dropping empty values so filters are only sent when set.
 */
export function toQuery(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

export const http = {
  get: (path, options) => request(path, { ...options, method: 'GET' }),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
  patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body }),
  delete: (path, options) => request(path, { ...options, method: 'DELETE' }),
  upload,
};

export default http;
