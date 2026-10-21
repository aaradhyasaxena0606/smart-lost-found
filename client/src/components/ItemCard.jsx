/**
 * Item card. Shows only public-safe fields: never the private verification hint.
 */
import { Link } from 'react-router-dom';
import { assetUrl } from '../api/client.js';
import { ItemStatusBadge, ReportTypeBadge, formatDateTime, formatDistance, formatCoordinates } from './Badges.jsx';

export function ItemCard({ item, onSelect }) {
  const image = item.images?.[0];
  const distance = formatDistance(item.distanceMeters);

  const body = (
    <>
      <div className="item-card__media">
        {image ? (
          <img src={assetUrl(image.imageUrl)} alt={image.altText || `Photo of ${item.title}`} loading="lazy" />
        ) : (
          <div className="item-card__media-placeholder" aria-hidden="true">
            No photo
          </div>
        )}
      </div>
      <div className="item-card__body">
        <div className="item-card__badges">
          <ReportTypeBadge reportType={item.reportType} />
          <ItemStatusBadge status={item.status} />
          {distance ? <span className="badge badge--muted">{distance}</span> : null}
        </div>
        <h3 className="item-card__title">{item.title}</h3>
        <p className="item-card__meta">
          {item.category?.name}
          {item.colour ? ` · ${item.colour}` : ''}
          {item.brand ? ` · ${item.brand}` : ''}
        </p>
        <p className="item-card__description">{item.description}</p>
        <dl className="item-card__facts">
          <div>
            <dt>{item.reportType === 'lost' ? 'Lost on' : 'Found on'}</dt>
            <dd>{formatDateTime(item.eventTime)}</dd>
          </div>
          <div>
            <dt>Location</dt>
            <dd>{item.locationName || formatCoordinates(item.location)}</dd>
          </div>
          <div>
            <dt>Reported by</dt>
            <dd>{item.reporter?.fullName}</dd>
          </div>
        </dl>
      </div>
    </>
  );

  if (onSelect) {
    return (
      <li className="item-card">
        <button type="button" className="item-card__button" onClick={() => onSelect(item)}>
          {body}
        </button>
      </li>
    );
  }

  return (
    <li className="item-card">
      <Link to={`/items/${item.itemId}`} className="item-card__link">
        {body}
      </Link>
    </li>
  );
}

export default ItemCard;
