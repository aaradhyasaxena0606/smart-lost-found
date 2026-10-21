/**
 * Browse and search reports (FR-11, FR-12).
 *
 * Filters are mirrored into the URL query string, so a search can be bookmarked,
 * shared and reloaded, and the browser Back button behaves as users expect.
 */
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { itemsApi } from '../api/endpoints.js';
import { useAsyncData } from '../hooks/useAsyncData.js';
import ItemCard from '../components/ItemCard.jsx';
import ItemFilters from '../components/ItemFilters.jsx';
import Pagination from '../components/Pagination.jsx';
import { Loading, EmptyState, ErrorMessage } from '../components/Feedback.jsx';

const FILTER_KEYS = [
  'q',
  'type',
  'categoryId',
  'status',
  'colour',
  'brand',
  'from',
  'to',
  'latitude',
  'longitude',
  'radiusMeters',
  'sort',
  'page',
  'limit',
];

export function ItemsPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = useMemo(() => {
    const value = {};
    for (const key of FILTER_KEYS) {
      const raw = searchParams.get(key);
      if (raw !== null && raw !== '') value[key] = raw;
    }
    return value;
  }, [searchParams]);

  const categoriesQuery = useAsyncData(() => itemsApi.categories(), []);

  const reportsQuery = useAsyncData(
    () => itemsApi.search({ limit: 9, ...filters }),
    [searchParams.toString()]
  );

  const updateFilters = useCallback(
    (patch) => {
      const next = new URLSearchParams(searchParams);
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined || value === null || value === '') next.delete(key);
        else next.set(key, String(value));
      }
      // Any filter change resets pagination, otherwise the user can land on an
      // empty page that looks like "no results".
      if (!('page' in patch)) next.delete('page');
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const resetFilters = useCallback(() => setSearchParams(new URLSearchParams(), { replace: true }), [setSearchParams]);

  const reports = reportsQuery.data ?? [];
  const meta = reportsQuery.meta;

  return (
    <div className="page">
      <header className="page__header">
        <h1>Browse campus reports</h1>
        <p>
          Search lost and found reports by keyword, category, colour, status, time or distance. Private verification
          details are never shown here.
        </p>
      </header>

      <ItemFilters
        categories={categoriesQuery.data ?? []}
        value={filters}
        onChange={updateFilters}
        onReset={resetFilters}
        busy={reportsQuery.loading}
      />

      {reportsQuery.loading ? <Loading label="Searching reports…" /> : null}
      <ErrorMessage error={reportsQuery.error} onRetry={reportsQuery.reload} />

      {!reportsQuery.loading && !reportsQuery.error && reports.length === 0 ? (
        <EmptyState
          title="No reports match your search"
          description="Try a broader keyword, remove a filter, or widen the radius."
          action={
            <button type="button" className="button button--secondary" onClick={resetFilters}>
              Clear all filters
            </button>
          }
        />
      ) : null}

      {reports.length > 0 ? (
        <>
          <ul className="item-grid">
            {reports.map((item) => (
              <ItemCard key={item.itemId} item={item} />
            ))}
          </ul>
          <Pagination meta={meta} onPageChange={(page) => updateFilters({ page })} />
        </>
      ) : null}
    </div>
  );
}

export default ItemsPage;
