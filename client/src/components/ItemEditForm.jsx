/**
 * Owner/admin form for editing an existing report (FR-08).
 *
 * The API has always supported PATCH /items/:itemId, but the UI previously only
 * exposed status changes, so a typo in a title or a missing coordinate could not
 * be corrected. This component closes that gap.
 *
 * Only fields the API allows are sent — `reportType` is immutable by design, so
 * a "lost" report can never silently become a "found" one.
 */
import { useState } from 'react';
import { itemsApi } from '../api/endpoints.js';
import { Field, ErrorMessage } from './Feedback.jsx';

function toLocalDateTimeInput(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function ItemEditForm({ item, categories, onSaved, onCancel }) {
  const [form, setForm] = useState(() => ({
    title: item.title ?? '',
    description: item.description ?? '',
    categoryId: String(item.category?.categoryId ?? ''),
    colour: item.colour ?? '',
    brand: item.brand ?? '',
    eventTime: toLocalDateTimeInput(item.eventTime),
    locationName: item.locationName ?? '',
    latitude: item.location?.latitude !== null && item.location?.latitude !== undefined ? String(item.location.latitude) : '',
    longitude: item.location?.longitude !== null && item.location?.longitude !== undefined ? String(item.location.longitude) : '',
    verificationHint: item.privateDetails?.verificationHint ?? '',
  }));
  const [error, setError] = useState(null);
  const [localError, setLocalError] = useState(null);
  const [saving, setSaving] = useState(false);

  const set = (key) => (event) => setForm((previous) => ({ ...previous, [key]: event.target.value }));
  const fieldErrors = error?.fieldErrors ?? {};

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setLocalError(null);

    const hasLat = form.latitude.trim() !== '';
    const hasLon = form.longitude.trim() !== '';
    if (hasLat !== hasLon) {
      setLocalError('Provide both latitude and longitude, or leave both empty to remove the location.');
      return;
    }

    setSaving(true);
    try {
      await itemsApi.update(item.itemId, {
        title: form.title.trim(),
        description: form.description.trim(),
        categoryId: Number(form.categoryId),
        colour: form.colour.trim() || null,
        brand: form.brand.trim() || null,
        eventTime: new Date(form.eventTime).toISOString(),
        locationName: form.locationName.trim() || null,
        latitude: hasLat ? Number(form.latitude) : null,
        longitude: hasLon ? Number(form.longitude) : null,
        verificationHint: form.verificationHint.trim() || null,
      });
      onSaved?.();
    } catch (caught) {
      setError(caught);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      <h3>Edit report details</h3>
      <p className="field-hint">
        The report type ({item.reportType}) cannot be changed. Saving recalculates candidate matches.
      </p>

      {localError ? (
        <div className="state state--error" role="alert">
          {localError}
        </div>
      ) : null}
      <ErrorMessage error={error} />

      <Field id="edit-title" label="Title" required error={fieldErrors.title}>
        <input id="edit-title" type="text" required minLength={3} maxLength={200} value={form.title} onChange={set('title')} />
      </Field>

      <Field id="edit-description" label="Description" required error={fieldErrors.description}>
        <textarea id="edit-description" required minLength={10} maxLength={5000} rows={4} value={form.description} onChange={set('description')} />
      </Field>

      <div className="form__row">
        <Field id="edit-category" label="Category" required error={fieldErrors.categoryId}>
          <select id="edit-category" required value={form.categoryId} onChange={set('categoryId')}>
            <option value="">Select a category…</option>
            {categories.map((category) => (
              <option key={category.categoryId} value={category.categoryId}>
                {category.name}
              </option>
            ))}
          </select>
        </Field>

        <Field id="edit-event-time" label="Event date and time" required error={fieldErrors.eventTime}>
          <input id="edit-event-time" type="datetime-local" required value={form.eventTime} onChange={set('eventTime')} />
        </Field>
      </div>

      <div className="form__row">
        <Field id="edit-colour" label="Colour" error={fieldErrors.colour}>
          <input id="edit-colour" type="text" maxLength={50} value={form.colour} onChange={set('colour')} />
        </Field>
        <Field id="edit-brand" label="Brand" error={fieldErrors.brand}>
          <input id="edit-brand" type="text" maxLength={100} value={form.brand} onChange={set('brand')} />
        </Field>
      </div>

      <Field id="edit-location-name" label="Location name" error={fieldErrors.locationName}>
        <input id="edit-location-name" type="text" maxLength={200} value={form.locationName} onChange={set('locationName')} />
      </Field>

      <fieldset className="form__group">
        <legend>Coordinates</legend>
        <p className="field-hint">Decimal degrees (WGS84). Leave both empty to remove the location.</p>
        <div className="form__row">
          <Field id="edit-latitude" label="Latitude" error={fieldErrors.latitude}>
            <input id="edit-latitude" type="number" step="any" min="-90" max="90" value={form.latitude} onChange={set('latitude')} />
          </Field>
          <Field id="edit-longitude" label="Longitude" error={fieldErrors.longitude}>
            <input id="edit-longitude" type="number" step="any" min="-180" max="180" value={form.longitude} onChange={set('longitude')} />
          </Field>
        </div>
      </fieldset>

      <Field
        id="edit-verification"
        label="Private verification detail"
        hint="Visible only to you and administrators. Never included in public responses."
        error={fieldErrors.verificationHint}
      >
        <textarea id="edit-verification" rows={3} maxLength={500} value={form.verificationHint} onChange={set('verificationHint')} />
      </Field>

      <div className="button-row">
        <button type="submit" className="button" disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button type="button" className="button button--secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export default ItemEditForm;
