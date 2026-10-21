/**
 * Matching engine (FR-13, FR-14, FR-15, FR-16, spec 13).
 *
 * DESIGN
 * ------
 * The engine is deterministic and explainable. It is intentionally separated
 * from the route handlers (spec 10, "Matching logic is separated from route
 * handlers") and has no HTTP concerns.
 *
 * 1. Candidate selection (SQL, index-assisted)
 *    * opposite report type only (lost <-> found);
 *    * both reports still open to matching (`status IN ('open','matched')`);
 *    * soft-deleted reports excluded;
 *    * `event_time` inside a configurable window (MATCH_MAX_DAYS either side);
 *    * when both reports have a location, PostGIS ST_DWithin on the GiST-indexed
 *      `location` column limits candidates to MATCH_RADIUS_METERS.
 *
 * 2. Component scores, each on a documented 0-100 scale
 *    * attribute_score : category (40%), title/description text (30%),
 *                        colour (15%), brand (15%).
 *                        Sub-components with missing data on either side are
 *                        dropped and the remaining sub-weights re-normalised, so
 *                        a report without a colour is not penalised.
 *    * time_score      : 100 * (1 - |hours apart| / maxHours), clamped to 0-100.
 *                        100 when reported at the same time; 0 at the window edge.
 *    * spatial_score   : 100 * (1 - distanceMeters / radiusMeters), clamped.
 *                        Null when either report has no location.
 *    * ai_score        : null unless an AI provider is configured AND returns a
 *                        numeric score. Never fabricates a value.
 *
 * 3. Overall score
 *    overall = SUM(weight_i * score_i) / SUM(weight_i) over AVAILABLE components
 *    so the absence of AI (or of coordinates) does not deflate the score. The
 *    weights used are persisted inside match_reasons for transparency.
 *
 * 4. Persistence
 *    Upsert on the unique (lost_item_id, found_item_id) pair, so concurrent
 *    recalculations cannot create duplicates. `match_status` is never downgraded
 *    by a recalculation: a dismissed/claimed/resolved match keeps its state.
 *
 * 5. Threshold
 *    Only pairs scoring at least MATCH_MIN_SCORE are persisted. A previously
 *    *suggested* match that drops below the threshold is removed, which keeps
 *    the candidate list meaningful. Human-reviewed statuses are never deleted.
 *
 * The score ranks candidates. It is advisory and never proves ownership
 * (NFR-15) — the message is repeated in every match reason set.
 */
import { query, withTransaction } from '../config/db.js';
import config from '../config/env.js';
import { getAiProvider } from '../integrations/ai/index.js';
import { badRequest, notFound } from '../utils/httpError.js';
import { textSimilarity, colourSimilarity, brandSimilarity } from '../utils/text.js';
import * as auditService from './audit.service.js';
import * as notificationService from './notification.service.js';

export const MATCH_SCORE_VERSION = '1.0.0';

/** Sub-weights used inside attribute_score. They sum to 1. */
export const ATTRIBUTE_SUB_WEIGHTS = Object.freeze({
  category: 0.4,
  text: 0.3,
  colour: 0.15,
  brand: 0.15,
});

/** Human labels used in match reasons. */
const CATEGORY_SAME_POINTS = 100;
const CATEGORY_DIFFERENT_POINTS = 0;

const round2 = (value) => Math.round(value * 100) / 100;
const clamp100 = (value) => Math.max(0, Math.min(100, value));

/**
 * Scores a single lost/found pair.
 *
 * @param {object} lostItem normalised lost item (with latitude/longitude)
 * @param {object} foundItem normalised found item
 * @param {{distanceMeters: number|null}} context
 * @returns {Promise<{attributeScore: number, timeScore: number, spatialScore: number|null,
 *                    aiScore: number|null, overallScore: number, reasons: object[]}>}
 */
