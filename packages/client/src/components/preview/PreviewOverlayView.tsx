/**
 * Full-viewport shell for `/view` overlay routes. Reuses the same per-format
 * renderer the inline `PreviewCard` uses — only the outer shell differs.
 * Provenance: a route-backed overlay is `agent` (fail closed) unless its URL
 * carries an `ni` intent the server verifies for this exact target — then the
 * body mounts under `PreviewProvenance autoOpened={false}` (operator). While
 * verifying (≤ 2 s) the body is not mounted, so the live capability is minted
 * once with the right policy. See change: harden-client-sinks (D10).
 *
 * See change: render-file-previews.
 */

import type { ViewTarget } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiArrowLeft } from "@mdi/js";
import { Icon } from "@mdi/react";
import React from "react";
import { useSearchParams } from "wouter";
import { PreviewProvenance } from "../../lib/access-grants/preview-provenance.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { useNavIntentVerdict } from "../../lib/nav/nav-intent.js";
import { dispatchPreview } from "../../lib/preview/preview-dispatch.js";
import { PreviewBody } from "./PreviewCard.js";

interface Props {
  target: ViewTarget;
  onBack: () => void;
}

export function PreviewOverlayView({ target, onBack }: Props) {
  const kind = dispatchPreview(target);
  const label = target.kind === "file" ? target.path : target.url;
  const [search] = useSearchParams();
  const verdict = useNavIntentVerdict(search.get("ni"), target);
  const body =
    verdict === "pending" ? (
      <div role="status" className="p-4 text-sm text-[var(--text-muted)]" data-testid="preview-overlay-pending">
        {i18nT("common.loading2", undefined, "Loading…")}
      </div>
    ) : verdict === "operator" ? (
      <PreviewProvenance autoOpened={false}>
        <PreviewBody kind={kind} target={target} />
      </PreviewProvenance>
    ) : (
      <PreviewBody kind={kind} target={target} />
    );
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
      <div className="flex-1 overflow-auto">{body}</div>
    </div>
  );
}
