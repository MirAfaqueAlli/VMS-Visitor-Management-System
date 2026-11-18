// frontend/src/lib/officialReport.js
// Official report exports (Excel / PDF) shared by Reports and Audit logs.
import toast from 'react-hot-toast';
import { importWithReload } from './chunkReload';

// ─────────────────────── official report exports (Excel / PDF) ─────────────────
// Government report layout, black and white: a centred letterhead (organisation,
// unit, report title, filters, when generated), then a fully ruled table with a
// serial-number column. The libraries (~1 MB) load only when an export is made.

const ORG_NAME = 'ODISHA HYDRO POWER CORPORATION LTD.';
const ORG_SUB  = '(A Government of Odisha Undertaking)';

/** The signed-in user's own unit ("UNIT 2 (UT2)") — for unit-level users, whose reports cover only it. */
function ownUnitLabel() {
  try {
    const u = JSON.parse(localStorage.getItem('vms_user') || 'null');
    if (!u || ['super_admin', 'global_auditor'].includes(u.role_type)) {
      const active = JSON.parse(localStorage.getItem('vms_active_unit') || 'null');   // a super admin managing a unit
      return active?.name || null;
    }
    return u.unit_name ? `${u.unit_name}${u.unit_code ? ` (${u.unit_code})` : ''}` : null;
  } catch {
    return null;
  }
}