export async function scorePair(lostItem, foundItem, context = {}) {
  const reasons = [];

  // --- attribute score ------------------------------------------------------
  const attributeParts = [];
  let attributeWeightSum = 0;

  const categoryPoints =
    lostItem.category_id === foundItem.category_id
      ? CATEGORY_SAME_POINTS
      : CATEGORY_DIFFERENT_POINTS;
  attributeParts.push({ key: 'category', weight: ATTRIBUTE_SUB_WEIGHTS.category, score: categoryPoints });
  attributeWeightSum += ATTRIBUTE_SUB_WEIGHTS.category;

  reasons.push(
    lostItem.category_id === foundItem.category_id
      ? {
          code: 'category_match',
          label: 'Same category',
          detail: lostItem.category_name,
          weight: ATTRIBUTE_SUB_WEIGHTS.category,
          value: categoryPoints,
        }
      : {
          code: 'category_mismatch',
          label: 'Different category',
          detail: `${lostItem.category_name} vs ${foundItem.category_name}`,
          weight: ATTRIBUTE_SUB_WEIGHTS.category,
          value: categoryPoints,
        }
  );

  const titleSimilarity = textSimilarity(lostItem.title, foundItem.title);
  const descriptionSimilarity = textSimilarity(lostItem.description, foundItem.description);
  const textScore = clamp100((titleSimilarity * 0.6 + descriptionSimilarity * 0.4) * 100);
  attributeParts.push({ key: 'text', weight: ATTRIBUTE_SUB_WEIGHTS.text, score: textScore });
  attributeWeightSum += ATTRIBUTE_SUB_WEIGHTS.text;
  reasons.push({
    code: 'text_similarity',
    label: 'Title and description wording',
    detail: `title ${Math.round(titleSimilarity * 100)}%, description ${Math.round(descriptionSimilarity * 100)}%`,
    weight: ATTRIBUTE_SUB_WEIGHTS.text,
    value: round2(textScore),
  });

  const colour = colourSimilarity(lostItem.colour, foundItem.colour);
  if (colour.score !== null) {
    const colourPoints = clamp100(colour.score * 100);
    attributeParts.push({ key: 'colour', weight: ATTRIBUTE_SUB_WEIGHTS.colour, score: colourPoints });
    attributeWeightSum += ATTRIBUTE_SUB_WEIGHTS.colour;
    reasons.push({
      code: colour.exact ? 'colour_match' : 'colour_similar',
      label: colour.exact ? 'Same colour' : colour.score > 0 ? 'Similar colour' : 'Different colour',
      detail: `${lostItem.colour} vs ${foundItem.colour}`,
      weight: ATTRIBUTE_SUB_WEIGHTS.colour,
      value: round2(colourPoints),
    });
  } else {
    reasons.push({
      code: 'colour_unavailable',
      label: 'Colour not compared',
      detail: 'At least one report does not record a colour.',
      weight: 0,
      value: null,
    });
  }

  const brand = brandSimilarity(lostItem.brand, foundItem.brand);
  if (brand.score !== null) {
    const brandPoints = clamp100(brand.score * 100);
    attributeParts.push({ key: 'brand', weight: ATTRIBUTE_SUB_WEIGHTS.brand, score: brandPoints });
    attributeWeightSum += ATTRIBUTE_SUB_WEIGHTS.brand;
    reasons.push({
      code: brand.exact ? 'brand_match' : 'brand_similar',
      label: brand.exact ? 'Same brand' : brand.score > 0 ? 'Similar brand' : 'Different brand',
      detail: `${lostItem.brand} vs ${foundItem.brand}`,
      weight: ATTRIBUTE_SUB_WEIGHTS.brand,
      value: round2(brandPoints),
    });
  } else {
    reasons.push({
      code: 'brand_unavailable',
      label: 'Brand not compared',
      detail: 'At least one report does not record a brand.',
      weight: 0,
      value: null,
    });
  }

  const attributeScore = round2(
    attributeParts.reduce((sum, part) => sum + part.score * part.weight, 0) / attributeWeightSum
  );

  // --- time score -----------------------------------------------------------
  const maxHours = config.matching.maxDays * 24;
  const hoursApart = Math.abs(
    (new Date(lostItem.event_time).getTime() - new Date(foundItem.event_time).getTime()) / 3_600_000
  );
  const timeScore = round2(clamp100(100 * (1 - hoursApart / maxHours)));
  reasons.push({
    code: 'time_proximity',
    label: 'Reported close in time',
    detail:
      hoursApart < 1
        ? `${Math.round(hoursApart * 60)} minutes apart`
        : `${round2(hoursApart)} hours apart`,
    weight: config.matching.weights.time,
    value: timeScore,
  });

  // --- spatial score --------------------------------------------------------
  const distanceMeters = context.distanceMeters ?? null;
  let spatialScore = null;
  if (distanceMeters !== null) {
    const radius = config.matching.radiusMeters;
    spatialScore = round2(clamp100(100 * (1 - distanceMeters / radius)));
    reasons.push({
      code: 'spatial_proximity',
      label: 'Found near the last known location',
      detail:
        distanceMeters < 1000
          ? `${Math.round(distanceMeters)} m apart`
          : `${round2(distanceMeters / 1000)} km apart`,
      weight: config.matching.weights.spatial,
      value: spatialScore,
    });
  } else {
    reasons.push({
      code: 'spatial_unavailable',
      label: 'Distance not compared',
      detail: 'At least one report has no location.',
      weight: 0,
      value: null,
    });
  }

  // --- AI score (optional, never fabricated) --------------------------------
  let aiScore = null;
  const provider = getAiProvider();
  if (provider.enabled) {
    // Only public attributes are transmitted (spec 13.3).
    const aiResult = await provider.scoreTextPair(
      `${lostItem.title}. ${lostItem.description}`,
      `${foundItem.title}. ${foundItem.description}`
    );
    if (typeof aiResult.score === 'number') {
      aiScore = round2(clamp100(aiResult.score));
      reasons.push({
        code: 'ai_similarity',
        label: 'AI text similarity',
        detail: `${provider.name}/${provider.describe().model}`,
        weight: config.matching.weights.ai,
        value: aiScore,
      });
    } else {
      reasons.push({
        code: 'ai_unavailable',
        label: 'AI similarity not available',
        detail: aiResult.reason ?? aiResult.error ?? 'The AI provider did not return a score.',
        weight: 0,
        value: null,
      });
    }
  } else {
    reasons.push({
      code: 'ai_disabled',
      label: 'AI similarity disabled',
      detail: 'Deterministic scoring only (AI_PROVIDER=disabled).',
      weight: 0,
      value: null,
    });
  }

  // --- overall score: re-normalised over available components ---------------
  const components = [
    { key: 'attribute', score: attributeScore, weight: config.matching.weights.attribute },
    { key: 'time', score: timeScore, weight: config.matching.weights.time },
  ];
  if (spatialScore !== null) {
    components.push({ key: 'spatial', score: spatialScore, weight: config.matching.weights.spatial });
  }
  if (aiScore !== null) {
    components.push({ key: 'ai', score: aiScore, weight: config.matching.weights.ai });
  }

  const weightSum = components.reduce((sum, component) => sum + component.weight, 0);
  const overallScore =
    weightSum > 0
      ? round2(components.reduce((sum, c) => sum + c.score * c.weight, 0) / weightSum)
      : 0;

  reasons.push({
    code: 'weighting',
    label: 'How this score was combined',
    detail:
      `Used ${components.map((c) => `${c.key} ${Math.round((c.weight / weightSum) * 100)}%`).join(', ')}` +
      (components.length < 4 ? ' (unavailable components removed and weights re-normalised).' : '.'),
    weight: 1,
    value: overallScore,
  });
  reasons.push({
    code: 'score_notice',
    label: 'This is a suggestion, not proof',
    detail: 'A score only ranks candidates. Ownership is decided by human review of the claim.',
    weight: 0,
    value: null,
  });

  return { attributeScore, timeScore, spatialScore, aiScore, overallScore, reasons };
}

