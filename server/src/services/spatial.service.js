/**
 * Spatial service.
 *
 * All geographic filtering happens in SQL using PostGIS, never by comparing
 * location strings (spec 10 "Architecture Rules"). This module exists so the
 * coordinate convention is applied in exactly one place:
 *
 *   API / database: WGS84, SRID 4326, `latitude` and `longitude` named fields.
 *   PostGIS point:  ST_MakePoint(longitude, latitude) — x then y.
 *
 * The `geography` type is used rather than `geometry`, so ST_Distance and
 * ST_DWithin return metres without any projection maths, and the GiST index
 * `items_location_gist_idx` can be used for the radius predicate.
 */
import { query } from '../config/db.js';
import { toGeographyParam, validateCoordinatePair } from '../utils/geo.js';
import { badRequest } from '../utils/httpError.js';

/**
 * Returns items inside a radius, nearest first, using fn_items_within_radius
 * (which is defined in migration 013 and documented there).
 *
 * @param {{latitude: number, longitude: number, radiusMeters: number,
 *          reportType?: 'lost'|'found'|null, limit?: number}} params
 */
export async function findItemsWithinRadius(params) {
  const coordinateError = validateCoordinatePair(params.latitude, params.longitude);
  if (coordinateError) throw badRequest(coordinateError);

  const { rows } = await query(
    'SELECT item_id, report_type, distance_meters FROM fn_items_within_radius($1, $2, $3, $4, $5)',
    [params.latitude, params.longitude, params.radiusMeters, params.reportType ?? null, params.limit ?? 100]
  );

  return rows.map((row) => ({
    itemId: row.item_id,
    reportType: row.report_type,
    distanceMeters: row.distance_meters,
  }));
}

/**
 * Great-circle distance in metres between two stored items, computed by PostGIS.
 * Returns null when either report has no location.
 */
export async function distanceBetweenItems(itemIdA, itemIdB, client) {
  const runner = client ?? { query };
  const { rows } = await runner.query(
    `SELECT ST_Distance(a.location, b.location) AS metres
       FROM items a, items b
      WHERE a.item_id = $1 AND b.item_id = $2
        AND a.location IS NOT NULL AND b.location IS NOT NULL`,
    [itemIdA, itemIdB]
  );
  return rows.length ? rows[0].metres : null;
}

/** PostGIS version reported for documentation and diagnostics. */
export async function postgisVersion() {
  const { rows } = await query(
    `SELECT extversion AS version FROM pg_extension WHERE extname = 'postgis'`
  );
  return rows.length ? rows[0].version : null;
}

export { toGeographyParam, validateCoordinatePair };
export default { findItemsWithinRadius, distanceBetweenItems, postgisVersion, toGeographyParam };
