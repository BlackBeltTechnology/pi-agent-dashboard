/**
 * Split-pane viewer for a generic `canvas()` URL/youtube declare (change:
 * auto-canvas, Section 6 / Decision 6). Opened explicitly under a virtual
 * `url:<url>` path (mirrors `live:<url>` / `diff:<relPath>`), NEVER returned by
 * `fileKind()`.
 *
 * A url/youtube declare renders the live URL normally (NO restrictive document
 * CSP — that applies to auto-opened FILE documents only, S35). It reuses the
 * SAME `dispatchPreview` → `PreviewBody` renderer the inline `/view` card uses,
 * so youtube embeds and other URL kinds render identically here.
 */
import type { ViewTarget } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { t as i18nT } from "../../lib/i18n";
import { dispatchPreview } from "../../lib/preview-dispatch.js";
import { PreviewBody } from "../PreviewCard.js";
import type { ViewerProps } from "./types.js";

/** Parse a `url:<url>` sentinel path into a URL ViewTarget; null when malformed. */
function parseUrlTarget(viewerPath: string | undefined): ViewTarget | null {
  if (!viewerPath?.startsWith("url:")) return null;
  const url = viewerPath.slice("url:".length);
  return url ? { kind: "url", url } : null;
}

export default function UrlViewer({ path }: Partial<ViewerProps> = {}) {
  const target = parseUrlTarget(path);
  if (!target) {
    return (
      <div className="p-4 text-sm text-[var(--text-tertiary)]" data-testid="canvas-url-viewer">
        {i18nT("editor.noUrlTarget", undefined, "No URL to preview.")}
      </div>
    );
  }
  const kind = dispatchPreview(target);
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="canvas-url-viewer">
      <div className="min-h-0 flex-1 overflow-auto">
        <PreviewBody kind={kind} target={target} />
      </div>
    </div>
  );
}
