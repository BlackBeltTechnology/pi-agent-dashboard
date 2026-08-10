/**
 * Shared bounded-preview banner (design D3) reused by DocxPreview (image trim)
 * and SpreadsheetPreview (row trim). Shows a short message, an optional charset
 * pill (csv), and a download affordance to the full file.
 * See change: render-office-previews.
 */
import React from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";

interface Props {
  message: string;
  /** `/api/file/raw` href for the full-file download escape hatch. */
  downloadHref: string;
  /** Optional decoded charset pill (csv). */
  charset?: string;
}

export function TruncationBanner({ message, downloadHref, charset }: Props) {
  return (
    <div
      className="flex items-center gap-2 px-2 py-1 text-xs border-b border-[var(--border-secondary)] bg-[var(--bg-surface)] text-[var(--text-muted)]"
      data-testid="truncation-banner"
    >
      <span className="flex-1">{message}</span>
      {charset ? (
        <span
          className="px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] font-mono text-[10px] uppercase"
          data-testid="charset-pill"
        >
          {charset}
        </span>
      ) : null}
      <a href={downloadHref} download className="text-[var(--accent)] underline">
        {i18nT("common.download", undefined, "Download")}
      </a>
    </div>
  );
}
