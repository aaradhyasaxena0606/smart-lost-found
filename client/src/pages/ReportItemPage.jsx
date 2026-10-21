/**
 * Report a lost or found item (FR-06, FR-07, FR-09, FR-10).
 *
 * One component serves both modes: the only differences are the labels, the hint
 * text and the reportType value sent to the API. The private verification hint is
 * explicitly described as access-restricted so users understand who can see it.
 */
import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { itemsApi } from '../api/endpoints.js';
import { Field, ErrorMessage, SuccessMessage, Loading } from '../components/Feedback.jsx';

const COPY = {
  lost: {
    heading: 'Report a lost item',
    intro: 'Describe what you lost and where you last had it. We will suggest possible found reports.',
    titlePlaceholder: 'e.g. Lost black iPhone with a cracked screen',
    descriptionHint: 'Include distinguishing details such as marks, stickers, engravings or contents.',
    dateLabel: 'When did you lose it?',
    locationLabel: 'Where did you last have it?',
    hintLabel: 'Private detail only the owner would know (optional)',
    hintHelp:
      'Used to verify ownership if someone finds your item. It is never shown in public listings, and only you and administrators can read it.',
    hintPlaceholder: 'e.g. a cat sticker on the back and a crack in the top-left corner',
  },
  found: {
    heading: 'Report a found item',
    intro: 'Describe what you found and where. We will look for matching lost reports and can notify the owner.',
    titlePlaceholder: 'e.g. Found a black phone on a library bench',
    descriptionHint: 'Describe the item as you found it, without listing private details in the public description.',
    dateLabel: 'When did you find it?',
    locationLabel: 'Where did you find it?',
    hintLabel: 'Private verification detail (optional, but recommended)',
    hintHelp:
      'Recorded so you (and administrators) can check that a claimant really owns the item. It is never included in public listing responses.',
    hintPlaceholder: 'e.g. lock screen photo of a golden retriever',
  },
};