/**
 * Loads one report with the fields the engine needs.
 */
async function loadScoringItem(itemId, client) {
  const runner = client ?? { query };
  const { rows } = await runner.query(
    `SELECT i.item_id, i.reporter_id, i.report_type, i.category_id, c.name AS category_name,
            i.title, i.description, i.colour, i.brand, i.event_time, i.status, i.deleted_at,
            CASE WHEN i.location IS NULL THEN NULL ELSE ST_Y(i.location::geometry) END AS latitude,
            CASE WHEN i.location IS NULL THEN NULL ELSE ST_X(i.location::geometry) END AS longitude
       FROM items i
       JOIN categories c ON c.category_id = i.category_id
      WHERE i.item_id = $1`,
    [itemId]
  );
  return rows[0] ?? null;
}

/**
 * Candidate selection: everything the SQL layer can filter cheaply, plus
 * existing match state so recalculation never downgrades a reviewed match.
 */
async function findCandidates(sourceItem, client) {
  const runner = client ?? { query };
  const oppositeType = sourceItem.report_type === 'lost' ? 'found' : 'lost';
  const maxHours = config.matching.maxDays * 24;
  const origin =
    sourceItem.latitude !== null && sourceItem.longitude !== null
      ? `SRID=4326;POINT(${sourceItem.longitude} ${sourceItem.latitude})`
      : null;

  const { rows } = await runner.query(
    `WITH source AS (
       SELECT $8::varchar AS report_type, $2::int AS item_id
     ),
     candidates AS (
       SELECT
         i.item_id, i.reporter_id, i.report_type, i.category_id, c.name AS category_name,
         i.title, i.description, i.colour, i.brand, i.event_time, i.status,
         CASE WHEN i.location IS NULL THEN NULL ELSE ST_Y(i.location::geometry) END AS latitude,
         CASE WHEN i.location IS NULL THEN NULL ELSE ST_X(i.location::geometry) END AS longitude,
         CASE WHEN i.location IS NOT NULL AND $3::geography IS NOT NULL
              THEN ST_Distance(i.location, $3::geography) END AS distance_meters,
         CASE WHEN s.report_type = 'lost' THEN s.item_id ELSE i.item_id END AS pair_lost_id,
         CASE WHEN s.report_type = 'lost' THEN i.item_id ELSE s.item_id END AS pair_found_id
       FROM items i
       JOIN categories c ON c.category_id = i.category_id
       CROSS JOIN source s
      WHERE i.deleted_at IS NULL
        AND i.report_type = $1
        AND i.status IN ('open', 'matched')
        AND i.item_id <> $2
        AND i.event_time >= $4
        AND i.event_time <= $5
        AND (
          $3::geography IS NULL
          OR i.location IS NULL
          OR ST_DWithin(i.location, $3::geography, $6)
        )
      ORDER BY i.event_time ASC, i.item_id ASC
      LIMIT $7
    )
    SELECT cd.*, m.match_id AS existing_match_id, m.match_status AS existing_match_status
      FROM candidates cd
      LEFT JOIN matches m
        ON m.lost_item_id = cd.pair_lost_id
       AND m.found_item_id = cd.pair_found_id`,
    [
      oppositeType,
      sourceItem.item_id,
      origin,
      new Date(new Date(sourceItem.event_time).getTime() - maxHours * 3_600_000),
      new Date(new Date(sourceItem.event_time).getTime() + maxHours * 3_600_000),
      config.matching.radiusMeters,
      config.matching.candidateLimit,
      sourceItem.report_type,
    ]
  );

  return rows;
}

