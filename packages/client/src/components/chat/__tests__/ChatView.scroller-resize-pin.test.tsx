/**
 * A pinned transcript stays pinned when its SCROLLER shrinks (the canvas chip
 * slot above the composer appearing): one ResizeObserver on the scroller re-pins
 * in follow mode only, re-attaches to the scroller remounted by a session switch,
 * and never moves a scrolled-up reader. jsdom has no ResizeObserver or layout, so
 * both are faked here; the real geometry is the Playwright #F9 scenario.
 * See change: fix-chat-transcript-layout (D6, task 4.15).
 */
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DISPLAY_PRESETS } from "@blackbelt-technology/pi-dashboard-shared/display-prefs.js";
import { type ChatMessage, createInitialState, type SessionState } from "../../../lib/chat/event-reducer.js";
import { DisplayPrefsProvider } from "../../../lib/state/DisplayPrefsContext.js";
import { ThemeProvider } from "../../settings/ThemeProvider.js";
import type { ToolContext } from "../../tool-renderers/index.js";
import { ChatView } from "../ChatView.js";

const toolContext: ToolContext = {};

interface FakeRO {
  cb: () => void;
  targets: Element[];
  disconnected: boolean;
}
const observers: FakeRO[] = [];
const origRO = globalThis.ResizeObserver;

beforeAll(() => {
  Element.prototype.scrollTo = () => {};
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  globalThis.ResizeObserver = class {
    private rec: FakeRO;
    constructor(cb: () => void) {
      this.rec = { cb, targets: [], disconnected: false };
      observers.push(this.rec);
    }
    observe(el: Element) {
      this.rec.targets.push(el);
    }
    unobserve() {}
    disconnect() {
      this.rec.disconnected = true;
    }
  } as unknown as typeof ResizeObserver;
});
afterAll(() => {
  globalThis.ResizeObserver = origRO;
});
afterEach(() => {
  cleanup();
  observers.length = 0;
});

function text(id: string): ChatMessage {
  return { id, role: "assistant", content: `message ${id}`, timestamp: 1000 };
}

function tree(sessionId: string) {
  const state: SessionState = { ...createInitialState(), messages: [text(`${sessionId}-1`), text(`${sessionId}-2`)] };
  return (
    <ThemeProvider>
      <DisplayPrefsProvider value={{ global: DISPLAY_PRESETS.standard, getSessionOverride: () => undefined }}>
        <ChatView sessionId={sessionId} state={state} toolContext={toolContext} replayInFlight={false} />
      </DisplayPrefsProvider>
    </ThemeProvider>
  );
}

const scroller = (c: HTMLElement) => c.querySelector('[data-testid="chat-scroll-container"]') as HTMLElement;

/** Give the scroller a geometry: content 2000 px, viewport `client` px. */
function setGeometry(el: HTMLElement, client: number) {
  Object.defineProperty(el, "scrollHeight", { configurable: true, value: 2000 });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: client });
}

/** The live observer watching `el` (latest, not disconnected). */
function observerOf(el: HTMLElement): FakeRO | undefined {
  return [...observers].reverse().find((o) => !o.disconnected && o.targets.includes(el));
}

describe("ChatView — scroller resize re-pins in follow mode (D6)", () => {
  it("a pinned transcript re-pins when the scroller shrinks", () => {
    const { container } = render(tree("A"));
    const el = scroller(container);
    const ro = observerOf(el);
    expect(ro, "scroller observed").not.toBe(undefined);
    setGeometry(el, 600);
    el.scrollTop = 1400; // at the bottom: 2000 - 600
    // The chip slot appears: the viewport shrinks by 44 px, scrollTop unchanged.
    setGeometry(el, 556);
    act(() => ro?.cb());
    expect(el.scrollTop).toBe(2000);
  });

  it("a scrolled-up reader is not moved when the scroller shrinks", () => {
    const { container } = render(tree("A"));
    const el = scroller(container);
    setGeometry(el, 600);
    el.scrollTop = 300;
    fireEvent.scroll(el); // far from the bottom → follow released
    const ro = observerOf(el);
    setGeometry(el, 556);
    act(() => ro?.cb());
    expect(el.scrollTop).toBe(300);
  });

  it("re-attaches to the scroller remounted by a session switch", () => {
    const { container, rerender } = render(tree("A"));
    const first = scroller(container);
    rerender(tree("B"));
    const second = scroller(container);
    expect(second).not.toBe(first); // FilePreviewProvider key={sessionId} remounts it
    const ro = observerOf(second);
    expect(ro, "new scroller observed").not.toBe(undefined);
    setGeometry(second, 600);
    second.scrollTop = 1400;
    setGeometry(second, 556);
    act(() => ro?.cb());
    expect(second.scrollTop).toBe(2000);
  });
});
