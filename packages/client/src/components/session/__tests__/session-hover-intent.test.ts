/**
 * Hover intent for the session actions menu: one `document` pointermove
 * listener, dwell + speed gate, geometric strip, bridge + grace close.
 * See change: add-session-actions-flyout (test-plan F5–F10, P1).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createHoverIntent,
  HOVER_CLOSE_GRACE_MS,
  HOVER_DWELL_MS,
  HOVER_SPEED_CUTOFF,
  HOVER_SPEED_WINDOW_MS,
  HOVER_STRIP_PX,
  type HoverIntentHost,
} from "../session-hover-intent.js";

const R = 300; // card right edge
const rect = (over: Partial<DOMRect> = {}): DOMRect =>
  ({ left: 0, top: 0, right: R, bottom: 80, width: R, height: 80, x: 0, y: 0, toJSON() {}, ...over }) as DOMRect;

let card: HTMLElement;
let inner: HTMLElement;
let host: HoverIntentHost & { openFor: string | null };
let menu: HTMLElement | null;
let controller: { destroy(): void };
let opened: string[];
let closed: number;

function mount(markup = "") {
  document.body.innerHTML = `<ul><li data-session-card data-session-id="s1"><span id="inner">name</span><button id="x">x</button>${markup}</li></ul>`;
  card = document.querySelector("[data-session-card]") as HTMLElement;
  inner = document.getElementById("inner") as HTMLElement;
  card.getBoundingClientRect = () => rect();
}

function move(target: Element, x: number, y = 20, init: PointerEventInit = {}) {
  const e = new MouseEvent("pointermove", { bubbles: true, clientX: x, clientY: y, ...init });
  Object.defineProperty(e, "pointerType", { value: "mouse" });
  target.dispatchEvent(e);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  opened = [];
  closed = 0;
  menu = null;
  mount();
  host = {
    openFor: null,
    matches: () => true,
    suppressed: () => false,
    open: (id) => {
      opened.push(id);
      host.openFor = id;
    },
    close: () => {
      closed++;
      host.openFor = null;
    },
    hoverOpenFor: () => host.openFor,
    menuEl: () => menu,
  };
  controller = createHoverIntent(document, host);
});

afterEach(() => {
  controller.destroy();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("arming (F5, F6, F7)", () => {
  it("a fast pass through the strip toward the chat never opens (F5)", () => {
    // 1.5 px/ms: 1 ms per 1.5 px, leaving the 32 px strip in ~21 ms
    for (let x = R - HOVER_STRIP_PX - 20, t = 0; x < R + 60; x += 1.5, t++) {
      vi.setSystemTime(t);
      move(x <= R ? inner : document.body, x);
    }
    vi.advanceTimersByTime(HOVER_DWELL_MS * 3);
    expect(opened).toEqual([]);
  });

  it("opens at 300 ms but not at 299 ms, without touching focus (F6)", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    move(inner, R - 10);
    vi.advanceTimersByTime(HOVER_DWELL_MS - 1);
    expect(opened).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(opened).toEqual(["s1"]);
    expect(document.activeElement).toBe(input);
  });

  it("does not open while the pointer is faster than the speed cutoff, then opens once it settles", () => {
    // wiggle fast inside the strip for the whole dwell
    let t = 0;
    for (; t <= HOVER_DWELL_MS + 50; t += 10) {
      vi.setSystemTime(t);
      move(inner, R - 28 + ((t / 10) % 2 === 0 ? 0 : 27), 20);
      vi.advanceTimersByTime(0);
    }
    expect(opened).toEqual([]);
    // rest: the 100 ms speed window empties, the next move re-checks
    vi.setSystemTime(t + 200);
    move(inner, R - 10);
    expect(opened).toEqual(["s1"]);
    expect(HOVER_SPEED_CUTOFF).toBe(0.4);
  });

  it("a fast entry that then comes to rest still opens once the speed window rolls over (no further move needed)", () => {
    // sweep in quickly, then stop dead inside the strip
    for (let i = 0; i < 6; i++) {
      vi.setSystemTime(i * 10);
      move(inner, R - 31 + i * 5);
    }
    vi.setSystemTime(60);
    vi.advanceTimersByTime(HOVER_DWELL_MS - 60); // dwell timer fires while still "fast"
    expect(opened).toEqual([]);
    vi.advanceTimersByTime(HOVER_SPEED_WINDOW_MS + 5); // the re-check after the window rolled on
    expect(opened).toEqual(["s1"]);
  });

  it("strip geometry: R−33 does not arm, R−32 and R−1 do (F7)", () => {
    move(inner, R - HOVER_STRIP_PX - 1);
    vi.advanceTimersByTime(HOVER_DWELL_MS);
    expect(opened).toEqual([]);
    move(inner, R - HOVER_STRIP_PX);
    vi.advanceTimersByTime(HOVER_DWELL_MS);
    expect(opened).toEqual(["s1"]);
    opened.length = 0;
    host.openFor = null;
    move(inner, R - 1);
    vi.advanceTimersByTime(HOVER_DWELL_MS);
    expect(opened).toEqual(["s1"]);
  });

  it("never arms over a button or link (the ✕ stays usable) (F7)", () => {
    const x = document.getElementById("x") as HTMLElement;
    move(x, R - 10);
    vi.advanceTimersByTime(HOVER_DWELL_MS * 2);
    expect(opened).toEqual([]);
  });

  it("leaving the strip before the dwell elapses cancels it", () => {
    move(inner, R - 10);
    vi.advanceTimersByTime(HOVER_DWELL_MS - 50);
    move(inner, R - 100);
    vi.advanceTimersByTime(HOVER_DWELL_MS);
    expect(opened).toEqual([]);
  });
});

describe("arming suppressed (F10)", () => {
  it.each([
    ["a click-opened menu or dialog is open", () => {
      host.suppressed = () => true;
    }],
    ["no fine hover", () => {
      host.matches = () => false;
    }],
    ["inline rename is active", () => {
      card.insertAdjacentHTML("beforeend", "<input />");
    }],
    ["a drag is in progress", () => {
      document.body.insertAdjacentHTML("beforeend", '<div data-session-dragging=""></div>');
    }],
  ])("%s → never opens", (_n, setup) => {
    setup();
    move(inner, R - 10);
    vi.advanceTimersByTime(HOVER_DWELL_MS * 2);
    expect(opened).toEqual([]);
  });

  it("a pressed pointer (buttons != 0) never arms", () => {
    move(inner, R - 10, 20, { buttons: 1 });
    vi.advanceTimersByTime(HOVER_DWELL_MS * 2);
    expect(opened).toEqual([]);
  });

  it("a touch pointer never arms", () => {
    const e = new MouseEvent("pointermove", { bubbles: true, clientX: R - 10, clientY: 20 });
    Object.defineProperty(e, "pointerType", { value: "touch" });
    inner.dispatchEvent(e);
    vi.advanceTimersByTime(HOVER_DWELL_MS * 2);
    expect(opened).toEqual([]);
  });
});

describe("bridge and grace close (F8)", () => {
  beforeEach(() => {
    menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    document.body.appendChild(menu);
    menu.getBoundingClientRect = () => rect({ left: R + 8, right: R + 8 + 240, top: 0, bottom: 400, width: 240, height: 400 });
    host.openFor = "s1";
  });

  it("stays open over the card, the gap and the (body-portaled) menu for 1 s", () => {
    move(inner, 50);
    move(document.body, R + 4, 30); // the 8 px gap, target is body
    move(menu as HTMLElement, R + 100, 30);
    vi.advanceTimersByTime(1000);
    expect(closed).toBe(0);
  });

  it("closes only after the grace period outside card ∪ gap ∪ menu (299 ms open, 301 ms closed)", () => {
    move(document.body, R + 500, 700);
    vi.advanceTimersByTime(HOVER_CLOSE_GRACE_MS - 1);
    expect(closed).toBe(0);
    vi.advanceTimersByTime(2);
    expect(closed).toBe(1);
  });

  it("re-entering before the grace elapses cancels the close", () => {
    move(document.body, R + 500, 700);
    vi.advanceTimersByTime(HOVER_CLOSE_GRACE_MS - 50);
    move(menu as HTMLElement, R + 20, 30);
    vi.advanceTimersByTime(HOVER_CLOSE_GRACE_MS);
    expect(closed).toBe(0);
  });
});

describe("destroy", () => {
  it("removes the listener and pending timers", () => {
    move(inner, R - 10);
    controller.destroy();
    vi.advanceTimersByTime(HOVER_DWELL_MS * 2);
    expect(opened).toEqual([]);
    move(inner, R - 10);
    vi.advanceTimersByTime(HOVER_DWELL_MS * 2);
    expect(opened).toEqual([]);
  });
});
