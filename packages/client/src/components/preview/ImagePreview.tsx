/**
 * Image preview with two variants:
 *   - `inline` (default): plain `<img>` capped at `max-h-[40vh]` for chat/card
 *     previews. Unchanged behaviour.
 *   - `full`: full-tab viewer with pan/zoom (shared with the editor pane, which
 *     replaced its own `ImageViewer`). See change: improve-content-editor (§4.3).
 * Both stream bytes from `/api/file/raw`. See change: render-file-previews.
 */
import { useState } from "react";
import { useZoomPan } from "../../hooks/useZoomPan.js";
import { useI18n } from "../../lib/i18n/i18n.js";
import { DenialNotice } from "./DenialNotice.js";
import { rawUrl } from "./raw-url.js";
import { isSameOriginApiBase, useBlobImage } from "./use-blob-image.js";

interface Props {
  target: { kind: "file"; cwd: string; path: string };
  /** `inline` = capped card image (default); `full` = pan/zoom editor tab. */
  variant?: "inline" | "full";
  /** Override the image URL (e.g. a `blob:` URL for an EML attachment). */
  srcUrl?: string;
}

export function ImagePreview({ target, variant = "inline", srcUrl }: Props) {
  if (variant === "full") return <FullImage target={target} srcUrl={srcUrl} />;
  return (
    <img
      src={srcUrl ?? rawUrl(target)}
      alt={target.path}
      className="max-h-[40vh] max-w-full object-contain"
    />
  );
}

/**
 * Full-tab image with pan/zoom + zoom controls (ex-`ImageViewer`).
 *
 * Same-origin API base and no caller `srcUrl`: loads through `fetch` → `blob:`
 * so a click-opened image can reach the access-grant dialog, with a loading
 * state for the whole hold and `DenialNotice` on a refusal. Otherwise the
 * `<img>` is unchanged (design D1). See change: surface-denial-remedy-in-previews.
 */
function FullImage({ target, srcUrl }: Props) {
  const { t } = useI18n();
  const url = rawUrl(target);
  const viaFetch = srcUrl === undefined && isSameOriginApiBase();
  const blob = useBlobImage(viaFetch ? url : null);
  const [failed, setFailed] = useState(false);

  if (viaFetch) {
    if (blob.state.status === "loading") {
      return (
        <div className="flex h-full items-center justify-center p-4 text-sm text-[var(--text-tertiary)]">
          {t("common.loading2", undefined, "Loading…")}
        </div>
      );
    }
    if (blob.state.status === "failed") {
      return (
        <DenialNotice result={blob.state.failure} url={url} path={target.path} onAsk={blob.ask} asked={blob.asked} />
      );
    }
  }
  if (failed) {
    // A caller-supplied source keeps its message; a cross-origin `<img>` has no
    // status and no body, so it can only say it failed (variant `unknown`).
    if (srcUrl !== undefined) {
      return (
        <div className="flex h-full items-center justify-center p-4 text-sm text-[var(--text-secondary)]">
          {t("preview.couldntLoadImage", { path: target.path }, "Couldn't load image: {path}")}
        </div>
      );
    }
    return <DenialNotice result={{ kind: "unknown" }} url={url} path={target.path} />;
  }
  const src = viaFetch && blob.state.status === "ok" ? blob.state.src : (srcUrl ?? url);
  return <ZoomableImage src={src} alt={target.path} onError={() => setFailed(true)} />;
}

function ZoomableImage({ src, alt, onError }: { src: string; alt: string; onError: () => void }) {
  const { t } = useI18n();
  const { state, handlers, zoomIn, zoomOut, reset } = useZoomPan();

  return (
    <div className="relative h-full w-full overflow-hidden bg-[var(--bg-primary)]">
      <div
        className="flex h-full w-full items-center justify-center"
        {...handlers}
        style={{ cursor: "grab", touchAction: "none" }}
      >
        <img
          src={src}
          alt={alt}
          onError={onError}
          draggable={false}
          className="max-h-full max-w-full object-contain select-none"
          style={{
            transform: `translate(${state.translateX}px, ${state.translateY}px) scale(${state.scale})`,
          }}
        />
      </div>
      <div className="absolute bottom-2 right-2 flex gap-1 rounded bg-[var(--bg-secondary)] p-1 text-xs">
        <button type="button" onClick={zoomOut} className="px-2 py-0.5 hover:bg-[var(--bg-hover)]" aria-label={t("preview.zoomOut", undefined, "Zoom out")}>
          −
        </button>
        <button type="button" onClick={reset} className="px-2 py-0.5 hover:bg-[var(--bg-hover)]" aria-label={t("preview.resetZoom", undefined, "Reset zoom")}>
          {Math.round(state.scale * 100)}%
        </button>
        <button type="button" onClick={zoomIn} className="px-2 py-0.5 hover:bg-[var(--bg-hover)]" aria-label={t("preview.zoomIn", undefined, "Zoom in")}>
          +
        </button>
      </div>
    </div>
  );
}
