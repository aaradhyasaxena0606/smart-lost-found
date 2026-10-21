/** Human-readable labels and badge styling for the controlled status values. */
import { Link } from 'react-router-dom';

const ITEM_STATUS = {
  open: { label: 'Open', className: 'badge badge--open' },
  matched: { label: 'Matched', className: 'badge badge--matched' },
  claimed: { label: 'Claimed', className: 'badge badge--claimed' },
  returned: { label: 'Returned', className: 'badge badge--returned' },
  closed: { label: 'Closed', className: 'badge badge--closed' },
  rejected: { label: 'Rejected', className: 'badge badge--rejected' },
};

const CLAIM_STATUS = {
  pending: { label: 'Pending review', className: 'badge badge--claimed' },
  approved: { label: 'Approved', className: 'badge badge--returned' },
  rejected: { label: 'Rejected', className: 'badge badge--rejected' },
  withdrawn: { label: 'Withdrawn', className: 'badge badge--closed' },
};

const MATCH_STATUS = {
  suggested: { label: 'Suggested', className: 'badge badge--matched' },
  dismissed: { label: 'Dismissed', className: 'badge badge--closed' },
  claimed: { label: 'Claimed', className: 'badge badge--claimed' },
  resolved: { label: 'Resolved', className: 'badge badge--returned' },
};

const REPORT_TYPE = {
  lost: { label: 'Lost', className: 'badge badge--lost' },
  found: { label: 'Found', className: 'badge badge--found' },
};

function Badge({ map, value, fallback }) {
  const entry = map[value] ?? { label: fallback ?? value ?? 'Unknown', className: 'badge' };
  return <span className={entry.className}>{entry.label}</span>;
}

export const ItemStatusBadge = ({ status }) => <Badge map={ITEM_STATUS} value={status} />;
export const ClaimStatusBadge = ({ status }) => <Badge map={CLAIM_STATUS} value={status} />;
export const MatchStatusBadge = ({ status }) => <Badge map={MATCH_STATUS} value={status} />;
export const ReportTypeBadge = ({ reportType }) => <Badge map={REPORT_TYPE} value={reportType} />;

export const ITEM_STATUS_OPTIONS = Object.entries(ITEM_STATUS).map(([value, entry]) => ({
  value,
  label: entry.label,
}));

export const CLAIM_STATUS_OPTIONS = Object.entries(CLAIM_STATUS).map(([value, entry]) => ({
  value,
  label: entry.label,
}));

export const MATCH_STATUS_OPTIONS = Object.entries(MATCH_STATUS).map(([value, entry]) => ({
  value,
  label: entry.label,
}));

/** Formats an ISO timestamp for display, falling back to a dash. */
export function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Renders a distance in metres as a tidy string. */
export function formatDistance(meters) {
  if (meters === null || meters === undefined) return null;
  return meters < 1000 ? `${Math.round(meters)} m away` : `${(meters / 1000).toFixed(2)} km away`;
}

/** Renders a coordinate pair as documented (latitude, longitude). */
export function formatCoordinates(location) {
  if (!location) return 'No coordinates recorded';
  return `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`;
}

/** A link used when an item reference appears inside another card. */
export function ItemLink({ itemId, title }) {
  return <Link to={`/items/${itemId}`}>{title}</Link>;
}

export default {
  ItemStatusBadge,
  ClaimStatusBadge,
  MatchStatusBadge,
  ReportTypeBadge,
  formatDateTime,
  formatDistance,
  formatCoordinates,
  ItemLink,
};
