/**
 * Match card: shows a candidate pair with its explainable score breakdown.
 * Scores are presented as advisory rankings, never as proof of ownership.
 */
import { Link } from 'react-router-dom';
import { MatchStatusBadge, ReportTypeBadge, formatDateTime } from './Badges.jsx';

function ScoreBar({ label, value }) {
  const missing = value === null || value === undefined;
  const percent = missing ? 0 : Math.max(0, Math.min(100, value));

  return (
    <div className="score">
      <div className="score__label">
        <span>{label}</span>
        <span aria-hidden="true">{missing ? 'not compared' : `${percent}%`}</span>
      </div>
      <div
        className="score__track"
        role="img"
        aria-label={`${label}: ${missing ? 'not compared' : `${percent} out of 100`}`}
      >
        <div className="score__fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

const SIDE_LABELS = { lost: 'Lost report', found: 'Found report' };

function MatchSide({ item }) {
  return (
    <div className="match-side">
      <div className="match-side__header">
        <ReportTypeBadge reportType={item.reportType} />
        {item.isMine ? <span className="badge badge--mine">Your report</span> : null}
      </div>
      <h4>
        <Link to={`/items/${item.itemId}`}>{item.title}</Link>
      </h4>
      <p className="item-card__meta">
        {item.category?.name}
        {item.colour ? ` · ${item.colour}` : ''}
        {item.brand ? ` · ${item.brand}` : ''}
      </p>
      <dl className="item-card__facts">
        <div>
          <dt>{item.reportType === 'lost' ? 'Lost on' : 'Found on'}</dt>
          <dd>{formatDateTime(item.eventTime)}</dd>
        </div>
        <div>
          <dt>Location</dt>
          <dd>{item.locationName || 'Not recorded'}</dd>
        </div>
      </dl>
    </div>
  );
}

export function MatchCard({ match, onDismiss, busy }) {
  // Rendered inline rather than via formatDistance(), which appends "away".
  const distance =
    match.distanceMeters === null || match.distanceMeters === undefined
      ? null
      : match.distanceMeters < 1000
        ? `${Math.round(match.distanceMeters)} m`
        : `${(match.distanceMeters / 1000).toFixed(2)} km`;
  const reasons = Array.isArray(match.reasons) ? match.reasons : [];

  return (
    <li className="match-card">
      <header className="match-card__header">
        <div>
          <strong className="match-card__score">{match.overallScore}%</strong>
          <span className="match-card__score-label"> candidate score</span>
        </div>
        <MatchStatusBadge status={match.matchStatus} />
      </header>

      <p className="match-card__disclaimer">
        A score ranks candidates by similarity of category, wording, time and distance. It is a suggestion and does
        not prove ownership — an administrator decides claims.
      </p>

      <div className="match-card__sides">
        <MatchSide item={match.lostItem} />
        <MatchSide item={match.foundItem} />
      </div>

      {distance ? (
        <p className="match-card__distance">The two reports are about {distance} apart.</p>
      ) : (
        <p className="match-card__distance">Distance not compared: at least one report has no location.</p>
      )}

      <details className="match-card__reasons">
        <summary>Why these two reports were suggested</summary>
        <ul>
          {reasons.map((reason) => (
            <li key={reason.code}>
              <strong>{reason.label}</strong>
              {reason.detail ? ` — ${reason.detail}` : ''}
            </li>
          ))}
        </ul>
      </details>

      <div className="match-card__actions">
        <Link className="button" to={`/items/${match.foundItem.itemId}`}>
          Open the {SIDE_LABELS.found}
        </Link>
        {onDismiss && match.matchStatus === 'suggested' ? (
          <button type="button" className="button button--secondary" onClick={() => onDismiss(match)} disabled={busy}>
            Dismiss suggestion
          </button>
        ) : null}
      </div>
    </li>
  );
}

export default MatchCard;
