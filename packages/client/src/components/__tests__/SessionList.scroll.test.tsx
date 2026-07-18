import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import React from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { SessionList } from "../session/SessionList.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function TestRouter({ children }: { children: React.ReactNode }) {
  const { hook } = memoryLocation({ path: "/", static: true });
  return <Router hook={hook}>{children}</Router>;
}

let scrollSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  const store: Record<string, string> = {};
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { for (const k in store) delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  });
  scrollSpy = vi.fn();
  // jsdom doesn't implement scrollIntoView; spy at the prototype level.
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    writable: true,
    value: scrollSpy,
  });
});

afterEach(() => cleanup());

function s(overrides: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id: "s1",
    cwd: "/proj",
    source: "tui",
    status: "active",
    startedAt: Date.now() - 60000,
    tokensIn: 0,
    tokensOut: 0,
    cost: 0,
    ...overrides,
  };
}

function mount(props: Parameters<typeof SessionList>[0]) {
  return render(
    <TestRouter>
      <ThemeProvider>
        <SessionList {...props} />
      </ThemeProvider>
    </TestRouter>,
  );
}

describe("SessionList auto-scroll-selected-session-card", () => {
  it("scrolls the selected card into view on first mount (deep-link)", () => {
    mount({
      sessions: [s({ id: "s1" }), s({ id: "s2" })],
      selectedId: "s2",
      onSelect: () => {},
    });
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledWith({ block: "nearest", behavior: "auto" });
  });

  it("does NOT scroll on mount when selectedId is undefined", () => {
    mount({
      sessions: [s({ id: "s1" }), s({ id: "s2" })],
      onSelect: () => {},
    });
    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it("does NOT scroll when selectedId changes after mount (user click)", () => {
    const { rerender } = mount({
      sessions: [s({ id: "s1" }), s({ id: "s2" })],
      selectedId: "s1",
      onSelect: () => {},
    });
    scrollSpy.mockClear(); // discard the first-mount scroll
    rerender(
      <TestRouter>
        <ThemeProvider>
          <SessionList
            sessions={[s({ id: "s1" }), s({ id: "s2" })]}
            selectedId="s2"
            onSelect={() => {}}
          />
        </ThemeProvider>
      </TestRouter>,
    );
    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it("scrolls when sessionOrderMap reorders the selected card (background re-sort, card stays in DOM)", () => {
    const sessions = [s({ id: "s1" }), s({ id: "s2" })];
    const orderA = new Map([["/proj", ["s1", "s2"]]]);
    const orderB = new Map([["/proj", ["s2", "s1"]]]);
    const { rerender } = mount({
      sessions,
      selectedId: "s1",
      onSelect: () => {},
      sessionOrderMap: orderA,
    });
    scrollSpy.mockClear();
    rerender(
      <TestRouter>
        <ThemeProvider>
          <SessionList
            sessions={sessions}
            selectedId="s1"
            onSelect={() => {}}
            sessionOrderMap={orderB}
          />
        </ThemeProvider>
      </TestRouter>,
    );
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledWith({ block: "nearest", behavior: "auto" });
  });

  it("does NOT scroll when only currentTool changes (non-position-affecting)", () => {
    const { rerender } = mount({
      sessions: [s({ id: "s1", currentTool: null }), s({ id: "s2" })],
      selectedId: "s1",
      onSelect: () => {},
    });
    scrollSpy.mockClear();
    rerender(
      <TestRouter>
        <ThemeProvider>
          <SessionList
            sessions={[s({ id: "s1", currentTool: "bash" }), s({ id: "s2" })]}
            selectedId="s1"
            onSelect={() => {}}
          />
        </ThemeProvider>
      </TestRouter>,
    );
    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it("after a click-driven selection switch, a background re-sort of the new selection scrolls correctly", () => {
    const sessions = [s({ id: "s1" }), s({ id: "s2" })];
    const orderA = new Map([["/proj", ["s1", "s2"]]]);
    const orderB = new Map([["/proj", ["s2", "s1"]]]);
    const { rerender } = mount({
      sessions,
      selectedId: "s1",
      onSelect: () => {},
      sessionOrderMap: orderA,
    });
    scrollSpy.mockClear();
    // User clicks s2 — no scroll expected.
    rerender(
      <TestRouter>
        <ThemeProvider>
          <SessionList
            sessions={sessions}
            selectedId="s2"
            onSelect={() => {}}
            sessionOrderMap={orderA}
          />
        </ThemeProvider>
      </TestRouter>,
    );
    expect(scrollSpy).not.toHaveBeenCalled();
    // Now s2 is reordered — background re-sort should scroll.
    rerender(
      <TestRouter>
        <ThemeProvider>
          <SessionList
            sessions={sessions}
            selectedId="s2"
            onSelect={() => {}}
            sessionOrderMap={orderB}
          />
        </ThemeProvider>
      </TestRouter>,
    );
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledWith({ block: "nearest", behavior: "auto" });
  });

  it("does NOT scroll when the selected card is filtered out by sessionSearch (no DOM match)", () => {
    // Filter out card by mounting with selectedId pointing to a session not in `sessions`.
    // This exercises the fingerprint=null branch — no DOM lookup, no scroll.
    mount({
      sessions: [s({ id: "s1" })],
      selectedId: "missing-session",
      onSelect: () => {},
    });
    expect(scrollSpy).not.toHaveBeenCalled();
  });
});
