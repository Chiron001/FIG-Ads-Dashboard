import { useEffect, useRef, useState } from "react";
import { exportToCsv, exportToExcel, exportToPdf, type ExportColumn } from "../lib/exportTable";

interface Props<T> {
  /** Base filename, no extension -- each format appends its own. */
  filename: string;
  /** Shown as the PDF's in-document heading; ignored by CSV/Excel. */
  title: string;
  columns: ExportColumn<T>[];
  rows: T[];
}

function DownloadIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <path d="M8 1.5v9M4.5 7l3.5 3.5L11.5 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.5 12.5v1a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/** Small "Export ▾" button + dropdown (CSV/Excel/PDF), dropped into a
 * table's own toolbar row. One generic component reused across every big
 * table in the app rather than three format-specific buttons repeated in
 * each -- columns/rows/filename are the only per-table bit. */
export function ExportMenu<T>({ filename, title, columns, rows }: Props<T>) {
  const [open, setOpen] = useState(false);
  // PDF is a lazy-loaded chunk (see exportToPdf) -- covers the fetch on
  // first use so the button doesn't look inert while it downloads.
  const [exportingPdf, setExportingPdf] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function handle(format: "csv" | "excel" | "pdf") {
    setOpen(false);
    if (format === "csv") {
      exportToCsv(`${filename}.csv`, columns, rows);
    } else if (format === "excel") {
      exportToExcel(`${filename}.xls`, columns, rows);
    } else {
      setExportingPdf(true);
      exportToPdf(`${filename}.pdf`, title, columns, rows).finally(() => setExportingPdf(false));
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={rows.length === 0 || exportingPdf}
        title={rows.length === 0 ? "Nothing to export" : "Export this table"}
        className="flex items-center gap-1.5 rounded-md border border-border bg-surface-1 px-2.5 py-1.5 text-xs font-medium text-ink-secondary transition-colors hover:bg-surface-2 hover:text-ink-primary disabled:cursor-not-allowed disabled:opacity-40"
      >
        <DownloadIcon />
        {exportingPdf ? "Exporting…" : "Export"}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-1.5 w-36 overflow-hidden rounded-md border border-border bg-surface-1 py-1 shadow-[var(--shadow-glass)]">
          {(
            [
              ["csv", "CSV"],
              ["excel", "Excel"],
              ["pdf", "PDF"],
            ] as const
          ).map(([format, label]) => (
            <button
              key={format}
              type="button"
              onClick={() => handle(format)}
              className="block w-full px-3 py-1.5 text-left text-xs text-ink-secondary transition-colors hover:bg-surface-2 hover:text-ink-primary"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
