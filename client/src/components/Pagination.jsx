/**
 * Pagination control.
 * Renders nothing when there is only one page, and always exposes the page count
 * so a result set is never silently truncated (NFR-08).
 */
export function Pagination({ meta, onPageChange }) {
  if (!meta || !meta.totalPages || meta.totalPages <= 1) {
    return meta ? <p className="pagination__summary">{meta.total} result{meta.total === 1 ? '' : 's'}</p> : null;
  }

  const { page, totalPages, total, hasNextPage, hasPreviousPage } = meta;

  return (
    <nav className="pagination" aria-label="Pagination">
      <button
        type="button"
        className="button button--secondary"
        onClick={() => onPageChange(page - 1)}
        disabled={!hasPreviousPage}
      >
        Previous
      </button>
      <span className="pagination__summary" aria-live="polite">
        Page {page} of {totalPages} · {total} result{total === 1 ? '' : 's'}
      </span>
      <button
        type="button"
        className="button button--secondary"
        onClick={() => onPageChange(page + 1)}
        disabled={!hasNextPage}
      >
        Next
      </button>
    </nav>
  );
}

export default Pagination;
