import { useSyncExternalStore } from "react";
import type { DisplayPrefs } from "@blackbelt-technology/pi-dashboard-shared/display-prefs.js";

/**
 * Effective chat motion = `prefs.chatMotion && !prefers-reduced-motion &&
 * document visible`. Subscribed to the media query and `visibilitychange`
 * through `useSyncExternalStore`, so a flip re-renders synchronously with the
 * event. Every chat-motion consumer reads this one value; when it is false the
 * transcript behaves exactly as it did before motion existed.
 *
 * See change: add-fluid-chat-motion (D8).
 */

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function reducedMotionList(): MediaQueryList | null {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(REDUCED_MOTION_QUERY)
    : null;
}

function subscribe(onChange: () => void): () => void {
  const mql = reducedMotionList();
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onChange);
  // Older engines only expose addListener on MediaQueryList.
  if (mql) {
    if (mql.addEventListener) mql.addEventListener("change", onChange);
    else mql.addListener?.(onChange);
  }
  return () => {
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onChange);
    if (mql) {
      if (mql.removeEventListener) mql.removeEventListener("change", onChange);
      else mql.removeListener?.(onChange);
    }
  };
}

/** True when the environment allows motion (no reduced-motion, document visible). */
function getEnvironmentAllowsMotion(): boolean {
  const reduced = reducedMotionList()?.matches ?? false;
  const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
  return !reduced && !hidden;
}

export function useChatMotion(prefs: Pick<DisplayPrefs, "chatMotion">): boolean {
  const environmentAllows = useSyncExternalStore(subscribe, getEnvironmentAllowsMotion, () => false);
  return prefs.chatMotion && environmentAllows;
}
