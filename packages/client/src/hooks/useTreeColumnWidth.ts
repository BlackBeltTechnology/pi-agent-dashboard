/**
 * Persisted width for the Instructions folder-tree column.
 *
 * Peer of `useSidebarState` (same clamp + `localStorage` pattern) with its own
 * key `dashboard:dirset-width` and a 200–560px clamp. `setWidth` updates the
 * live width during a drag; `persist` commits to `localStorage` on mouseup so
 * the width is restored on the next mount. A `localStorage` throw (private mode)
 * degrades to in-memory (default width), never crashes.
 *
 * See change: directory-settings-tree-and-resize.
 */
import { type MouseEvent as ReactMouseEvent, type RefObject, useCallback, useEffect, useRef, useState } from "react";

const WIDTH_KEY = "dashboard:dirset-width";
const DEFAULT_WIDTH = 300;
const MIN_WIDTH = 200;
const MAX_WIDTH = 560;

function clamp(value: number): number {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, value));
}

function readWidth(): number {
  try {
    const raw = localStorage.getItem(WIDTH_KEY);
    if (raw === null) return DEFAULT_WIDTH;
    const n = Number(raw);
    return Number.isFinite(n) ? clamp(n) : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

export interface TreeColumnWidth {
  width: number;
  /** Ref for the column container; its left edge anchors the drag delta. */
  containerRef: RefObject<HTMLDivElement | null>;
  /** `onMouseDown` for the resize gutter — begins a drag. */
  startResize: (e: ReactMouseEvent) => void;
}

/**
 * Owns the tree column width plus the drag lifecycle: live width updates during
 * a drag and a single `localStorage` commit on mouseup. Attach `containerRef`
 * to the column's container and `startResize` to the gutter's `onMouseDown`.
 */
export function useTreeColumnWidth(): TreeColumnWidth {
  const [width, setWidth] = useState(() => clamp(readWidth()));
  const widthRef = useRef(width);
  widthRef.current = width;
  const draggingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const startResize = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const left = containerRef.current?.getBoundingClientRect().left ?? 0;
      setWidth(clamp(e.clientX - left));
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try {
        localStorage.setItem(WIDTH_KEY, String(clamp(widthRef.current)));
      } catch {
        /* noop — keep in-memory width */
      }
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      // Unmounting mid-drag (e.g. breakpoint flip) would otherwise leave
      // `document.body` stuck with `col-resize` / `user-select: none`.
      if (draggingRef.current) {
        draggingRef.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };
    // `setWidth` is a stable useState setter — no deps needed.
  }, []);

  return { width, containerRef, startResize };
}

// Exported for testing.
export { DEFAULT_WIDTH, MAX_WIDTH, MIN_WIDTH, WIDTH_KEY };
