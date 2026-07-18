/**
 * Full-viewport shell for `/view` overlay routes. Reuses the same per-format
 * renderer the inline `PreviewCard` uses — only the outer shell differs.
 * See change: render-file-previews.
 */

import type { ViewTarget } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiArrowLeft } from "@mdi/js";
import { Icon } from "@mdi/react";
import React from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { dispatchPreview } from "../../lib/preview/preview-dispatch.js";
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
          title={i18nT("common.back2", undefined, "Back")}
          aria-label={i18nT("common.back2", undefined, "Back")}
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
