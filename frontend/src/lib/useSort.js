// frontend/src/lib/useSort.js
// Column sorting for tables (DESIGN_RULES §8): clicking a header cycles
// ascending → descending → off; natural order ("Item 2" before "Item 10");
// empty values always last.
import { useMemo, useState } from 'react';

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const isEmpty = (v) => v === null || v === undefined || v === '';

function compare(a, b) {
  if (isEmpty(a) && isEmpty(b)) return 0;
  if (isEmpty(a)) return 1;
  if (isEmpty(b)) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const da = Date.parse(a), db = Date.parse(b);
  if (/^\d{4}-\d{2}-\d{2}/.test(String(a)) && !Number.isNaN(da) && !Number.isNaN(db)) return da - db;
  return collator.compare(String(a), String(b));
}

/**
 * @param {object[]} rows
 * @param {Record<string, (row: object) => any>} [getters] — value per sort key (default row[key])
 * @returns {{ rows: object[], sort: { key: string|null, dir: 'asc'|'desc'|null }, onSort: (key: string) => void }}
 */
export default function useSort(rows, getters = {}) {
  const [sort, setSort] = useState({ key: null, dir: null });

  const onSort = (key) => setSort((s) => {
    if (s.key !== key) return { key, dir: 'asc' };
    if (s.dir === 'asc') return { key, dir: 'desc' };
    return { key: null, dir: null };
  });

  const sorted = useMemo(() => {
    if (!sort.key || !Array.isArray(rows)) return rows;
    const get = getters[sort.key] ?? ((r) => r?.[sort.key]);
    const out = [...rows].sort((x, y) => {
      const a = get(x), b = get(y);
      // empties stay last in both directions
      if (isEmpty(a) !== isEmpty(b)) return isEmpty(a) ? 1 : -1;
      const c = compare(a, b);
      return sort.dir === 'desc' ? -c : c;
    });
    return out;
  // getters is a stable object literal per render in callers; key/dir drive the memo
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort.key, sort.dir]);

  return { rows: sorted, sort, onSort };
}