/**
 * Recalculates every candidate match for one report.
 *
 * Runs in a single transaction when no client is supplied, so the persisted
 * match set for a report is consistent even if several candidates are processed.
 *
 * @param {number} itemId
 * @param {{actorUserId?: number|null, client?: import('pg').PoolClient, notify?: boolean}} [options]
 * @returns {Promise<{itemId: number, scanned: number, created: number, updated: number, removed: number, skipped: number}>}
 */
export async function recalculateForItem(itemId, options = {}) {
  const { actorUserId = null, notify = true } = options;

  const run = async (client) => {
    const source = await loadScoringItem(itemId, client);
    if (!source) throw notFound(`Report ${itemId} was not found.`);
    if (source.deleted_at) {
      throw badRequest('Deleted reports are not matched.');
    }

    const candidates = await findCandidates(source, client);

    let created = 0;
    let updated = 0;
    let removed = 0;
    let skipped = 0;

    for (const candidate of candidates) {
      const lostItem = source.report_type === 'lost' ? source : candidate;
      const foundItem = source.report_type === 'lost' ? candidate : source;

      const scored = await scorePair(lostItem, foundItem, {
        distanceMeters: candidate.distance_meters,
      });

      const belowThreshold = scored.overallScore < config.matching.minScore;

      // Too weak to suggest: drop a previous suggestion, but never touch a match
      // a human has already acted on.
      if (belowThreshold) {
        if (candidate.existing_match_id && candidate.existing_match_status === 'suggested') {
          await client.query('DELETE FROM matches WHERE match_id = $1', [candidate.existing_match_id]);
          removed += 1;
        } else {
          skipped += 1;
        }
        continue;
      }

      const { rows } = await client.query(
        `INSERT INTO matches
           (lost_item_id, found_item_id, attribute_score, time_score, spatial_score, ai_score,
            overall_score, match_status, match_reasons)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'suggested', $8::jsonb)
         ON CONFLICT (lost_item_id, found_item_id) DO UPDATE
            SET attribute_score = EXCLUDED.attribute_score,
                time_score      = EXCLUDED.time_score,
                spatial_score   = EXCLUDED.spatial_score,
                ai_score        = EXCLUDED.ai_score,
                overall_score   = EXCLUDED.overall_score,
                match_reasons   = EXCLUDED.match_reasons
         RETURNING match_id, (xmax = 0) AS inserted`,
        [
          lostItem.item_id,
          foundItem.item_id,
          scored.attributeScore,
          scored.timeScore,
          scored.spatialScore,
          scored.aiScore,
          scored.overallScore,
          JSON.stringify(scored.reasons),
        ]
      );

      const { match_id: matchId, inserted } = rows[0];

      if (inserted) {
        created += 1;
        if (notify) {
          await notifyNewMatch(client, { matchId, lostItem, foundItem, overallScore: scored.overallScore });
        }
      } else {
        updated += 1;
      }
    }

    await auditService.record(
      {
        actorUserId,
        action: auditService.AUDIT_ACTIONS.MATCHES_RECALCULATED,
        entityType: 'item',
        entityId: itemId,
        metadata: { scanned: candidates.length, created, updated, removed, skipped, scoreVersion: MATCH_SCORE_VERSION },
      },
      client
    );

    return { itemId, scanned: candidates.length, created, updated, removed, skipped };
  };

  if (options.client) return run(options.client);
  return withTransaction(run);
}

