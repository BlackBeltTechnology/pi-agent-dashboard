/**
 * Render-level suite for chat-motion PACING and GLIDE inside `ChatView`
 * (tasks 4.2, 4.13, 4.14, 4.19, 4.20, 6.1–6.4, 6.6, 6.15; test-plan #E24, #E25,
 * #E26, #E32, #X2, #X3, #X4). Fake timers drive rAF and `performance.now`.
 *
 * Harness glue copied from `ChatView.scroll-race.test.tsx` (clamping scroll
 * geometry on `HTMLElement.prototype`).
 * See change: add-fluid-chat-motion.
 */
import { DISPLAY_PRESETS, type DisplayPrefs } from "@blackbelt-technology/pi-dashboard-shared/display-prefs.js";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type ChatMessage, createInitialState, type SessionState } from "../../lib/chat/event-reducer.js";
import { DisplayPrefsProvider } from "../../lib/state/DisplayPrefsContext.js";
import { ChatView } from "../chat/ChatView.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";
import type { ToolContext } from "../tool-renderers/index.js";

const toolContext: ToolContext = {};

beforeAll(() => {
  Element.prototype.scrollTo = () => {};
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  Range.prototype.getClientRects = (() => [{ left: 80, right: 120, top: 10, bottom: 24, width: 40, height: 14 }]) as never;
});

// ── Clamping scroll geometry, recording every write ───────────────────────────
const geometry = { scrollTop: 0, scrollHeight: 0, clientHeight: 0 };
const writes: number[] = [];
const maxScrollTop = () => Math.max(geometry.scrollHeight - geometry.clientHeight, 0);
Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => geometry.scrollHeight });
Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => geometry.clientHeight });
Object.defineProperty(HTMLElement.prototype, "scrollTop", {
  configurable: true,
  get: () => geometry.scrollTop,
  set(v: number) {
    geometry.scrollTop = Math.min(Math.max(v, 0), maxScrollTop());
    writes.push(geometry.scrollTop);
  },
});

function setGeometry(scrollTop: number, scrollHeight: number, clientHeight: number) {
  geometry.scrollHeight = scrollHeight;
  geometry.clientHeight = clientHeight;
  geometry.scrollTop = Math.min(Math.max(scrollTop, 0), maxScrollTop());
}

const scroller = () => document.querySelector<HTMLElement>('[data-testid="chat-scroll-container"]')!;
const button = () => document.querySelector('[data-testid="scroll-to-bottom"]');
const busy = () => scroller().hasAttribute("data-chat-motion-busy");

function msgs(n: number): ChatMessage[] {
  return Array.from({ length: n }, (_, i) => ({ id: `m${i}`, role: "user" as const, content: `message ${i}`, timestamp: 1000 + i }));
}
function stateOf(messages: ChatMessage[], extra: Partial<SessionState> = {}): SessionState {
  return { ...createInitialState(), messages, ...extra };
}

type Opts = { prefs?: Partial<DisplayPrefs>; replayInFlight?: boolean | undefined; sessionId?: string };
function tree(state: SessionState, opts: Opts = {}) {
  const global = { ...DISPLAY_PRESETS.standard, ...opts.prefs };
  const replayInFlight = "replayInFlight" in opts ? opts.replayInFlight : false;
  return (
    <ThemeProvider>
      <DisplayPrefsProvider value={{ global, getSessionOverride: () => undefined }}>
        <ChatView sessionId={opts.sessionId ?? "s1"} state={state} toolContext={toolContext} replayInFlight={replayInFlight} />
      </DisplayPrefsProvider>
    </ThemeProvider>
  );
}

const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const words = (n: number) => `${"word ".repeat(Math.ceil(n / 5)).slice(0, n - 1)}x`;
const tailText = () => Array.from(document.querySelectorAll(".chat-stream-live .markdown-content")).map((e) => e.textContent).join("");

