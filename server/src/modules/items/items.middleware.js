/**
 * Items middleware.
 *
 * `requireItemAccess` performs the ownership/role check *before* the controller
 * runs and loads the report once, so the authorization decision is explicit in
 * the route table (NFR-05) and administrators can act on any report.
 *
 * The service layer still re-checks ownership inside the transaction, because it
 * locks the row and must not rely on a check made against a stale read.
 */
import { query } from '../../config/db.js';
import { forbidden, notFound } from '../../utils/httpError.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

/**
 * @param {{allowDeleted?: boolean}} [options]
 */
export function requireItemAccess(options = {}) {
  return asyncHandler(async (req, _res, next) => {
    const itemId = Number(req.params.itemId);
    if (!Number.isInteger(itemId)) throw notFound('Invalid report id.');

    const { rows } = await query(
      `SELECT item_id, reporter_id, report_type, status, deleted_at FROM items WHERE item_id = $1`,
      [itemId]
    );

    if (rows.length === 0) throw notFound(`Report ${itemId} was not found.`);
    if (rows[0].deleted_at && !options.allowDeleted && req.user?.role !== 'admin') {
      throw notFound(`Report ${itemId} was not found.`);
    }
    if (req.user?.role !== 'admin' && req.user?.userId !== rows[0].reporter_id) {
      throw forbidden('You may only access or modify your own reports.');
    }

    req.item = rows[0];
    return next();
  });
}

export default { requireItemAccess };
