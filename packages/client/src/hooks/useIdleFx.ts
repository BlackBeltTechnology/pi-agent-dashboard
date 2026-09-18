import { useEffect } from "react";

/**
 * Idle-FX settle window before the dashboard's animations pause. A
 * watched-but-untouched dashboard must not drive continuous compositor frames:
 * the per-frame cost is pipeline overhead, not raster size, so an unattended
 * visible window pays it for every running animation. See change:
 * fix-long-session-ux-degradation (§7, design D8).
 */
export const IDLE_FX_DELAY_MS = 5000;

const IDLE_CLASS = "fx-idle";

/**
 * Deliberate input gestures that count as "the user is here". Listened at
 * CAPTURE on `document` so activity inside a stopped-propagation subtree still
 * counts (and so `window`-scoped dispatch is not the test surface).
 *
 * Deliberately NOT `pointermove` (a resting hand emits continuous micro-moves)
 * and NOT `scroll` (streaming auto-scroll emits trusted scroll events, which
 * would hold the FX alive for an entire 24h stream — the exact case this
 * exists to fix). See change: fix-long-session-ux-degradation (design D8).
 */
const ACTIVITY_EVENTS = [
  "pointerdown",
  "wheel",
  "keydown",
  "touchstart",
  "focusin",
] as const;

/**
 * Toggles `fx-idle` on the document root after {@link IDLE_FX_DELAY_MS} with no
 * deliberate input. The CSS for that class pauses ALL animations (same wildcard
 * as `app-hidden`), except the indeterminate-progress exemption ladder in
 * `index.css`; frozen elements keep their static state colours, so the idle UI
 * still communicates running/unread/selected state — just without motion.
 * `app-hidden` and the off-screen pause stay independent and take precedence
 * over the exemption. Cleans up its timer, listeners, and the class on unmount.
 * See change: fix-long-session-ux-degradation (§7, design D8).
 */
export function useIdleFx(): void {
  useEffect(() => {
    const root = document.documentElement;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const arm = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        root.classList.add(IDLE_CLASS);
      }, IDLE_FX_DELAY_MS);
    };

    const onActivity = () => {
      root.classList.remove(IDLE_CLASS);
      arm();
    };

    arm();
    for (const type of ACTIVITY_EVENTS) {
      document.addEventListener(type, onActivity, { capture: true, passive: true });
    }
    return () => {
      if (timer !== null) clearTimeout(timer);
      for (const type of ACTIVITY_EVENTS) {
        document.removeEventListener(type, onActivity, { capture: true });
      }
      root.classList.remove(IDLE_CLASS);
    };
  }, []);
}
