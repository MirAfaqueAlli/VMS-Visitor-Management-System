// frontend/src/components/shared/Pagination.jsx
// Server-side pagination under a table: "Page 2 of 7 · 134 total" + prev / next.
import { ChevronLeft, ChevronRight } from '../icons';

/**
 * Props:
 *   page        — current page (1-indexed)
 *   totalPages  — total number of pages
 *   totalCount  — total record count (optional, for the label)
 *   onPageChange — (newPage: number) => void
 */
export default function Pagination({ page, totalPages, totalCount, onPageChange }) {
  if (!totalPages || totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between gap-3 pt-3 mt-1 border-t border-line text-[12px] text-muted">
      <span className="tabular">
        Page <b className="text-ink font-semibold">{page}</b> of {totalPages}
        {totalCount != null && ` · ${Number(totalCount).toLocaleString('en-IN')} total`}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page === 1}
          className="btn-outline btn-sm"
          aria-label="Previous page"
          title="Previous page"
        >
          <ChevronLeft size={13} /> Previous
        </button>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page === totalPages}
          className="btn-outline btn-sm"
          aria-label="Next page"
          title="Next page"
        >
          Next <ChevronRight size={13} />
        </button>
      </div>
    </div>
  );
}
