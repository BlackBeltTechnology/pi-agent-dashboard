/**
 * Fallback preview. For file targets: "We can't preview this file. [Download]"
 * linking to `/api/file/raw`. For URL targets: "[Open in new tab]" linking to
 * the URL. See change: render-file-previews.
 */
import React from "react";
import type { ViewTarget } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { rawUrl } from "./raw-url.js";

interface Props {
  target: ViewTarget;
}

export function FallbackPreview({ target }: Props) {
  if (target.kind === "file") {
    return (
      <div className="p-4 text-sm text-[var(--text-secondary)]">
        We can't preview this file.{" "}
        <a
          href={rawUrl(target)}
          download
          className="text-[var(--accent)] underline"
        >
          Download
        </a>
      </div>
    );
  }
  return (
    <div className="p-4 text-sm text-[var(--text-secondary)]">
      <a
        href={target.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[var(--accent)] underline"
      >
        Open in new tab
      </a>{" "}
      <span className="text-[var(--text-muted)]">{target.url}</span>
    </div>
  );
}
