// frontend/src/lib/exportXlsx.js
// Excel export for lists (DESIGN_RULES §16: every list exports; the file name
// says what and when). The xlsx library is loaded only when an export is made.
import toast from 'react-hot-toast';
import { exportName } from './format';
import { importWithReload } from './chunkReload';

/**
 * @param {object[]} rows
 * @param {{ header: string, value: (row: object) => any }[]} columns
 * @param {string} what — file name stem, e.g. "visit-requests"
 * @returns {Promise<boolean>}
 */
export async function downloadXlsx(rows, columns, what) {
  let XLSX;
  try {
    XLSX = await importWithReload(() => import('xlsx'));
  } catch (err) {
    console.error('[export] Could not load the Excel library:', err);
    toast.error('Could not create the Excel file. Please try again.');
    return false;
  }
  const data = rows.map((r) => Object.fromEntries(columns.map((c) => [c.header, c.value(r) ?? ''])));
  const ws = XLSX.utils.json_to_sheet(data, { header: columns.map((c) => c.header) });
  ws['!cols'] = columns.map((c) => ({ wch: Math.max(c.header.length, ...data.slice(0, 200).map((d) => String(d[c.header] ?? '').length)) + 2 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Export');
  const file = `${exportName(what)}.xlsx`;
  XLSX.writeFile(wb, file);
  toast.success(`${rows.length.toLocaleString('en-IN')} rows exported — ${file}`);
  return true;
}

/**
 * Fetches every page of a paginated list endpoint (for "export all").
 * @param {(page: number) => Promise<{ rows: object[], pages: number }>} fetchPage
 * @param {number} [maxPages]
 */
export async function fetchAllPages(fetchPage, maxPages = 50) {
  const out = [];
  let page = 1;
  let pages;
  do {
    const res = await fetchPage(page);
    out.push(...res.rows);
    pages = res.pages || 1;
    page += 1;
  } while (page <= pages && page <= maxPages);
  return out;
}
