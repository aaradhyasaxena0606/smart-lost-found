/**
 * Claims service (FR-18, FR-19, FR-20, FR-21, FR-22).
 *
 * All three write operations (submit, decide, withdraw) are multi-step and run
 * inside a single transaction with the item row locked via SELECT ... FOR UPDATE.
 * That is what makes concurrent submissions and concurrent reviews safe:
 *
 *   * two different users claiming the same item both succeed (allowed), but the
 *     same user claiming twice is stopped by the partial unique index
 *     claims_active_unique_idx;
 *   * two administrators reviewing the same claim are serialised by the row lock,
 *     so the second one sees status <> 'pending' and receives HTTP 409.
 *
 * The API NEVER returns claims.private_evidence (spec 16). Reviewers judge
 * ownership from the claim message plus the item's private verification hint,
 * which is exposed only in the administrator queue (never in public responses).
 */
import { query, withTransaction } from '../../config/db.js';
import { badRequest, conflict, forbidden, notFound } from '../../utils/httpError.js';
import { parsePagination, buildPageMeta } from '../../utils/pagination.js';
import * as auditService from '../../services/audit.service.js';
import * as notificationService from '../../services/notification.service.js';

export const CLAIM_STATUSES = Object.freeze(['pending', 'approved', 'rejected', 'withdrawn']);
export const CLAIM_DECISIONS = Object.freeze(['approved', 'rejected']);

/** Statuses in which a found item can still receive a claim. */
export const CLAIMABLE_ITEM_STATUSES = Object.freeze(['open', 'matched', 'claimed']);

