/**
 * Dock hover intent (timing rules): dwell + speed gate, grace close, held peek.
 * DOM-bound rules (popovers, focus, Escape, dialogs) are covered through the real dock in
 * `ComposerDock.peek.test.tsx`. Test-plan #F1–#F4 #F6 #F7 #F9 (timing half); #P1 runs against the real dock in the peek test.
 * See change: composer-dock-collapse-and-file-open (tasks 3.1, 3.5–3.8, 3.10–3.13).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HOVER_CLOSE_GRACE_MS,
  HOVER_DWELL_MS,
  HOVER_SPEED_CUTOFF,
  HOVER_SPEED_WINDOW_MS,
} from "../../session/session-hover-intent.js";
import { createDockHoverIntent, type DockHoverHost } from "../useDockHoverIntent.js";

let barEl: HTMLElement;
let overlayEl: HTMLElement;
let elsewhere: HTMLElement;
let host: DockHoverHost & { isPeek: boolean; heldNow: boolean; suppress: boolean };
let handle: { destroy(): void; reset(): void };
let opened = 0;
let closed = 0;

function move(target: Element, x: number, y = 20, init: MouseEventInit = {}) {
  const e = new MouseEvent("pointermove", { bubbles: true, clientX: x, clientY: y, ...init });
  Object.defineProperty(e, "pointerType", { value: "mouse" });
  target.dispatchEvent(e);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  opened = 0;
  closed = 0;
  document.body.innerHTML = `<div id="root"><div id="overlay"></div><button id="bar">bar</button></div><div id="else"></div>`;
  barEl = document.getElementById("bar") as HTMLElement;
  overlayEl = document.getElementById("overlay") as HTMLElement;
  elsewhere = document.getElementById("else") as HTMLElement;
  host = {
    isPeek: false,
    heldNow: false,
    suppress: false,
    matches: () => true,
    suppressed: () => host.suppress,
    peeking: () => host.isPeek,
    isBar: (t) => !!t && barEl.contains(t),
    isInside: (t) => !!t && (barEl.contains(t) || overlayEl.contains(t)),
    held: () => host.heldNow,
    open: () => {
      opened++;
      host.isPeek = true;
    },
    close: () => {
      closed++;
      host.isPeek = false;
    },
  };
  handle = createDockHoverIntent(document, host);
});

afterEach(() => {
  handle.destroy();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("arming", () => {
  it("F1: rests 300 ms on the bar (button itself arms) → peeks, without touching focus", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    move(barEl, 10);
    vi.advanceTimersByTime(HOVER_DWELL_MS);
    expect(opened).toBe(1);
    expect(document.activeElement).toBe(input);
  });

  it("F2: 299 ms then leaving never peeks", () => {
    move(barEl, 10);
    vi.advanceTimersByTime(HOVER_DWELL_MS - 1);
    move(elsewhere, 400);
    vi.advanceTimersByTime(HOVER_DWELL_MS * 3);
    expect(opened).toBe(0);
  });

  it("F3: a fast pass across the bar (1.5 px/ms) never peeks", () => {
    for (let x = 0, t = 0; x < 600; x += 1.5, t++) {
      vi.setSystemTime(t);
      move(x < 300 ? barEl : elsewhere, x);
    }
    vi.advanceTimersByTime(HOVER_DWELL_MS * 3);
    expect(opened).toBe(0);
  });

  it("F4: 0.39 px/ms over the last window peeks; 0.41 waits until the speed drops", () => {
    const slow = (rate: number) => {
      let x = 0;
      for (let t = 0; t <= HOVER_DWELL_MS; t += 10) {
        vi.setSystemTime(t);
        move(barEl, x);
        x += rate * 10;
      }
    };
    slow(HOVER_SPEED_CUTOFF - 0.01);
    vi.advanceTimersByTime(1);
    expect(opened).toBe(1);

    host.isPeek = false;
    handle.reset();
    vi.setSystemTime(10_000);
    let x = 0;
    for (let t = 0; t <= HOVER_DWELL_MS; t += 10) {
      vi.setSystemTime(10_000 + t);
      move(barEl, x);
      x += (HOVER_SPEED_CUTOFF + 0.01) * 10;
    }
    vi.advanceTimersByTime(1);
    expect(opened).toBe(1); // still too fast
    // The pointer comes to rest: the speed window rolls on and the peek follows.
    vi.advanceTimersByTime(HOVER_SPEED_WINDOW_MS * 2);
    expect(opened).toBe(2);
  });

  it("F5: suppression (pressed button, dialog / popover) never arms", () => {
    move(barEl, 10, 20, { buttons: 1 });
    vi.advanceTimersByTime(HOVER_DWELL_MS * 2);
    expect(opened).toBe(0);
    host.suppress = true;
    move(barEl, 11);
    vi.advanceTimersByTime(HOVER_DWELL_MS * 2);
    expect(opened).toBe(0);
  });

  it("F5: no fine hover never arms", () => {
    handle.destroy();
    handle = createDockHoverIntent(document, { ...host, matches: () => false });
    move(barEl, 10);
    vi.advanceTimersByTime(HOVER_DWELL_MS * 2);
    expect(opened).toBe(0);
  });

  it("200 moves over the bar arm once: exactly one open callback", () => {
    for (let i = 0; i < 200; i++) {
      vi.setSystemTime(i);
      move(barEl, 10);
    }
    vi.advanceTimersByTime(HOVER_DWELL_MS);
    expect(opened).toBe(1);
  });
});

describe("closing", () => {
  const peek = () => {
    move(barEl, 10);
    vi.advanceTimersByTime(HOVER_DWELL_MS);
    expect(host.isPeek).toBe(true);
  };

  it("F6: still peeked at 299 ms outside, collapsed at 301 ms", () => {
    peek();
    move(elsewhere, 400);
    vi.advanceTimersByTime(HOVER_CLOSE_GRACE_MS - 1);
    expect(host.isPeek).toBe(true);
    vi.advanceTimersByTime(2);
    expect(host.isPeek).toBe(false);
    expect(closed).toBe(1);
  });

  it("returning inside the zone cancels the close", () => {
    peek();
    move(elsewhere, 400);
    vi.advanceTimersByTime(HOVER_CLOSE_GRACE_MS - 50);
    move(overlayEl, 20);
    vi.advanceTimersByTime(HOVER_CLOSE_GRACE_MS * 2);
    expect(host.isPeek).toBe(true);
  });

  it("F7/F9: a held peek (open menu / focus inside) stays open; the grace starts when the hold ends", () => {
    peek();
    host.heldNow = true;
    move(elsewhere, 400);
    vi.advanceTimersByTime(HOVER_CLOSE_GRACE_MS * 4);
    expect(host.isPeek).toBe(true);
    host.heldNow = false;
    vi.advanceTimersByTime(HOVER_CLOSE_GRACE_MS + 150);
    expect(host.isPeek).toBe(false);
  });

  it("leaving the browser window (pointerout with no relatedTarget) starts the grace period", () => {
    peek();
    const out = new MouseEvent("pointerout", { bubbles: true, relatedTarget: null });
    document.documentElement.dispatchEvent(out);
    vi.advanceTimersByTime(HOVER_CLOSE_GRACE_MS + 1);
    expect(host.isPeek).toBe(false);
  });

  it("a cooldown ends when the pointer moves off the bar", () => {
    const left = vi.fn();
    handle.destroy();
    handle = createDockHoverIntent(document, { ...host, pointerLeftBar: left });
    move(elsewhere, 400);
    expect(left).toHaveBeenCalled();
  });
});
