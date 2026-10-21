import { sendError } from '../utils/respond.js';

/** Terminal middleware: any unmatched route returns the standard 404 shape. */
export function notFoundHandler(req, res) {
  return sendError(res, 404, 'NOT_FOUND', `No route matches ${req.method} ${req.originalUrl}.`);
}

export default notFoundHandler;
