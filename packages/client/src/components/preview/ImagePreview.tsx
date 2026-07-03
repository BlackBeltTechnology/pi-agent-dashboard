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
import { rawUrl } from "./raw-url.js";

interface Props {
  target: { kind: "file"; cwd: string; path: string };
  /** `inline` = capped card image (default); `full` = pan/zoom editor tab. */
  variant?: "inline" | "full";
}

export function ImagePreview({ target, variant = "inline" }: Props) {
  if (variant === "full") return <FullImage target={target} />;
  return (
    <img
      src={rawUrl(target)}
      alt={target.path}
      className="max-h-[40vh] max-w-full object-contain"
    />
  );
}

/** Full-tab image with pan/zoom + zoom controls (ex-`ImageViewer`). */
function FullImage({ target }: Props) {
  const { state, handlers, zoomIn, zoomOut, reset } = useZoomPan();
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-[var(--text-secondary)]">
        Couldn't load image: {target.path}
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-[var(--bg-primary)]">
      <div
        className="flex h-full w-full items-center justify-center"
        {...handlers}
        style={{ cursor: "grab", touchAction: "none" }}
      >
        <img
          src={rawUrl(target)}
          alt={target.path}
          onError={() => setFailed(true)}
          draggable={false}
          className="max-h-full max-w-full object-contain select-none"
          style={{
            transform: `translate(${state.translateX}px, ${state.translateY}px) scale(${state.scale})`,
          }}
        />
      </div>
      <div className="absolute bottom-2 right-2 flex gap-1 rounded bg-[var(--bg-secondary)] p-1 text-xs">
        <button type="button" onClick={zoomOut} className="px-2 py-0.5 hover:bg-[var(--bg-hover)]" aria-label="Zoom out">
          −
        </button>
        <button type="button" onClick={reset} className="px-2 py-0.5 hover:bg-[var(--bg-hover)]" aria-label="Reset zoom">
          {Math.round(state.scale * 100)}%
        </button>
        <button type="button" onClick={zoomIn} className="px-2 py-0.5 hover:bg-[var(--bg-hover)]" aria-label="Zoom in">
          +
        </button>
      </div>
    </div>
  );
}