/**
 * Notifies both reporters about a newly discovered candidate pair.
 * Titles are public data, so they are safe to include. A user who reported both
 * sides receives a single notification.
 */
async function notifyNewMatch(client, { matchId, lostItem, foundItem, overallScore }) {
  const scoreText = `${overallScore}% candidate score`;
  const recipients = new Map();

  recipients.set(lostItem.reporter_id, {
    userId: lostItem.reporter_id,
    title: 'Possible match for your lost item',
    message: `A found report ("${foundItem.title}") looks similar to your lost report ("${lostItem.title}"). ${scoreText}. Open the matches page to review it.`,
  });

  if (!recipients.has(foundItem.reporter_id)) {
    recipients.set(foundItem.reporter_id, {
      userId: foundItem.reporter_id,
      title: 'Possible match for the item you found',
      message: `A lost report ("${lostItem.title}") looks similar to the item you found ("${foundItem.title}"). ${scoreText}. Open the matches page to review it.`,
    });
  }

  for (const recipient of recipients.values()) {
    await notificationService.create(
      {
        userId: recipient.userId,
        type: notificationService.NOTIFICATION_TYPES.ITEM_MATCHED,
        title: recipient.title,
        message: recipient.message,
        relatedItemId: null,
      },
      client
    );
  }

  // matchId is intentionally not attached to the notification: the notification
  // table references items and claims, and the match is reachable from the item.
  void matchId;
}

