/**
 * Hover intent for the collapsed composer dock's summary bar: dwell on the bar
 * to peek, leave (after a grace period) to close. ONE `document` `pointermove`
 * listener, refs and closure state only — no React state per pointer move; the
 * only React work is the open / close the host callbacks perform.
 *
 * Reuses the session actions menu's constants (`session-hover-intent.ts`) and
 * its rules — dwell `HOVER_DWELL_MS` AND path speed over the last
 * `HOVER_SPEED_WINDOW_MS` below `HOVER_SPEED_CUTOFF`; close `HOVER_CLOSE_GRACE_MS`
 * after the pointer is outside bar ∪ overlay — with one deliberate difference:
 * the bar button itself arms (it is the hover zone, and clicking it pins).
 *
 * Keep-open (`host.held()`): while a dock popover or the focus holds the peek,
 * the grace timer does not run; the hook polls and starts the grace period only
 * once the hold ends with the pointer still outside.
 *
 * See change: composer-dock-collapse-and-file-open (D3).
 */
import { useEffect, useRef } from "react";
import {
  HOVER_CLOSE_GRACE_MS,
  HOVER_DWELL_MS,
  HOVER_SPEED_CUTOFF,
  HOVER_SPEED_WINDOW_MS,
} from "../session/session-hover-intent.js";

export interface DockHoverHost {
  /** `(hover: hover) and (pointer: fine)`. */
  matches(): boolean;
  /** Arming is suppressed: a dialog or a click / keyboard opened dock popover is open, or a cooldown holds. */
  suppressed(): boolean;
  /** The dock is currently peeked. */
  peeking(): boolean;
  /** `target` is the summary bar (or inside it). */
  isBar(target: Element | null): boolean;
  /** `target` is inside the bar ∪ overlay zone. */
  isInside(target: Element | null): boolean;
  /** A dock popover or focus holds a peek open. */
  held(): boolean;
  /** Peek the dock. */
  open(): void;
  /** Close the peek (grace elapsed). */
  close(): void;
  /** The pointer moved off the bar (clears any post-Hide / post-Escape cooldown). */
  pointerLeftBar?(): void;
}

interface Sample {
  t: number;
  x: number;
  y: number;
}

/** How often a held peek re-checks whether the hold has ended. */
const HELD_POLL_MS = 100;