/** What the letterhead says, from the report title and the filters used. */
function reportLetterhead(title, metadata = {}) {
  const meta = { ...(metadata || {}) };
  let unit = meta.Unit;
  if (!unit || unit === 'All Units') unit = ownUnitLabel() || unit || 'All Units';
  delete meta.Unit;
  delete meta['Report Name'];   // the title says it
  const filters = Object.entries(meta)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${v}`);
  return {
    title: String(title || 'Report').toUpperCase(),
    unit: `Unit: ${unit}`,
    filters,
    generated: `Generated on ${new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}`,
  };
}

const cleanName = (filename) => (filename || 'report').replace(/[^a-zA-Z0-9_-]/g, '_');

export async function exportExcel(rows, columns, filename, { title, metadata } = {}) {
  let ExcelJS;
  try {
    const mod = await importWithReload(() => import('exceljs'));
    ExcelJS = mod.default || mod;
  } catch (err) {
    console.error('[Reports] Could not load the Excel exporter:', err);
    toast.error('Could not create the Excel file. Please try again.');
    return;
  }
  const head = reportLetterhead(title, metadata);
  const cols = [{ header: 'S.No.', accessor: (_r, i) => i + 1 }, ...columns.map((c) => ({ header: c.header, accessor: c.accessor }))];
  const n = cols.length;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'OHPC Visitor Management System';
  const ws = wb.addWorksheet('Report', {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
    headerFooter: { oddFooter: `&L${head.generated}&RPage &P of &N` },
  });
  const thin = { style: 'thin', color: { argb: 'FF000000' } };
  const box = { top: thin, left: thin, bottom: thin, right: thin };

  // Letterhead: merged across the table, centred
  const line = (text, font, height) => {
    const row = ws.addRow([text]);
    ws.mergeCells(row.number, 1, row.number, n);
    row.getCell(1).font = { name: 'Arial', color: { argb: 'FF000000' }, ...font };
    row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    if (height) row.height = height;
  };
  line(ORG_NAME, { size: 14, bold: true }, 20);
  line(ORG_SUB, { size: 10 });
  line(head.unit, { size: 11, bold: true });
  line(head.title, { size: 12, bold: true, underline: true }, 20);
  if (head.filters.length) line(head.filters.join('   |   '), { size: 9 }, 28);
  line(head.generated, { size: 9, italic: true });
  ws.addRow([]);

  // Table
  const headerRow = ws.addRow(cols.map((c) => c.header));
  headerRow.eachCell((cell) => {
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF000000' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = box;
  });
  headerRow.height = 22;
  rows.forEach((r, i) => {
    const row = ws.addRow(cols.map((c) => { const v = c.accessor(r, i); return v === null || v === undefined ? '' : v; }));
    row.eachCell({ includeEmpty: true }, (cell, colNo) => {
      cell.font = { name: 'Arial', size: 10, color: { argb: 'FF000000' } };
      cell.alignment = { vertical: 'top', wrapText: true, horizontal: colNo === 1 ? 'center' : 'left' };
      cell.border = box;
    });
  });
  // Column widths from the content (capped), and the header stays visible when scrolling
  ws.columns.forEach((col, idx) => {
    const sample = [cols[idx].header, ...rows.slice(0, 300).map((r, i) => cols[idx].accessor(r, i))];
    col.width = Math.min(45, Math.max(idx === 0 ? 6 : 10, ...sample.map((v) => String(v ?? '').length + 2)));
  });
  ws.views = [{ state: 'frozen', ySplit: headerRow.number }];
  ws.pageSetup.printTitlesRow = `${headerRow.number}:${headerRow.number}`;

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${cleanName(filename)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function exportPDF(rows, columns, title, filename, { metadata } = {}) {
  let jsPDF, autoTable;
  try {
    [{ jsPDF }, { default: autoTable }] = await Promise.all([importWithReload(() => import('jspdf')), importWithReload(() => import('jspdf-autotable'))]);
  } catch (err) {
    console.error('[Reports] Could not load the PDF exporter:', err);
    toast.error('Could not create the PDF file. Please try again.');
    return;
  }
  const head = reportLetterhead(title, metadata);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const cx = pageW / 2;
  const margin = 10;
  doc.setTextColor(0, 0, 0);
  doc.setDrawColor(0, 0, 0);

  // Letterhead, centred
  let y = 14;
  doc.setFont('helvetica', 'bold');   doc.setFontSize(14); doc.text(ORG_NAME, cx, y, { align: 'center' });
  y += 5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.text(ORG_SUB, cx, y, { align: 'center' });
  y += 6;
  doc.setFont('helvetica', 'bold');   doc.setFontSize(11); doc.text(head.unit, cx, y, { align: 'center' });
  y += 7;
  doc.setFontSize(12);
  doc.text(head.title, cx, y, { align: 'center' });
  const tw = doc.getTextWidth(head.title);
  doc.setLineWidth(0.3);
  doc.line(cx - tw / 2, y + 1.2, cx + tw / 2, y + 1.2);   // underline
  if (head.filters.length) {
    y += 6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    const lines = doc.splitTextToSize(head.filters.join('   |   '), pageW - 2 * margin);
    doc.text(lines, cx, y, { align: 'center' });
    y += (lines.length - 1) * 4;
  }
  y += 4;
  doc.setLineWidth(0.4);
  doc.line(margin, y, pageW - margin, y);

  autoTable(doc, {
    startY: y + 3,
    margin: { left: margin, right: margin, bottom: 14 },
    theme: 'grid',
    head: [['S.No.', ...columns.map((c) => c.header)]],
    body: rows.map((r, i) => [i + 1, ...columns.map((c) => c.accessor(r) ?? '')]),
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.6, textColor: [0, 0, 0], lineColor: [0, 0, 0], lineWidth: 0.15, valign: 'top', overflow: 'linebreak' },
    headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'center', valign: 'middle', lineWidth: 0.25 },
    bodyStyles: { fillColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: [255, 255, 255] },
    columnStyles: { 0: { halign: 'center', cellWidth: 11 } },
  });

  // Footer on every page: when generated, page x of y
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(0, 0, 0);
    doc.setLineWidth(0.2);
    doc.line(margin, pageH - 10, pageW - margin, pageH - 10);
    doc.text(`${head.generated}  ·  OHPC Visitor Management System`, margin, pageH - 6);
    doc.text(`Page ${p} of ${pages}`, pageW - margin, pageH - 6, { align: 'right' });
  }
  doc.save(`${cleanName(filename)}.pdf`);
}