/**
 * Recalculates matches for every open report owned by a user (or for all open
 * reports when `all` is true, which the admin endpoint uses).
 */
export async function recalculateForUser({ userId, all = false, actorUserId = null }) {
  const { rows } = await query(
    `SELECT item_id FROM items
      WHERE deleted_at IS NULL
        AND status IN ('open', 'matched')
        AND ($2::boolean OR reporter_id = $1)
      ORDER BY item_id`,
    [userId, all]
  );

  const summary = { itemsProcessed: 0, created: 0, updated: 0, removed: 0, scanned: 0 };
  for (const row of rows) {
    const result = await recalculateForItem(row.item_id, { actorUserId, notify: true });
    summary.itemsProcessed += 1;
    summary.created += result.created;
    summary.updated += result.updated;
    summary.removed += result.removed;
    summary.scanned += result.scanned;
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

const MATCH_SELECT = `
  SELECT
    m.match_id, m.lost_item_id, m.found_item_id,
    m.attribute_score, m.time_score, m.spatial_score, m.ai_score, m.overall_score,
    m.match_status, m.match_reasons, m.created_at, m.updated_at,
    li.title AS lost_title, li.description AS lost_description, li.colour AS lost_colour,
    li.brand AS lost_brand, li.event_time AS lost_event_time, li.location_name AS lost_location_name,
    li.status AS lost_status, li.report_type AS lost_report_type, li.latitude AS lost_latitude,
    li.longitude AS lost_longitude, li.reporter_id AS lost_reporter_id, li.category_name AS lost_category_name,
    li.category_id AS lost_category_id, li.reporter_name AS lost_reporter_name,
    li.created_at AS lost_created_at, li.updated_at AS lost_updated_at, li.closed_at AS lost_closed_at,
    fi.title AS found_title, fi.description AS found_description, fi.colour AS found_colour,
    fi.brand AS found_brand, fi.event_time AS found_event_time, fi.location_name AS found_location_name,
    fi.status AS found_status, fi.report_type AS found_report_type, fi.latitude AS found_latitude,
    fi.longitude AS found_longitude, fi.reporter_id AS found_reporter_id, fi.category_name AS found_category_name,
    fi.category_id AS found_category_id, fi.reporter_name AS found_reporter_name,
    fi.created_at AS found_created_at, fi.updated_at AS found_updated_at, fi.closed_at AS found_closed_at,
    CASE WHEN l.location IS NOT NULL AND f.location IS NOT NULL
         THEN ST_Distance(l.location, f.location) END AS distance_meters
  FROM matches m
  JOIN v_public_items li ON li.item_id = m.lost_item_id
  JOIN v_public_items fi ON fi.item_id = m.found_item_id
  JOIN items l ON l.item_id = m.lost_item_id
  JOIN items f ON f.item_id = m.found_item_id
`;

function mapMatchRow(row, viewerUserId) {
  const buildSide = (prefix) => ({
    itemId: row[`${prefix}_item_id`],
    reportType: row[`${prefix}_report_type`],
    title: row[`${prefix}_title`],
    description: row[`${prefix}_description`],
    colour: row[`${prefix}_colour`],
    brand: row[`${prefix}_brand`],
    eventTime: row[`${prefix}_event_time`],
    locationName: row[`${prefix}_location_name`],
    status: row[`${prefix}_status`],
    createdAt: row[`${prefix}_created_at`],
    updatedAt: row[`${prefix}_updated_at`],
    closedAt: row[`${prefix}_closed_at`],
    category: { categoryId: row[`${prefix}_category_id`], name: row[`${prefix}_category_name`] },
    reporter: { userId: row[`${prefix}_reporter_id`], fullName: row[`${prefix}_reporter_name`] },
    location:
      row[`${prefix}_latitude`] === null
        ? null
        : { latitude: row[`${prefix}_latitude`], longitude: row[`${prefix}_longitude`] },
    isMine: viewerUserId !== undefined && viewerUserId !== null && row[`${prefix}_reporter_id`] === viewerUserId,
  });

  return {
    matchId: row.match_id,
    overallScore: row.overall_score,
    matchStatus: row.match_status,
    scores: {
      attribute: row.attribute_score,
      time: row.time_score,
      spatial: row.spatial_score,
      ai: row.ai_score,
    },
    reasons: row.match_reasons,
    distanceMeters: row.distance_meters,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lostItem: buildSide('lost'),
    foundItem: buildSide('found'),
  };
}

/**
 * Matches relevant to one user: the user must be the reporter of either side.
 */
export async function listForUser(userId, { status, itemId, limit, offset }) {
  const conditions = ['(li.reporter_id = $1 OR fi.reporter_id = $1)'];
  const values = [userId];

  if (status) {
    values.push(status);
    conditions.push(`m.match_status = $${values.length}`);
  }
  if (itemId) {
    values.push(itemId);
    conditions.push(`(m.lost_item_id = $${values.length} OR m.found_item_id = $${values.length})`);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const countResult = await query(
    `SELECT COUNT(*)::bigint AS total
       FROM matches m
       JOIN v_public_items li ON li.item_id = m.lost_item_id
       JOIN v_public_items fi ON fi.item_id = m.found_item_id
       ${where}`,
    values
  );

  values.push(limit, offset);
  const { rows } = await query(
    `${MATCH_SELECT} ${where}
     ORDER BY m.overall_score DESC, m.match_id DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return { total: countResult.rows[0].total, rows: rows.map((row) => mapMatchRow(row, userId)) };
}

/** Matches for one report. The caller must have already checked authorization. */
export async function listForItem(itemId, { status, limit, offset, viewerUserId }) {
  const conditions = ['(m.lost_item_id = $1 OR m.found_item_id = $1)'];
  const values = [itemId];

  if (status) {
    values.push(status);
    conditions.push(`m.match_status = $${values.length}`);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const countResult = await query(`SELECT COUNT(*)::bigint AS total FROM matches m ${where}`, values);

  values.push(limit, offset);
  const { rows } = await query(
    `${MATCH_SELECT} ${where}
     ORDER BY m.overall_score DESC, m.match_id DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return { total: countResult.rows[0].total, rows: rows.map((row) => mapMatchRow(row, viewerUserId)) };
}

/**
 * Loads one match with both sides joined, or null.
 * @param {number} matchId
 * @param {import('pg').PoolClient} [client] pass the transaction client so an
 *        uncommitted update made in that transaction is visible to the read
 */
export async function findMatchById(matchId, client) {
  const runner = client ?? { query };
  const { rows } = await runner.query(`${MATCH_SELECT} WHERE m.match_id = $1`, [matchId]);
  return rows[0] ?? null;
}

/**
 * Marks a match as dismissed. Only 'suggested' matches can be dismissed, and the
 * caller must be a reporter of one of the two items (or an administrator).
 */
export async function dismissMatch(matchId, { actorUserId }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT match_id, lost_item_id, found_item_id, match_status
         FROM matches WHERE match_id = $1 FOR UPDATE`,
      [matchId]
    );
    if (rows.length === 0) throw notFound(`Match ${matchId} was not found.`);

    const match = rows[0];
    if (match.match_status !== 'suggested') {
      throw badRequest(`Only suggested matches can be dismissed (current status: ${match.match_status}).`);
    }

    await client.query(`UPDATE matches SET match_status = 'dismissed' WHERE match_id = $1`, [matchId]);
    await auditService.record(
      {
        actorUserId,
        action: auditService.AUDIT_ACTIONS.MATCH_DISMISSED,
        entityType: 'match',
        entityId: matchId,
        metadata: { lostItemId: match.lost_item_id, foundItemId: match.found_item_id },
      },
      client
    );

    const updated = await findMatchById(matchId, client);
    return mapMatchRow(updated, actorUserId);
  });
}

export default {
  MATCH_SCORE_VERSION,
  ATTRIBUTE_SUB_WEIGHTS,
  scorePair,
  recalculateForItem,
  recalculateForUser,
  listForUser,
  listForItem,
  findMatchById,
  dismissMatch,
  mapMatchRow,
};
