/** My reports, including soft-deleted ones on request (FR-17). */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { itemsApi } from '../api/endpoints.js';
import { useAsyncData } from '../hooks/useAsyncData.js';
import ItemCard from '../components/ItemCard.jsx';
import Pagination from '../components/Pagination.jsx';
import { Loading, ErrorMessage, EmptyState } from '../components/Feedback.jsx';

const TABS = [
  { key: '', label: 'All' },
  { key: 'lost', label: 'Lost' },
  { key: 'found', label: 'Found' },
];

export function MyItemsPage() {
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [includeDeleted, setIncludeDeleted] = useState(false);

  const query = useAsyncData(
    () => itemsApi.listMine({ type: type || undefined, page, limit: 9, includeDeleted: includeDeleted ? true : undefined }),
    [type, page, includeDeleted]
  );

  return (
    <div className="page">
      <header className="page__header">
        <h1>My reports</h1>
        <p>Everything you have reported, with its current lifecycle status.</p>
      </header>

      <div className="toolbar">
        <div role="tablist" aria-label="Filter by report type" className="tabs">
          {TABS.map((tab) => (
            <button
              key={tab.key || 'all'}
              type="button"
              role="tab"
              aria-selected={type === tab.key}
              className={type === tab.key ? 'tab tab--active' : 'tab'}
              onClick={() => {
                setType(tab.key);
                setPage(1);
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={includeDeleted}
            onChange={(event) => {
              setIncludeDeleted(event.target.checked);
              setPage(1);
            }}
          />
          Show deleted reports
        </label>

        <div className="button-row">
          <Link className="button" to="/report/lost">
            Report a lost item
          </Link>
          <Link className="button button--secondary" to="/report/found">
            Report a found item
          </Link>
        </div>
      </div>

      {query.loading ? <Loading label="Loading your reports…" /> : null}
      <ErrorMessage error={query.error} onRetry={query.reload} />

      {!query.loading && !query.error && (query.data ?? []).length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          description="Reports you create will appear here with their status."
          action={
            <Link className="button" to="/report/lost">
              Report a lost item
            </Link>
          }
        />
      ) : null}

      {(query.data ?? []).length > 0 ? (
        <>
          <ul className="item-grid">
            {query.data.map((item) => (
              <ItemCard key={item.itemId} item={item} />
            ))}
          </ul>
          <Pagination meta={query.meta} onPageChange={setPage} />
        </>
      ) : null}
    </div>
  );
}

export default MyItemsPage;
