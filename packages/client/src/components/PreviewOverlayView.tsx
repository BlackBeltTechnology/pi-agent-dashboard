/**
 * Full-viewport shell for `/view` overlay routes. Reuses the same per-format
 * renderer the inline `PreviewCard` uses — only the outer shell differs.
 * See change: render-file-previews.
 */
import React from "react";
import { Icon } from "@mdi/react";
import { mdiArrowLeft } from "@mdi/js";
import type { ViewTarget } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { dispatchPreview } from "../lib/preview-dispatch.js";
import { PreviewBody } from "./PreviewCard.js";

interface Props {
  target: ViewTarget;
  onBack: () => void;
}

export function PreviewOverlayView({ target, onBack }: Props) {
  const kind = dispatchPreview(target);
  const label = target.kind === "file" ? target.path : target.url;
  return (
    <div className="flex-1 flex flex-col min-h-0" data-testid="preview-overlay">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border-secondary)]">
        <button
          onClick={onBack}
          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] p-1 rounded hover:bg-[var(--bg-surface)]"
          data-testid="preview-overlay-back"
          title="Back"
          aria-label="Back"
        >
          <Icon path={mdiArrowLeft} size={0.7} />
        </button>
        <span className="text-sm font-medium text-[var(--text-secondary)] truncate font-mono">
          {label}
        </span>
      </div>
      <div className="flex-1 overflow-auto">
        <PreviewBody kind={kind} target={target} />
      </div>
    </div>
  );
}
