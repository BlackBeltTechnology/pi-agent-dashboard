/**
 * Image tab — streams raw bytes from `/api/file/raw` into an `<img>` with
 * pan/zoom via the shared `useZoomPan` hook.
 *
 * See change: add-internal-monaco-editor-pane.
 */

import { useState } from "react";
import { useZoomPan } from "../../hooks/useZoomPan.js";
import { getApiBase } from "../../lib/api-context.js";
import type { ViewerProps } from "./types.js";

export default function ImageViewer({ cwd, path }: ViewerProps) {
  const { state, handlers, zoomIn, zoomOut, reset } = useZoomPan();
  const [failed, setFailed] = useState(false);
  const src = `${getApiBase()}/api/file/raw?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`;

  if (failed) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-[var(--text-secondary)]">
        Couldn't load image: {path}
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
          src={src}
          alt={path}
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
