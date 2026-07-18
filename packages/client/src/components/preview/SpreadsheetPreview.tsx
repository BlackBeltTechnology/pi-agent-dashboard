/**
 * Spreadsheet preview (design D3/D7). Fetches `/api/file/sheet` (bounded,
 * structured JSON), renders a frozen-header row/column grid, sheet tabs for
 * multi-sheet workbooks (active-sheet switching is client-only within the loaded
 * data), and the shared truncation banner ("Showing first N of M rows · sheet i
 * of k" + decoded charset pill for csv). `{success:false}` degrades to
 * FallbackPreview (design D5). See change: render-office-previews.
 */
import React, { useEffect, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { FallbackPreview } from "./FallbackPreview.js";
import { rawUrl, sheetUrl } from "./raw-url.js";
import { TruncationBanner } from "./TruncationBanner.js";

interface Props {
  target: { kind: "file"; cwd: string; path: string };
}

interface SheetData {
  name: string;
  header: string[];
  rows: string[][];
  totalRows: number;
  totalCols: number;
  truncated: boolean;
}

interface SheetPayload {
  sheets: SheetData[];
  activeSheet: number;
  encoding?: string;
}

export function SpreadsheetPreview({ target }: Props) {
  const [data, setData] = useState<SheetPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    setFailed(false);
    setActive(0);
    (async () => {
      try {
        const res = await fetch(sheetUrl(target));
        const body = await res.json();
        if (cancelled) return;
        if (body.success && Array.isArray(body.data?.sheets)) {
          setData(body.data as SheetPayload);
          setActive(body.data.activeSheet ?? 0);
        } else {
          setFailed(true);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "failed to load spreadsheet");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [target.cwd, target.path]);

  if (failed) return <FallbackPreview target={target} />;
  if (error) return <div className="text-red-400 text-sm p-2">{error}</div>;
  if (data == null)
    return (
      <div className="text-[var(--text-muted)] text-sm p-2">
        {i18nT("common.loading2", undefined, "Loading…")}
      </div>
    );

  const sheet = data.sheets[active] ?? data.sheets[0];
  const shown = sheet.rows.length;
  const bannerMsg = i18nT(
    "preview.sheetShowing",
    undefined,
    `Showing first ${shown} of ${sheet.totalRows} rows · sheet ${active + 1} of ${data.sheets.length}`,
  );

  return (
    <div className="flex flex-col h-full">
      {(sheet.truncated || data.encoding) && (
        <TruncationBanner message={bannerMsg} downloadHref={rawUrl(target)} charset={data.encoding} />
      )}
      {data.sheets.length > 1 ? (
        <div
          className="flex gap-1 px-2 py-1 border-b border-[var(--border-secondary)] overflow-x-auto"
          data-testid="sheet-tabs"
        >
          {data.sheets.map((s, i) => (
            <button
              key={s.name || i}
              type="button"
              onClick={() => setActive(i)}
              data-testid="sheet-tab"
              data-active={i === active ? "1" : "0"}
              className={`px-2 py-0.5 rounded text-xs whitespace-nowrap ${
                i === active
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--text-muted)] hover:bg-[var(--bg-surface)]"
              }`}
            >
              {s.name || `Sheet ${i + 1}`}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex-1 overflow-auto">
        <table className="text-xs border-collapse" data-testid="sheet-grid">
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-20 bg-[var(--bg-secondary)] border border-[var(--border-secondary)] px-1" />
              {sheet.header.map((h, i) => (
                <th
                  key={i}
                  className="sticky top-0 z-10 bg-[var(--bg-secondary)] border border-[var(--border-secondary)] px-2 py-1 text-left font-mono"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row, r) => (
              <tr key={r}>
                <td className="sticky left-0 z-10 bg-[var(--bg-secondary)] border border-[var(--border-secondary)] px-1 text-[var(--text-muted)] text-right">
                  {r + 1}
                </td>
                {sheet.header.map((_, c) => (
                  <td key={c} className="border border-[var(--border-secondary)] px-2 py-0.5">
                    {row[c] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