export function createDockHoverIntent(doc: Document, host: DockHoverHost): { destroy(): void; reset(): void } {
  const samples: Sample[] = [];
  let armedSince: number | null = null;
  let armTimer: ReturnType<typeof setTimeout> | null = null;
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let outside = false;

  const speedAt = (now: number): number => {
    while (samples.length > 0 && now - samples[0].t > HOVER_SPEED_WINDOW_MS) samples.shift();
    if (samples.length < 2) return 0;
    // Path length, not endpoint displacement: a wiggle that ends where it started is still fast.
    let dist = 0;
    for (let i = 1; i < samples.length; i++) dist += Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y);
    return dist / Math.max(1, samples[samples.length - 1].t - samples[0].t);
  };

  const disarm = () => {
    if (armTimer !== null) clearTimeout(armTimer);
    armTimer = null;
    armedSince = null;
  };
  const clearClose = () => {
    if (graceTimer !== null) clearTimeout(graceTimer);
    if (pollTimer !== null) clearTimeout(pollTimer);
    graceTimer = null;
    pollTimer = null;
  };

  const tryOpen = () => {
    armTimer = null;
    if (armedSince === null) return;
    const now = Date.now();
    if (now - armedSince < HOVER_DWELL_MS) return;
    if (host.suppressed()) {
      disarm();
      return;
    }
    // Still too fast: stay armed and look again once the speed window has rolled on — a
    // pointer that then comes to rest sends no further move to re-check.
    if (speedAt(now) >= HOVER_SPEED_CUTOFF) {
      armTimer = setTimeout(tryOpen, HOVER_SPEED_WINDOW_MS);
      return;
    }
    disarm();
    host.open();
  };

  const scheduleClose = () => {
    if (graceTimer !== null || pollTimer !== null) return;
    if (host.held()) pollTimer = setTimeout(poll, HELD_POLL_MS);
    else graceTimer = setTimeout(fire, HOVER_CLOSE_GRACE_MS);
  };
  const fire = () => {
    graceTimer = null;
    if (!host.peeking() || !outside) return;
    if (host.held()) pollTimer = setTimeout(poll, HELD_POLL_MS);
    else host.close();
  };
  const poll = () => {
    pollTimer = null;
    if (!host.peeking() || !outside) return;
    if (host.held()) pollTimer = setTimeout(poll, HELD_POLL_MS);
    else graceTimer = setTimeout(fire, HOVER_CLOSE_GRACE_MS);
  };

  /** Pointer move while peeked: inside bar ∪ overlay keeps it, outside starts the close. */
  const onPeekMove = (target: Element | null) => {
    disarm();
    if (host.isInside(target)) {
      outside = false;
      clearClose();
    } else {
      outside = true;
      scheduleClose();
    }
  };

  /** Pointer move while collapsed: dwelling on the bar (not suppressed) arms the peek. */
  const onRestMove = (e: PointerEvent, now: number) => {
    outside = false;
    clearClose();
    if (!host.isBar(e.target as Element | null)) {
      host.pointerLeftBar?.();
      disarm();
      return;
    }
    if (e.buttons !== 0 || host.suppressed()) {
      disarm();
      return;
    }
    if (armedSince === null) {
      armedSince = now;
      armTimer = setTimeout(tryOpen, HOVER_DWELL_MS);
      return;
    }
    tryOpen();
  };

  const onMove = (e: PointerEvent) => {
    if (e.pointerType === "touch" || !host.matches()) return;
    const now = Date.now();
    samples.push({ t: now, x: e.clientX, y: e.clientY });
    while (samples.length > 0 && now - samples[0].t > HOVER_SPEED_WINDOW_MS) samples.shift();
    if (host.peeking()) onPeekMove(e.target as Element | null);
    else onRestMove(e, now);
  };

  // Leaving the browser window sends no further `pointermove`: treat it as "outside".
  const onOut = (e: PointerEvent) => {
    if (e.relatedTarget !== null) return;
    if (host.peeking()) {
      outside = true;
      scheduleClose();
    } else {
      disarm();
    }
  };

  doc.addEventListener("pointermove", onMove, { passive: true });
  doc.addEventListener("pointerout", onOut, { passive: true });
  return {
    destroy() {
      doc.removeEventListener("pointermove", onMove);
      doc.removeEventListener("pointerout", onOut);
      disarm();
      clearClose();
    },
    reset() {
      disarm();
      clearClose();
      outside = false;
      samples.length = 0;
    },
  };
}

export interface UseDockHoverIntentOptions {
  /** Hover peek is possible at all: live dock, collapsed, with a visible lane. */
  enabled: boolean;
  peeking: boolean;
  host: Omit<DockHoverHost, "matches" | "peeking" | "open" | "close"> & {
    open(): void;
    close(): void;
  };
}

const FINE_HOVER = "(hover: hover) and (pointer: fine)";

/** Install the dock hover intent while `enabled`; the host callbacks are read through a ref. */
export function useDockHoverIntent({ enabled, peeking, host }: UseDockHoverIntentOptions): void {
  const hostRef = useRef(host);
  hostRef.current = host;
  const peekingRef = useRef(peeking);
  peekingRef.current = peeking;
  const handleRef = useRef<ReturnType<typeof createDockHoverIntent> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const handle = createDockHoverIntent(document, {
      matches: () => (typeof window.matchMedia === "function" ? window.matchMedia(FINE_HOVER).matches : false),
      peeking: () => peekingRef.current,
      suppressed: () => hostRef.current.suppressed(),
      isBar: (t) => hostRef.current.isBar(t),
      isInside: (t) => hostRef.current.isInside(t),
      held: () => hostRef.current.held(),
      open: () => hostRef.current.open(),
      close: () => hostRef.current.close(),
      pointerLeftBar: () => hostRef.current.pointerLeftBar?.(),
    });
    handleRef.current = handle;
    return () => {
      handle.destroy();
      handleRef.current = null;
    };
  }, [enabled]);

  // A peek that ended by any other route (Pin, Escape, row target, rebind) drops its timers.
  useEffect(() => {
    if (!peeking) handleRef.current?.reset();
  }, [peeking]);
}
