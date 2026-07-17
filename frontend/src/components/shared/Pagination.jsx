// frontend/src/components/shared/Pagination.jsx
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Reusable server-side pagination control.
 *
 * Props:
 *   page        — current page (1-indexed)
 *   totalPages  — total number of pages
 *   totalCount  — total record count (optional, for "X of Y" label)
 *   onPageChange — (newPage: number) => void
 */
export default function Pagination({ page, totalPages, totalCount, onPageChange }) {
  if (!totalPages || totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between mt-8 pt-6 border-t border-subtle">
      <span className="text-sm text-muted">
        Page {page} of {totalPages}
        {totalCount != null && ` · ${totalCount.toLocaleString()} total`}
      </span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page === 1}
          className="p-2 rounded-full border border-subtle text-loud disabled:opacity-40 disabled:cursor-not-allowed hover:bg-bg-primary transition-colors duration-300"
          aria-label="Previous page"
        >
          <ChevronLeft className="w-5 h-5" strokeWidth={1.5} />
        </button>
        <button
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page === totalPages}
          className="p-2 rounded-full border border-subtle text-loud disabled:opacity-40 disabled:cursor-not-allowed hover:bg-bg-primary transition-colors duration-300"
          aria-label="Next page"
        >
          <ChevronRight className="w-5 h-5" strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}