/** Maps a claim row (joined with item/user context) to the API shape. */
export function mapClaimRow(row) {
  return {
    claimId: row.claim_id,
    status: row.status,
    claimMessage: row.claim_message,
    // Only a boolean is ever exposed, never the evidence itself.
    hasPrivateEvidence: row.private_evidence !== null && row.private_evidence !== undefined,
    item: {
      itemId: row.item_id,
      title: row.item_title,
      reportType: row.item_report_type,
      status: row.item_status,
      categoryName: row.item_category_name ?? null,
    },
    claimant: {
      userId: row.claimant_id,
      fullName: row.claimant_name,
      email: row.claimant_email,
    },
    review: {
      reviewedBy: row.reviewed_by ?? null,
      reviewerName: row.reviewer_name ?? null,
      reviewedAt: row.reviewed_at ?? null,
      reviewReason: row.review_reason ?? null,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const CLAIM_SELECT = `
  SELECT cl.claim_id, cl.item_id, cl.claimant_id, cl.claim_message, cl.private_evidence,
         cl.status, cl.reviewed_by, cl.reviewed_at, cl.review_reason, cl.created_at, cl.updated_at,
         i.title AS item_title, i.report_type AS item_report_type, i.status AS item_status,
         c.name AS item_category_name,
         cu.full_name AS claimant_name, cu.email AS claimant_email,
         ru.full_name AS reviewer_name
    FROM claims cl
    JOIN items i       ON i.item_id     = cl.item_id
    JOIN categories c  ON c.category_id = i.category_id
    JOIN users cu      ON cu.user_id    = cl.claimant_id
    LEFT JOIN users ru ON ru.user_id    = cl.reviewed_by
`;

async function loadClaim(claimId, runner) {
  const { rows } = await runner.query(`${CLAIM_SELECT} WHERE cl.claim_id = $1`, [claimId]);
  return rows[0] ?? null;
}

/**
 * Submits a claim for a found item (FR-18).
 *
 * @param {number} itemId
 * @param {{claimMessage: string, privateEvidence?: string|null}} input
 * @param {{userId: number, role: string}} actor
 */
export async function submitClaim(itemId, input, actor) {
  return withTransaction(async (client) => {
    // Lock the item so two simultaneous claims cannot both flip its status.
    const { rows } = await client.query(
      `SELECT item_id, reporter_id, report_type, title, status, deleted_at
         FROM items WHERE item_id = $1 FOR UPDATE`,
      [itemId]
    );
    if (rows.length === 0) throw notFound(`Report ${itemId} was not found.`);

    const item = rows[0];
    if (item.deleted_at) throw badRequest('This report is no longer available.');
    if (item.report_type !== 'found') {
      throw badRequest('Claims can only be submitted for found-item reports.');
    }
    if (item.reporter_id === actor.userId) {
      throw conflict('You cannot claim an item that you reported as found.');
    }
    if (!CLAIMABLE_ITEM_STATUSES.includes(item.status)) {
      throw conflict(`An item with status "${item.status}" cannot receive new claims.`, {
        allowedStatuses: CLAIMABLE_ITEM_STATUSES,
      });
    }

    // Pre-check for a friendly 409; the partial unique index is the race-safe guard.
    const existing = await client.query(
      `SELECT claim_id, status FROM claims
        WHERE item_id = $1 AND claimant_id = $2 AND status IN ('pending', 'approved')`,
      [itemId, actor.userId]
    );
    if (existing.rows.length > 0) {
      throw conflict('You already have an active claim for this item.', {
        claimId: existing.rows[0].claim_id,
        status: existing.rows[0].status,
      });
    }

    const inserted = await client.query(
      `INSERT INTO claims (item_id, claimant_id, claim_message, private_evidence)
       VALUES ($1, $2, $3, $4)
       RETURNING claim_id`,
      [itemId, actor.userId, input.claimMessage, input.privateEvidence ?? null]
    );
    const claimId = inserted.rows[0].claim_id;

    // Move the item into the "claimed" state (valid transition from open/matched).
    if (item.status !== 'claimed') {
      await client.query(`UPDATE items SET status = 'claimed' WHERE item_id = $1`, [itemId]);
    }

    // Mark candidate matches for this item as claimed so the matches list and any
    // review queue reflect reality.
    await client.query(
      `UPDATE matches SET match_status = 'claimed'
        WHERE match_status = 'suggested'
          AND (lost_item_id = $1 OR found_item_id = $1)`,
      [itemId]
    );

    await auditService.record(
      {
        actorUserId: actor.userId,
        action: auditService.AUDIT_ACTIONS.CLAIM_SUBMITTED,
        entityType: 'claim',
        entityId: claimId,
        metadata: {
          itemId,
          hasPrivateEvidence: Boolean(input.privateEvidence),
          previousItemStatus: item.status,
        },
      },
      client
    );

    // Notify the reporter of the found item. No private claim evidence is included.
    await notificationService.create(
      {
        userId: item.reporter_id,
        type: notificationService.NOTIFICATION_TYPES.CLAIM_SUBMITTED,
        title: 'A claim was submitted for your found item',
        message: `Someone submitted a claim for "${item.title}". An administrator will review it.`,
        relatedItemId: itemId,
        relatedClaimId: claimId,
      },
      client
    );

    const claim = await loadClaim(claimId, client);
    return mapClaimRow(claim);
  });
}

/** Current user's claims (including withdrawn and decided ones). */
export async function listMyClaims(userId, filters) {
  const { page, limit, offset } = parsePagination(filters);
  const conditions = ['cl.claimant_id = $1'];
  const values = [userId];

  if (filters.status) {
    values.push(filters.status);
    conditions.push(`cl.status = $${values.length}`);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const countResult = await query(`SELECT COUNT(*)::bigint AS total FROM claims cl ${where}`, values);
  values.push(limit, offset);

  const { rows } = await query(
    `${CLAIM_SELECT} ${where} ORDER BY cl.created_at DESC, cl.claim_id DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return {
    rows: rows.map(mapClaimRow),
    meta: buildPageMeta({ page, limit, total: countResult.rows[0].total }),
  };
}

/**
 * Administrator review queue.
 *
 * Exposes the item's private verification hint — required to judge ownership —
 * while deliberately omitting claims.private_evidence from the payload.
 */
export async function listClaimQueue(filters) {
  const { page, limit, offset } = parsePagination(filters);

  const includeDecided = filters.includeDecided === true;
  const values = [];
  const conditions = [];

  if (!includeDecided) {
    conditions.push(`cl.status = 'pending'`);
  } else if (filters.status) {
    values.push(filters.status);
    conditions.push(`cl.status = $${values.length}`);
  }
  if (filters.itemId) {
    values.push(filters.itemId);
    conditions.push(`cl.item_id = $${values.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await query(`SELECT COUNT(*)::bigint AS total FROM claims cl ${where}`, values);
  values.push(limit, offset);

  const { rows } = await query(
    `${CLAIM_SELECT} ${where} ORDER BY cl.created_at ASC, cl.claim_id ASC
      LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  // A separate query supplies the private verification hint that reviewers need,
  // keyed by item. It is never merged into a public response.
  const itemIds = [...new Set(rows.map((row) => row.item_id))];
  let hintsByItem = new Map();
  if (itemIds.length > 0) {
    const hints = await query(
      `SELECT item_id, verification_hint FROM item_private_details WHERE item_id = ANY($1::int[])`,
      [itemIds]
    );
    hintsByItem = new Map(hints.rows.map((row) => [row.item_id, row.verification_hint]));
  }

  const mapped = rows.map((row) => ({
    ...mapClaimRow(row),
    itemVerificationHint: hintsByItem.get(row.item_id) ?? null,
  }));

  return { rows: mapped, meta: buildPageMeta({ page, limit, total: countResult.rows[0].total }) };
}

/** Single claim lookup for administrators (includes the item verification hint). */
export async function getClaimForReview(claimId) {
  const row = await loadClaim(claimId, { query });
  if (!row) return null;

  const hint = await query(`SELECT verification_hint FROM item_private_details WHERE item_id = $1`, [
    row.item_id,
  ]);
  return {
    ...mapClaimRow(row),
    itemVerificationHint: hint.rows[0]?.verification_hint ?? null,
  };
}

/**
 * Approves or rejects a claim (FR-20, FR-22).
 *
 * Approving also marks the item returned, rejects every other pending claim for
 * the same item and resolves the related matches — all in one transaction, so the
 * database can never show an item as returned while a competing claim is pending.
 */
export async function decideClaim(claimId, input, admin) {
  const { decision, reviewReason } = input;

  if (!CLAIM_DECISIONS.includes(decision)) {
    throw badRequest(`decision must be one of: ${CLAIM_DECISIONS.join(', ')}.`);
  }
  if (decision === 'rejected' && !reviewReason) {
    throw badRequest('A reviewReason is required when rejecting a claim.');
  }

  return withTransaction(async (client) => {
    // Lock the claim: concurrent reviews of the same claim are serialised here.
    const { rows } = await client.query(
      `SELECT claim_id, item_id, claimant_id, status FROM claims WHERE claim_id = $1 FOR UPDATE`,
      [claimId]
    );
    if (rows.length === 0) throw notFound(`Claim ${claimId} was not found.`);

    const claim = rows[0];

    if (claim.status !== 'pending') {
      throw conflict(`This claim has already been ${claim.status}.`, { currentStatus: claim.status });
    }
    // FR-19 / spec 16: an administrator can never decide their own claim. The
    // database enforces the same rule with claims_no_self_review_chk.
    if (claim.claimant_id === admin.userId) {
      throw forbidden('You cannot review your own claim.');
    }

    const itemResult = await client.query(
      `SELECT item_id, reporter_id, title, status FROM items WHERE item_id = $1 FOR UPDATE`,
      [claim.item_id]
    );
    const item = itemResult.rows[0];
    if (!item) throw notFound(`Report ${claim.item_id} was not found.`);

    await client.query(
      `UPDATE claims
          SET status = $1, reviewed_by = $2, reviewed_at = now(), review_reason = $3
        WHERE claim_id = $4`,
      [decision, admin.userId, reviewReason ?? null, claimId]
    );

    await auditService.record(
      {
        actorUserId: admin.userId,
        action:
          decision === 'approved'
            ? auditService.AUDIT_ACTIONS.CLAIM_APPROVED
            : auditService.AUDIT_ACTIONS.CLAIM_REJECTED,
        entityType: 'claim',
        entityId: claimId,
        metadata: {
          itemId: claim.item_id,
          claimantId: claim.claimant_id,
          decision,
          hasReason: Boolean(reviewReason),
        },
      },
      client
    );

    if (decision === 'approved') {
      // Item becomes returned (valid transition claimed -> returned).
      if (item.status !== 'returned') {
        await client.query(
          `UPDATE items SET status = 'returned', closed_at = now() WHERE item_id = $1`,
          [claim.item_id]
        );
      }

      // Every other open claim for the same item is rejected in the same
      // transaction, so the item can never end up with two approved claims.
      const others = await client.query(
        `UPDATE claims
            SET status = 'rejected', reviewed_by = $1, reviewed_at = now(),
                review_reason = $2
          WHERE item_id = $3 AND claim_id <> $4 AND status = 'pending'
          RETURNING claim_id, claimant_id`,
        [admin.userId, 'Another claim for this item was approved.', claim.item_id, claimId]
      );

      await client.query(
        `UPDATE matches SET match_status = 'resolved'
          WHERE match_status IN ('suggested', 'claimed')
            AND (lost_item_id = $1 OR found_item_id = $1)`,
        [claim.item_id]
      );

      await notificationService.create(
        {
          userId: claim.claimant_id,
          type: notificationService.NOTIFICATION_TYPES.CLAIM_APPROVED,
          title: 'Your claim was approved',
          message: `Your claim for "${item.title}" was approved. Please follow your campus lost-property collection procedure to collect the item.`,
          relatedItemId: claim.item_id,
          relatedClaimId: claimId,
        },
        client
      );

      await notificationService.create(
        {
          userId: item.reporter_id,
          type: notificationService.NOTIFICATION_TYPES.ITEM_RETURNED,
          title: 'Your found report was resolved',
          message: `A claim for "${item.title}" was approved and the item is marked as returned. Thank you for reporting it.`,
          relatedItemId: claim.item_id,
          relatedClaimId: claimId,
        },
        client
      );

      for (const other of others.rows) {
        await notificationService.create(
          {
            userId: other.claimant_id,
            type: notificationService.NOTIFICATION_TYPES.CLAIM_REJECTED,
            title: 'Your claim was not successful',
            message: `Your claim for "${item.title}" was not approved because another claimant's ownership was verified.`,
            relatedItemId: claim.item_id,
            relatedClaimId: other.claim_id,
          },
          client
        );
      }
    } else {
      // Rejection: the item reopens only when no other claim is still active.
      const active = await client.query(
        `SELECT COUNT(*)::bigint AS remaining FROM claims
          WHERE item_id = $1 AND status IN ('pending', 'approved')`,
        [claim.item_id]
      );
      if (active.rows[0].remaining === 0 && item.status === 'claimed') {
        await client.query(`UPDATE items SET status = 'open', closed_at = NULL WHERE item_id = $1`, [
          claim.item_id,
        ]);
        await client.query(
          `UPDATE matches SET match_status = 'suggested'
            WHERE match_status = 'claimed'
              AND (lost_item_id = $1 OR found_item_id = $1)`,
          [claim.item_id]
        );
      }

      await notificationService.create(
        {
          userId: claim.claimant_id,
          type: notificationService.NOTIFICATION_TYPES.CLAIM_REJECTED,
          title: 'Your claim was rejected',
          message: `Your claim for "${item.title}" was rejected. Reason: ${reviewReason}`,
          relatedItemId: claim.item_id,
          relatedClaimId: claimId,
        },
        client
      );
    }

    const updated = await loadClaim(claimId, client);
    return mapClaimRow(updated);
  });
}

/** Withdraws a pending claim (the claimant's own action). */
export async function withdrawClaim(claimId, actor) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT claim_id, item_id, claimant_id, status FROM claims WHERE claim_id = $1 FOR UPDATE`,
      [claimId]
    );
    if (rows.length === 0) throw notFound(`Claim ${claimId} was not found.`);

    const claim = rows[0];
    if (claim.claimant_id !== actor.userId && actor.role !== 'admin') {
      throw forbidden('You can only withdraw your own claims.');
    }
    if (claim.status !== 'pending') {
      throw conflict(`Only pending claims can be withdrawn (current status: ${claim.status}).`);
    }

    await client.query(`UPDATE claims SET status = 'withdrawn' WHERE claim_id = $1`, [claimId]);

    const itemResult = await client.query(
      `SELECT item_id, reporter_id, title, status FROM items WHERE item_id = $1 FOR UPDATE`,
      [claim.item_id]
    );
    const item = itemResult.rows[0];

    const active = await client.query(
      `SELECT COUNT(*)::bigint AS remaining FROM claims
        WHERE item_id = $1 AND status IN ('pending', 'approved')`,
      [claim.item_id]
    );
    if (active.rows[0].remaining === 0 && item.status === 'claimed') {
      await client.query(`UPDATE items SET status = 'open', closed_at = NULL WHERE item_id = $1`, [
        claim.item_id,
      ]);
      await client.query(
        `UPDATE matches SET match_status = 'suggested'
          WHERE match_status = 'claimed'
            AND (lost_item_id = $1 OR found_item_id = $1)`,
        [claim.item_id]
      );
    }

    await auditService.record(
      {
        actorUserId: actor.userId,
        action: auditService.AUDIT_ACTIONS.CLAIM_WITHDRAWN,
        entityType: 'claim',
        entityId: claimId,
        metadata: { itemId: claim.item_id },
      },
      client
    );

    await notificationService.create(
      {
        userId: item.reporter_id,
        type: notificationService.NOTIFICATION_TYPES.CLAIM_WITHDRAWN,
        title: 'A claim was withdrawn',
        message: `A claim for "${item.title}" was withdrawn by the claimant.`,
        relatedItemId: claim.item_id,
        relatedClaimId: claimId,
      },
      client
    );

    const updated = await loadClaim(claimId, client);
    return mapClaimRow(updated);
  });
}

export default {
  CLAIM_STATUSES,
  CLAIM_DECISIONS,
  CLAIMABLE_ITEM_STATUSES,
  mapClaimRow,
  submitClaim,
  listMyClaims,
  listClaimQueue,
  getClaimForReview,
  decideClaim,
  withdrawClaim,
};
