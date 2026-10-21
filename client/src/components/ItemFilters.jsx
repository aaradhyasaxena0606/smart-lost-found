/**
 * Search and filter controls for the item listings.
 *
 * The filter values are owned by the page (and mirrored into the URL), so a
 * filtered view can be linked and reloaded.
 */
import { Field } from './Feedback.jsx';
import { ITEM_STATUS_OPTIONS } from './Badges.jsx';

/**
 * @param {{
 *   categories: {categoryId: number, name: string}[],
 *   value: Record<string, string>,
 *   onChange: (patch: Record<string, string>) => void,
 *   onReset: () => void,
 *   busy?: boolean
 * }} props
 */
export function ItemFilters({ categories, value, onChange, onReset, busy = false }) {
  const set = (key) => (event) => onChange({ [key]: event.target.value });

  return (
    <form
      className="filters"
      onSubmit={(event) => event.preventDefault()}
      aria-label="Search and filter reports"
      role="search"
    >
      <Field id="filter-q" label="Keyword">
        <input
          id="filter-q"
          type="search"
          value={value.q ?? ''}
          onChange={set('q')}
          placeholder="e.g. iPhone, umbrella, keys"
          autoComplete="off"
        />
      </Field>

      <Field id="filter-type" label="Report type">
        <select id="filter-type" value={value.type ?? ''} onChange={set('type')}>
          <option value="">Lost and found</option>
          <option value="lost">Lost only</option>
          <option value="found">Found only</option>
        </select>
      </Field>

      <Field id="filter-category" label="Category">
        <select id="filter-category" value={value.categoryId ?? ''} onChange={set('categoryId')}>
          <option value="">All categories</option>
          {categories.map((category) => (
            <option key={category.categoryId} value={category.categoryId}>
              {category.name}
            </option>
          ))}
        </select>
      </Field>

      <Field id="filter-status" label="Status">
        <select id="filter-status" value={value.status ?? ''} onChange={set('status')}>
          <option value="">Any status</option>
          {ITEM_STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>

      <Field id="filter-colour" label="Colour">
        <input id="filter-colour" type="text" value={value.colour ?? ''} onChange={set('colour')} placeholder="e.g. black" />
      </Field>

      <Field id="filter-sort" label="Sort by">
        <select id="filter-sort" value={value.sort ?? 'recent'} onChange={set('sort')}>
          <option value="recent">Most recently reported</option>
          <option value="event_time">Event date</option>
          <option value="relevance">Best keyword match</option>
          <option value="distance">Distance from me</option>
        </select>
      </Field>

      <fieldset className="filters__location">
        <legend>Location filter (optional)</legend>
        <p className="filters__hint">
          Provide both coordinates to search within a radius. Coordinates are latitude and longitude in decimal degrees.
        </p>
        <div className="filters__row">
          <Field id="filter-latitude" label="Latitude">
            <input
              id="filter-latitude"
              type="number"
              step="any"
              min="-90"
              max="90"
              value={value.latitude ?? ''}
              onChange={set('latitude')}
              placeholder="51.5007"
            />
          </Field>
          <Field id="filter-longitude" label="Longitude">
            <input
              id="filter-longitude"
              type="number"
              step="any"
              min="-180"
              max="180"
              value={value.longitude ?? ''}
              onChange={set('longitude')}
              placeholder="-0.1246"
            />
          </Field>
          <Field id="filter-radius" label="Radius (metres)">
            <input
              id="filter-radius"
              type="number"
              min="1"
              max="200000"
              step="1"
              value={value.radiusMeters ?? ''}
              onChange={set('radiusMeters')}
              placeholder="1500"
            />
          </Field>
        </div>
        <button
          type="button"
          className="button button--secondary button--small"
          onClick={() => {
            // A quick way to search around the demo campus reference point.
            onChange({ latitude: '51.5007', longitude: '-0.1246', radiusMeters: '1500' });
          }}
        >
          Use the campus reference point
        </button>
      </fieldset>

      <div className="filters__actions">
        <button type="button" className="button button--secondary" onClick={onReset} disabled={busy}>
          Clear filters
        </button>
        {busy ? <span className="filters__busy" role="status">Searching…</span> : null}
      </div>
    </form>
  );
}

export default ItemFilters;
