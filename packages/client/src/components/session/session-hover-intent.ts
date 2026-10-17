/**
 * Hover intent for the session actions menu — ONE `pointermove` listener on
 * `document`, refs and closure state only. No React state changes per move: the
 * only React work is the open / close the host callbacks perform.
 *
 * Arming (per move): resolve the card via `closest('[data-session-card]')`, read
 * its rect at most once per animation frame (time-cached), and test
 * `x >= rect.right - HOVER_STRIP_PX`. A pointer over a button / link, over an
 * inline rename input, or during a drag or press never arms. The menu opens only
 * once the pointer has stayed in the strip for `HOVER_DWELL_MS` AND the speed
 * over the most recent `SPEED_WINDOW_MS` is below `HOVER_SPEED_CUTOFF` — a fast
 * pass toward the chat leaves the strip long before either holds.
 *
 * Bridge: the gap between card and menu is a geometric test in the same
 * handler. The listener lives on `document` because the menu is portaled to
 * `body`; a sidebar-level listener would never see the pointer over the menu. A
 * hover-opened menu closes `HOVER_CLOSE_GRACE_MS` after the pointer is outside
 * card ∪ gap ∪ menu.
 *
 * See change: add-session-actions-flyout (D5).
 */

import { attrEscape } from "../../lib/util/attr-escape.js";

export const HOVER_STRIP_PX = 32;
export const HOVER_DWELL_MS = 300;
export const HOVER_SPEED_CUTOFF = 0.4; // px / ms
export const HOVER_CLOSE_GRACE_MS = 300;
/** Window the pointer speed is measured over. */
export const HOVER_SPEED_WINDOW_MS = 100;
/** One rect read per animation frame (~60 Hz). */
const RECT_CACHE_MS = 16;

export interface HoverIntentHost {
  /** `(hover: hover) and (pointer: fine)`. */
  matches(): boolean;
  /** Arming is suppressed: a click / right-click / keyboard menu or a dialog is open. */
  suppressed(): boolean;
  /** Open the menu of `sessionId` from hover. */
  open(sessionId: string): void;
  /** Close the hover-opened menu (grace elapsed). */
  close(): void;
  /** Session id whose menu is currently HOVER-opened, else null. */
  hoverOpenFor(): string | null;
  /** The open menu's panel element. */
  menuEl(): HTMLElement | null;
}

interface Sample {
  t: number;
  x: number;
  y: number;
}

interface Armed {
  card: HTMLElement;
  id: string;
  since: number;
  timer: ReturnType<typeof setTimeout>;
}

const inRect = (x: number, y: number, r: { left: number; right: number; top: number; bottom: number }) =>
  x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

export function createHoverIntent(doc: Document, host: HoverIntentHost): { destroy(): void } {
  const samples: Sample[] = [];
  let armed: Armed | null = null;
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  let rectCache: { el: Element; rect: DOMRect; at: number } | null = null;

  const cardRect = (el: HTMLElement, now: number): DOMRect => {
    if (rectCache && rectCache.el === el && now - rectCache.at < RECT_CACHE_MS) return rectCache.rect;
    const rect = el.getBoundingClientRect();
    rectCache = { el, rect, at: now };
    return rect;
  };

  const speedAt = (now: number): number => {
    while (samples.length > 0 && now - samples[0].t > HOVER_SPEED_WINDOW_MS) samples.shift();
    if (samples.length < 2) return 0;
    // Path length, not endpoint displacement: a wiggle that ends where it started
    // is still fast.
    let dist = 0;
    for (let i = 1; i < samples.length; i++) dist += Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y);
    const dt = Math.max(1, samples[samples.length - 1].t - samples[0].t);
    return dist / dt;
  };

  const disarm = () => {
    if (armed) clearTimeout(armed.timer);
    armed = null;
  };

  const clearGrace = () => {
    if (graceTimer !== null) clearTimeout(graceTimer);
    graceTimer = null;
  };

  const tryOpen = () => {
    if (!armed) return;
    const now = Date.now();
    if (now - armed.since < HOVER_DWELL_MS) return;
    // Still too fast: stay armed, the next move re-checks.
    if (speedAt(now) >= HOVER_SPEED_CUTOFF) return;
    const { id } = armed;
    disarm();
    host.open(id);
  };

  const onOpenMenuMove = (e: PointerEvent, id: string, now: number) => {
    const target = e.target as Element | null;
    const menu = host.menuEl();
    const card = doc.querySelector<HTMLElement>(`[data-session-card][data-session-id="${attrEscape(id)}"]`);
    let inside = false;
    if (target && menu?.contains(target)) inside = true;
    else if (target && card?.contains(target)) inside = true;
    else if (card && menu) {
      const c = cardRect(card, now);
      const m = menu.getBoundingClientRect();
      const gap = {
        left: Math.min(c.right, m.left),
        right: Math.max(c.right, m.left),
        top: Math.max(c.top, m.top),
        bottom: Math.min(c.bottom, m.bottom),
      };
      inside = inRect(e.clientX, e.clientY, gap) || inRect(e.clientX, e.clientY, c) || inRect(e.clientX, e.clientY, m);
    }
    if (inside) {
      clearGrace();
      return;
    }
    if (graceTimer === null) {
      graceTimer = setTimeout(() => {
        graceTimer = null;
        host.close();
      }, HOVER_CLOSE_GRACE_MS);
    }
  };

  const onMove = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    if (!host.matches()) return;
    const now = Date.now();
    samples.push({ t: now, x: e.clientX, y: e.clientY });
    while (samples.length > 0 && now - samples[0].t > HOVER_SPEED_WINDOW_MS) samples.shift();

    const hoverId = host.hoverOpenFor();
    if (hoverId) {
      disarm();
      onOpenMenuMove(e, hoverId, now);
      return;
    }
    clearGrace();

    const target = e.target as Element | null;
    const card = target?.closest?.("[data-session-card]") as HTMLElement | null | undefined;
    if (
      !card ||
      e.buttons !== 0 ||
      host.suppressed() ||
      card.querySelector("input, textarea") ||
      doc.querySelector("[data-session-dragging]")
    ) {
      disarm();
      return;
    }
    // Over a control: the strip must not arm, so ✕ / Archive / the stepper stay usable.
    if (target?.closest("button, a, [role='button']")) {
      disarm();
      return;
    }
    const rect = cardRect(card, now);
    if (e.clientX < rect.right - HOVER_STRIP_PX || e.clientX > rect.right) {
      disarm();
      return;
    }
    if (!armed || armed.card !== card) {
      disarm();
      const id = card.getAttribute("data-session-id") ?? "";
      armed = { card, id, since: now, timer: setTimeout(tryOpen, HOVER_DWELL_MS) };
      return;
    }
    tryOpen();
  };

  doc.addEventListener("pointermove", onMove, { passive: true });
  return {
    destroy() {
      doc.removeEventListener("pointermove", onMove);
      disarm();
      clearGrace();
    },
  };
}
