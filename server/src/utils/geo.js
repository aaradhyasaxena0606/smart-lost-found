/**
 * Geographic helpers.
 *
 * Coordinate convention used throughout the project:
 *   * API and database both use WGS84 (SRID 4326).
 *   * API request/response fields are named `latitude` and `longitude`
 *     in the familiar human order.
 *   * When building a PostGIS point the ORDER IS SWAPPED to
 *     ST_MakePoint(longitude, latitude) because PostGIS uses (x, y).
 *
 * Documented in docs/database-design.md ("Coordinate order").
 */

export const EARTH_RADIUS_METERS = 6_371_008.8;

export function isValidLatitude(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isValidLongitude(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= -180 && value <= 180;
}

/**
 * Validates a latitude/longitude pair. Either both are provided or neither is.
 * @param {number|null|undefined} latitude
 * @param {number|null|undefined} longitude
 * @returns {string|null} an error message, or null when valid
 */
export function validateCoordinatePair(latitude, longitude) {
  const hasLat = latitude !== null && latitude !== undefined;
  const hasLon = longitude !== null && longitude !== undefined;

  if (!hasLat && !hasLon) return null;
  if (hasLat !== hasLon) {
    return 'latitude and longitude must be provided together.';
  }
  if (!isValidLatitude(latitude)) return 'latitude must be a number between -90 and 90.';
  if (!isValidLongitude(longitude)) return 'longitude must be a number between -180 and 180.';
  return null;
}

/**
 * Builds a PostGIS geography point expression for use as a query parameter.
 * The caller passes (longitude, latitude) exactly once, here, so the swap can
 * never be got wrong elsewhere.
 *
 * Returns the WKT/EWKT string that PostgreSQL casts to geography.
 */
export function toGeographyParam(latitude, longitude) {
  if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) {
    return null;
  }
  return `SRID=4326;POINT(${longitude} ${latitude})`;
}

/**
 * Great-circle distance in metres. Mirrors PostGIS ST_Distance on geography and
 * is used only by tests/UI estimates; the database remains authoritative for
 * spatial filtering.
 */
export function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(a));
}

export default {
  EARTH_RADIUS_METERS,
  isValidLatitude,
  isValidLongitude,
  validateCoordinatePair,
  toGeographyParam,
  haversineMeters,
};
