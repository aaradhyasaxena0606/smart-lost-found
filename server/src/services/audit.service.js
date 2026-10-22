/**
 * Audit trail service (FR-24, spec 12.2 "preserve audit history").
 *
 * Every important user and administrative action writes one row. Records are
 * insert-only: nothing in the application ever updates or deletes them.
 *
 * `metadata` must contain only safe, non-secret details. Never pass passwords,
 * tokens, private verification hints or claim evidence (NFR-14).
 */
import { query as dbQuery } from '../config/db.js';

/** Actions recorded by the application. Documented in docs/security.md. */
export const AUDIT_ACTIONS = Object.freeze({
  USER_REGISTERED: 'user.registered',
  USER_LOGIN: 'user.login',
  USER_PASSWORD_CHANGED: 'user.password_changed',
  USER_ROLE_GRANTED: 'user.role_granted',
  ITEM_CREATED: 'item.created',
  ITEM_UPDATED: 'item.updated',
  ITEM_STATUS_CHANGED: 'item.status_changed',
  ITEM_MODERATED: 'item.moderated',
  ITEM_SOFT_DELETED: 'item.soft_deleted',
  IMAGE_UPLOADED: 'item.image_uploaded',
  MATCHES_RECALCULATED: 'matches.recalculated',
  MATCH_DISMISSED: 'match.dismissed',
  CLAIM_SUBMITTED: 'claim.submitted',
  CLAIM_APPROVED: 'claim.approved',
  CLAIM_REJECTED: 'claim.rejected',
  CLAIM_WITHDRAWN: 'claim.withdrawn',
});

/**
 * Writes an audit record.
 *
 * @param {{actorUserId?: number|null, action: string, entityType: string, entityId?: number|null, metadata?: object}} entry
 * @param {import('pg').PoolClient|undefined} client optional transaction client
 */
export async function record(entry, client) {
  const runner = client ?? { query: dbQuery };
  const { actorUserId = null, action, entityType, entityId = null, metadata = {} } = entry;

  await runner.query(
    `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [actorUserId, action, entityType, entityId, JSON.stringify(metadata)]
  );
}

/**
 * Lists audit records with optional filters (admin only).
 *
 * @param {{actorUserId?: number, action?: string, entityType?: string, entityId?: number,
 *          from?: string, to?: string, page: number, limit: number, offset: number}} params
 */
export async function list(params) {
  const conditions = [];
  const values = [];

  const add = (clause, value) => {
    values.push(value);
    conditions.push(clause.replace('?', `$${values.length}`));
  };

  if (params.actorUserId) add('a.actor_user_id = ?', params.actorUserId);
  if (params.action) add('a.action = ?', params.action);
  if (params.entityType) add('a.entity_type = ?', params.entityType);
  if (params.entityId) add('a.entity_id = ?', params.entityId);
  if (params.from) add('a.created_at >= ?', params.from);
  if (params.to) add('a.created_at <= ?', params.to);

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await dbQuery(`SELECT COUNT(*)::bigint AS total FROM audit_logs a ${where}`, values);

  values.push(params.limit, params.offset);
  const { rows } = await dbQuery(
    `SELECT a.audit_id, a.actor_user_id, u.full_name AS actor_name, a.action,
            a.entity_type, a.entity_id, a.metadata, a.created_at
       FROM audit_logs a
       LEFT JOIN users u ON u.user_id = a.actor_user_id
       ${where}
      ORDER BY a.created_at DESC, a.audit_id DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return {
    total: countResult.rows[0].total,
    rows: rows.map((row) => ({
      auditId: row.audit_id,
      actorUserId: row.actor_user_id,
      actorName: row.actor_name,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      metadata: row.metadata,
      createdAt: row.created_at,
    })),
  };
}

export default { record, list, AUDIT_ACTIONS };
