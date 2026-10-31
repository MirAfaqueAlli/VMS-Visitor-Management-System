// frontend/src/lib/usePaged.js
// Client-side paging for lists the API returns whole (today's gate lists, a
// visitor's own visits). Pair with <Pagination>; the page clamps when filters
// shrink the list, so no reset effect is needed.
import { useState } from "react";

/**
 * @param {Array} rows      the full (already filtered + sorted) list
 * @param {number} pageSize rows per page
 * @returns {{ rows: Array, page: number, setPage: Function, totalPages: number, total: number }}
 */
export default function usePaged(rows, pageSize = 20) {
  const [page, setPage] = useState(1);
  const list = rows ?? [];
  const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
  const current = Math.min(page, totalPages);
  return {
    rows: list.slice((current - 1) * pageSize, current * pageSize),
    page: current,
    setPage,
    totalPages,
    total: list.length,
  };
}