beforeEach(() => {
  vi.useFakeTimers();
  writes.length = 0;
  setGeometry(0, 0, 0);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Mount at the bottom of a transcript so follow is engaged. */
function mountFollowing(state: SessionState, opts: Opts = {}, clientHeight = 600, scrollHeight = 1000) {
  const view = render(tree(state, opts));
  setGeometry(scrollHeight - clientHeight, scrollHeight, clientHeight);
  fireEvent.scroll(scroller());
  writes.length = 0;
  return view;
}

describe("glide follow (E26, 6.1–6.3)", () => {
  it("glides for live growth Δ = clientHeight (600), single instant write at Δ = 601 (E26)", () => {
    const a = mountFollowing(stateOf(msgs(3)));
    setGeometry(400, 1600, 600); // grew by 600 → remaining 600
    a.rerender(tree(stateOf(msgs(4))));
    expect(writes.length).toBe(0); // nothing written synchronously
    advance(1000);
    expect(writes.length).toBeGreaterThanOrEqual(3);
    expect(geometry.scrollTop).toBe(1000);
    cleanup();

    writes.length = 0;
    const b = mountFollowing(stateOf(msgs(3)));
    setGeometry(400, 1601, 600); // remaining 601
    b.rerender(tree(stateOf(msgs(4))));
    expect(writes).toEqual([1001]); // one instant write to the bottom
  });

  it("matching glide steps never release follow or show the scroll button (6.3)", () => {
    const view = mountFollowing(stateOf(msgs(3)));
    setGeometry(400, 1400, 600);
    view.rerender(tree(stateOf(msgs(4))));
    for (let i = 0; i < 30; i += 1) {
      advance(16);
      fireEvent.scroll(scroller()); // the step's own event
      expect(button()).toBeNull();
    }
    expect(geometry.scrollTop).toBe(800);
    // Follow is still on: the next growth is followed.
    setGeometry(800, 1600, 600);
    view.rerender(tree(stateOf(msgs(5))));
    advance(1000);
    expect(geometry.scrollTop).toBe(1000);
  });

  it.each([
    ["a scrollbar drag / find-in-page (no input event)", () => {}],
    ["Page Up with focus in the transcript (keyboard)", () => {}],
    ["a wheel-up", () => fireEvent.wheel(scroller(), { deltaY: -400 })],
  ])("%s mid-glide releases follow, shows the button and ends the glide", (_name, input) => {
    const view = mountFollowing(stateOf(msgs(3)));
    setGeometry(400, 2000, 600);
    view.rerender(tree(stateOf(msgs(4))));
    advance(32); // glide in progress
    fireEvent.scroll(scroller());
    input();
    geometry.scrollTop = Math.max(geometry.scrollTop - 300, 0); // foreign move, off the achieved position
    fireEvent.scroll(scroller());
    expect(button()).not.toBeNull();
    writes.length = 0;
    advance(500);
    expect(writes.length).toBe(0); // the glide ended: no pull-back
    // Further streaming growth does not pull the view back either.
    setGeometry(geometry.scrollTop, 2600, 600);
    view.rerender(tree(stateOf(msgs(5))));
    advance(500);
    expect(writes.length).toBe(0);
  });

  it("a session switch mid-glide lands instantly and stops chasing (relocation)", () => {
    const view = mountFollowing(stateOf(msgs(3)));
    setGeometry(400, 1400, 600);
    view.rerender(tree(stateOf(msgs(4))));
    advance(32);
    view.rerender(tree(stateOf(msgs(3)), { sessionId: "other" }));
    writes.length = 0;
    advance(500);
    expect(writes.length).toBe(0);
  });
});

describe("data-chat-motion-busy and quiet cost (6.4, E32)", () => {
  it("is present while a glide runs and absent once it settles; no rAF at rest", () => {
    const view = mountFollowing(stateOf(msgs(3)));
    expect(busy()).toBe(false);
    setGeometry(400, 1200, 600);
    view.rerender(tree(stateOf(msgs(4))));
    expect(busy()).toBe(true);
    advance(1000);
    expect(busy()).toBe(false);
    const raf = vi.spyOn(globalThis, "requestAnimationFrame");
    advance(10_000);
    expect(raf).not.toHaveBeenCalled();
    raf.mockRestore();
  });

  it("is present while the answer reveal is paced and absent after it drains", () => {
    const view = mountFollowing(stateOf(msgs(2)));
    view.rerender(tree(stateOf(msgs(2), { streamingText: words(400) })));
    advance(16);
    expect(busy()).toBe(true);
    advance(1500);
    expect(tailText().length).toBeGreaterThan(300);
    advance(1000);
    expect(busy()).toBe(false);
  });
});

describe("paced reveal in ChatView (E10, E24, E25, X2, X3, X4)", () => {
  it("answer text is revealed progressively, in a replay-unaware host too (E10)", () => {
    const view = mountFollowing(stateOf(msgs(2)), { replayInFlight: undefined });
    view.rerender(tree(stateOf(msgs(2), { streamingText: words(400) }), { replayInFlight: undefined }));
    advance(48);
    const partial = tailText().length;
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(400);
    advance(1000);
    expect(tailText().length).toBe(400);
  });

  it.each([
    [true, true, true],
    [true, false, false],
    [false, true, false],
    [false, false, false],
  ])("reasoning: inlineFlow=%s expanded=%s → paced=%s (E24)", (inlineFlow, expanded, paced) => {
    const prefs = { reasoning: true, reasoningInlineFlow: inlineFlow };
    const view = mountFollowing(stateOf(msgs(2)), { prefs });
    view.rerender(tree(stateOf(msgs(2), { streamingThinking: "think" }), { prefs }));
    if (!expanded) fireEvent.click(document.querySelector('[data-testid="reasoning-block"] button')!); // collapse
    advance(16);
    view.rerender(tree(stateOf(msgs(2), { streamingThinking: `think ${words(400)}` }), { prefs }));
    if (!expanded) fireEvent.click(document.querySelector('[data-testid="reasoning-block"] button')!); // expand to observe
    const body = () => document.querySelector('[data-testid="reasoning-body"]')?.textContent ?? "";
    const length = body().length;
    if (paced) {
      expect(length).toBeLessThan(400);
      advance(1000);
      expect(body().length).toBeGreaterThanOrEqual(400);
    } else {
      expect(length).toBeGreaterThanOrEqual(400); // applied text, immediately
    }
  });

  it("a hidden document snaps to the full text and returns to pacing without re-hiding (E25)", () => {
    const view = mountFollowing(stateOf(msgs(2)));
    view.rerender(tree(stateOf(msgs(2), { streamingText: words(300) })));
    advance(32);
    expect(tailText().length).toBeLessThan(300);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    view.rerender(tree(stateOf(msgs(2), { streamingText: words(400) })));
    expect(tailText().length).toBe(400);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(tailText().length).toBe(400); // never re-hidden
  });

  it("preference off mid-motion: all received text now, one instant pin, no further rAF (X3)", () => {
    const view = mountFollowing(stateOf(msgs(2)));
    view.rerender(tree(stateOf(msgs(2), { streamingText: words(300) })));
    setGeometry(400, 1300, 600); // glide in flight
    view.rerender(tree(stateOf(msgs(2), { streamingText: words(300) + words(30) })));
    advance(32);
    writes.length = 0;
    view.rerender(tree(stateOf(msgs(2), { streamingText: words(330) }), { prefs: { chatMotion: false } }));
    expect(tailText().length).toBe(330);
    expect(writes.length).toBe(1);
    expect(geometry.scrollTop).toBe(700);
    const raf = vi.spyOn(globalThis, "requestAnimationFrame");
    advance(2000);
    expect(raf).not.toHaveBeenCalled();
    raf.mockRestore();
  });

  it("abort mid-stream: the committed row shows full content in that commit, no overlay (X2)", () => {
    const view = mountFollowing(stateOf(msgs(2)));
    view.rerender(tree(stateOf(msgs(2), { streamingText: words(300) })));
    advance(32);
    const full = words(300);
    const committed: ChatMessage = { id: "a1", role: "assistant", content: full, timestamp: 5000 };
    view.rerender(tree(stateOf([...msgs(2), committed])));
    expect(document.body.textContent).toContain(full.trim().slice(0, 40));
    expect(document.querySelector(".chat-stream-live")).toBeNull();
    expect(document.querySelector('[data-testid="trailing-edge"]')).toBeNull();
    advance(500);
    expect(busy()).toBe(false);
  });

  it("a stalled stream schedules no frames and the overlay fades out within 700 ms (X4)", () => {
    const view = mountFollowing(stateOf(msgs(2)));
    view.rerender(tree(stateOf(msgs(2), { streamingText: words(200) })));
    advance(1500); // reveal drained
    const overlay = () => document.querySelector<HTMLElement>('[data-testid="trailing-edge"]');
    advance(700);
    expect(overlay()?.style.opacity ?? "0").toBe("0");
    const raf = vi.spyOn(globalThis, "requestAnimationFrame");
    advance(3000); // the stall: no deltas
    expect(raf).not.toHaveBeenCalled();
    raf.mockRestore();
  });
});
