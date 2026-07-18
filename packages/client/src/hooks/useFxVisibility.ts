import { useCallback, useRef } from "react";
import { observeFx } from "../lib/util/fx-visibility.js";

/**
 * Attach the returned ref callback to a DOM element carrying (or containing)
 * a liveness / decorative animation. While the element is off-screen the shared
 * IntersectionObserver sets `fx-offscreen` (animation-play-state: paused on it
 * and its descendants), resuming when it re-enters the viewport.
 *
 * See change: reduce-chat-render-cpu-umbrella (Phase 1, task 2.5).
 */
export function useFxVisibility<T extends HTMLElement>(): (node: T | null) => void {
  const disposeRef = useRef<(() => void) | null>(null);
  return useCallback((node: T | null) => {
    if (disposeRef.current) {
      disposeRef.current();
      disposeRef.current = null;
    }
    if (node) disposeRef.current = observeFx(node);
  }, []);
}
