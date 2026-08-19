/** One exportable column -- `accessor` reads straight off the row (raw
 * numbers, not display-formatted strings) so numeric columns land in the
 * export as real numbers a spreadsheet can sum/chart, not text like
 * "₹3,14,955" a formula can't touch. Percent-shaped fields should already
 * be pre-scaled by the caller (e.g. 0.72 for "0.72%", not 0.0072) --
 * label the header "... (%)" so the exported number is self-explanatory
 * without a currency/percent symbol baked into the cell. */
export interface ExportColumn<T> {
  header: string;
  accessor: (row: T) => string | number | null | undefined;
}

function cellText(v: string | number | null | undefined): string {
  if (v == null) return "";
  return typeof v === "number" ? String(v) : v;
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** RFC 4180-ish escaping -- wrap in quotes and double any internal quote
 * whenever the field contains a comma, quote, or newline that would
 * otherwise break column alignment. */
function escapeCsvField(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function exportToCsv<T>(filename: string, columns: ExportColumn<T>[], rows: T[]): void {
  const lines = [
    columns.map((c) => escapeCsvField(c.header)).join(","),
    ...rows.map((row) => columns.map((c) => escapeCsvField(cellText(c.accessor(row)))).join(",")),
  ];
  // ﻿ (UTF-8 BOM) -- without it Excel guesses the wrong encoding for
  // anything outside ASCII (the ₹ symbol shows up nowhere here since
  // accessors return raw numbers, but product titles/SKUs routinely aren't
  // plain ASCII) and mangles it on open.
  downloadBlob(filename, new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
}

/** Not a real .xlsx (that needs a library -- SheetJS's `xlsx` package has
 * an unpatched high-severity advisory as of this writing, not worth
 * pulling in for what's fundamentally a nice-to-have). This is the classic
 * dependency-free trick instead: Excel opens an HTML <table> saved with an
 * .xls extension and the right MIME type as a real worksheet (one cell per
 * <td>, sortable/filterable, not a text blob) -- no external package, no
 * parsing of untrusted input, nothing for a supply-chain advisory to land
 * on. */
export function exportToExcel<T>(filename: string, columns: ExportColumn<T>[], rows: T[]): void {
  const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const headerRow = `<tr>${columns.map((c) => `<th>${escapeHtml(c.header)}</th>`).join("")}</tr>`;
  const bodyRows = rows
    .map((row) => `<tr>${columns.map((c) => `<td>${escapeHtml(cellText(c.accessor(row)))}</td>`).join("")}</tr>`)
    .join("");
  const html =
    `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">` +
    `<head><meta charset="utf-8"></head><body><table>${headerRow}${bodyRows}</table></body></html>`;
  downloadBlob(filename, new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" }));
}

export async function exportToPdf<T>(filename: string, title: string, columns: ExportColumn<T>[], rows: T[]): Promise<void> {
  // Dynamic import -- jsPDF + jspdf-autotable (plus their own html2canvas/
  // dompurify sub-deps) add ~400KB minified, and PDF is the least-used of
  // the three export formats. Statically importing it pulled that weight
  // into every page load's main bundle regardless of whether anyone ever
  // clicks "Export > PDF" -- this way it's its own chunk, fetched once, on
  // first use.
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  // Landscape -- these tables routinely run 10-20 columns wide; portrait
  // would need a font size too small to read.
  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(12);
  doc.text(title, 14, 12);
  autoTable(doc, {
    startY: 16,
    head: [columns.map((c) => c.header)],
    body: rows.map((row) => columns.map((c) => cellText(c.accessor(row)))),
    styles: { fontSize: 7, cellPadding: 1.5 },
    headStyles: { fillColor: [30, 41, 59] },
    margin: { left: 8, right: 8 },
  });
  doc.save(filename);
}
