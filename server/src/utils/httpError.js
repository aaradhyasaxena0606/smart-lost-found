/**
 * Application error type.
 *
 * Every expected failure is raised as an HttpError so the central error handler
 * can produce one consistent JSON shape with the right status code (NFR-09).
 */
export class HttpError extends Error {
  /**
   * @param {number} status HTTP status code
   * @param {string} code stable machine-readable error code
   * @param {string} message human-readable message (safe to show to users)
   * @param {unknown} [details] optional, non-sensitive structured details
   */
  constructor(status, code, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = true;
  }
}

export const badRequest = (message, details) => new HttpError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Authentication is required.') =>
  new HttpError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'You do not have permission to perform this action.') =>
  new HttpError(403, 'FORBIDDEN', message);
export const notFound = (message = 'The requested resource was not found.') =>
  new HttpError(404, 'NOT_FOUND', message);
export const conflict = (message, details) => new HttpError(409, 'CONFLICT', message, details);
export const unprocessable = (message, details) => new HttpError(422, 'VALIDATION_ERROR', message, details);
export const payloadTooLarge = (message) => new HttpError(413, 'PAYLOAD_TOO_LARGE', message);
export const tooManyRequests = (message = 'Too many requests. Please try again later.') =>
  new HttpError(429, 'RATE_LIMITED', message);
export const serviceUnavailable = (message = 'A required service is unavailable.') =>
  new HttpError(503, 'SERVICE_UNAVAILABLE', message);

export default HttpError;