function toLocalDateTimeInput(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function ReportItemPage() {
  const { mode } = useParams();
  const reportType = mode === 'found' ? 'found' : 'lost';
  const copy = COPY[reportType];

  const [categories, setCategories] = useState([]);
  const [categoriesError, setCategoriesError] = useState(null);
  const [form, setForm] = useState(() => ({
    title: '',
    description: '',
    categoryId: '',
    colour: '',
    brand: '',
    eventTime: toLocalDateTimeInput(new Date()),
    locationName: '',
    latitude: '',
    longitude: '',
    verificationHint: '',
  }));
  const [created, setCreated] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [imageFile, setImageFile] = useState(null);
  const [imageMessage, setImageMessage] = useState(null);

  useEffect(() => {
    let cancelled = false;
    itemsApi
      .categories()
      .then(({ data }) => {
        if (!cancelled) setCategories(data);
      })
      .catch((caught) => {
        if (!cancelled) setCategoriesError(caught);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const set = (key) => (event) => setForm((previous) => ({ ...previous, [key]: event.target.value }));

  const fieldErrors = error?.fieldErrors ?? {};

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setImageMessage(null);

    // The API requires latitude and longitude together; omit both when blank.
    const hasCoordinates = form.latitude !== '' && form.longitude !== '';

    const payload = {
      reportType,
      categoryId: Number(form.categoryId),
      title: form.title.trim(),
      description: form.description.trim(),
      colour: form.colour.trim() || null,
      brand: form.brand.trim() || null,
      eventTime: new Date(form.eventTime).toISOString(),
      locationName: form.locationName.trim() || null,
      latitude: hasCoordinates ? Number(form.latitude) : null,
      longitude: hasCoordinates ? Number(form.longitude) : null,
      verificationHint: form.verificationHint.trim() || null,
    };

    try {
      const { data } = await itemsApi.create(payload);
      setCreated(data);

      // The report exists at this point; an image failure must not look like a
      // failed report creation.
      if (imageFile) {
        try {
          await itemsApi.uploadImage(data.itemId, imageFile);
          setImageMessage({ ok: true, text: 'The photo was uploaded.' });
        } catch (caught) {
          setImageMessage({ ok: false, text: `The report was saved, but the photo failed: ${caught.message}` });
        }
      }
    } catch (caught) {
      setError(caught);
    } finally {
      setSubmitting(false);
    }
  };

  if (created) {
    return (
      <div className="page page--narrow">
        <div className="card">
          <h1>Report submitted</h1>
          <SuccessMessage>
            Your {reportType} report <strong>{created.title}</strong> is now visible to the campus community.
          </SuccessMessage>
          {imageMessage ? (
            <p className={imageMessage.ok ? 'text-success' : 'text-error'}>{imageMessage.text}</p>
          ) : null}
          <p>
            We searched for possible matches immediately. {created.matchSummary?.matchCount ?? 0} candidate
            {created.matchSummary?.matchCount === 1 ? '' : 's'} found so far; the best score is{' '}
            {created.matchSummary?.bestScore ?? 0}%.
          </p>
          {created.privateDetails?.verificationHint ? (
            <p className="notice">
              Your private verification detail is stored and will only be visible to you and administrators.
            </p>
          ) : null}
          <div className="button-row">
            <Link className="button" to={`/items/${created.itemId}`}>
              View the report
            </Link>
            <Link className="button button--secondary" to="/matches">
              Review candidate matches
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page page--narrow">
      <header className="page__header">
        <h1>{copy.heading}</h1>
        <p>{copy.intro}</p>
        <p className="page__switch">
          Looking to report the opposite? <Link to={`/report/${reportType === 'lost' ? 'found' : 'lost'}`}>
            Report a {reportType === 'lost' ? 'found' : 'lost'} item
          </Link>
          .
        </p>
      </header>

      <ErrorMessage error={error} />
      <ErrorMessage error={categoriesError} />

      <form className="card form" onSubmit={handleSubmit} noValidate>
        {categories.length === 0 && !categoriesError ? <Loading label="Loading categories…" /> : null}

        <Field id="item-title" label="Title" required error={fieldErrors.title}>
          <input
            id="item-title"
            type="text"
            required
            minLength={3}
            maxLength={200}
            value={form.title}
            onChange={set('title')}
            placeholder={copy.titlePlaceholder}
            aria-invalid={Boolean(fieldErrors.title)}
          />
        </Field>

        <Field id="item-description" label="Description" required hint={copy.descriptionHint} error={fieldErrors.description}>
          <textarea
            id="item-description"
            required
            minLength={10}
            maxLength={5000}
            rows={5}
            value={form.description}
            onChange={set('description')}
            aria-invalid={Boolean(fieldErrors.description)}
          />
        </Field>

        <div className="form__row">
          <Field id="item-category" label="Category" required error={fieldErrors.categoryId}>
            <select
              id="item-category"
              required
              value={form.categoryId}
              onChange={set('categoryId')}
              aria-invalid={Boolean(fieldErrors.categoryId)}
            >
              <option value="">Select a category…</option>
              {categories.map((category) => (
                <option key={category.categoryId} value={category.categoryId}>
                  {category.name}
                </option>
              ))}
            </select>
          </Field>

          <Field id="item-event-time" label={copy.dateLabel} required error={fieldErrors.eventTime}>
            <input id="item-event-time" type="datetime-local" required value={form.eventTime} onChange={set('eventTime')} />
          </Field>
        </div>

        <div className="form__row">
          <Field id="item-colour" label="Colour" error={fieldErrors.colour}>
            <input id="item-colour" type="text" maxLength={50} value={form.colour} onChange={set('colour')} placeholder="e.g. black" />
          </Field>
          <Field id="item-brand" label="Brand" error={fieldErrors.brand}>
            <input id="item-brand" type="text" maxLength={100} value={form.brand} onChange={set('brand')} placeholder="e.g. Apple" />
          </Field>
        </div>

        <Field id="item-location-name" label={copy.locationLabel} error={fieldErrors.locationName}>
          <input
            id="item-location-name"
            type="text"
            maxLength={200}
            value={form.locationName}
            onChange={set('locationName')}
            placeholder="e.g. Main Library, Level 2"
          />
        </Field>

        <fieldset className="form__group">
          <legend>Coordinates (optional, improves matching)</legend>
          <p className="field-hint">
            Decimal degrees, WGS84: latitude first, then longitude. Provide either both values or neither.
          </p>
          <div className="form__row">
            <Field id="item-latitude" label="Latitude" error={fieldErrors.latitude}>
              <input
                id="item-latitude"
                type="number"
                step="any"
                min="-90"
                max="90"
                value={form.latitude}
                onChange={set('latitude')}
                placeholder="51.5007"
                aria-invalid={Boolean(fieldErrors.latitude)}
              />
            </Field>
            <Field id="item-longitude" label="Longitude" error={fieldErrors.longitude}>
              <input
                id="item-longitude"
                type="number"
                step="any"
                min="-180"
                max="180"
                value={form.longitude}
                onChange={set('longitude')}
                placeholder="-0.1246"
                aria-invalid={Boolean(fieldErrors.longitude)}
              />
            </Field>
          </div>
        </fieldset>

        <Field id="item-verification" label={copy.hintLabel} hint={copy.hintHelp} error={fieldErrors.verificationHint}>
          <textarea
            id="item-verification"
            rows={3}
            maxLength={500}
            value={form.verificationHint}
            onChange={set('verificationHint')}
            placeholder={copy.hintPlaceholder}
          />
        </Field>

        <Field
          id="item-image"
          label="Photo (optional)"
          hint="JPEG, PNG or WebP. The file is validated by type and size on the server."
          error={fieldErrors.image}
        >
          <input
            id="item-image"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => setImageFile(event.target.files?.[0] ?? null)}
          />
        </Field>

        <button type="submit" className="button" disabled={submitting}>
          {submitting ? 'Submitting…' : 'Submit report'}
        </button>
      </form>
    </div>
  );
}

export default ReportItemPage;
