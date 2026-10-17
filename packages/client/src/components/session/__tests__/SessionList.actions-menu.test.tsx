/**
 * `SessionList` ↔ session actions menu: one open actions menu across folder and
 * session scopes (F11), the hover strip arming only through the list's single
 * document listener and costing zero React commits (P1).
 * See change: add-session-actions-flyout (test-plan F11, F10, P1).
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Profiler } from "react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { ThemeProvider } from "../../settings/ThemeProvider.js";
import { HOVER_DWELL_MS } from "../session-hover-intent.js";
import { SessionList } from "../SessionList.js";

let fineHover = true;

beforeEach(() => {
  fineHover = true;
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: /hover: hover/.test(query) ? fineHover : false,
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
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Router_({ children }: { children: React.ReactNode }) {
  const { hook } = memoryLocation({ path: "/", static: true });
  return <Router hook={hook}>{children}</Router>;
}

function make(id: string, cwd: string): DashboardSession {
  return { id, cwd, source: "tui", status: "idle", startedAt: Date.now() - 60_000, gitBranch: "main" } as DashboardSession;
}

/** The hover controller is a code-split chunk: wait for it to be installed. */
async function hoverReady(): Promise<void> {
  await act(async () => {
    await vi.dynamicImportSettled();
  });
}

function list(sessions: DashboardSession[], extra: Partial<React.ComponentProps<typeof SessionList>> = {}) {
  return (
    <Router_>
      <ThemeProvider>
        <SessionList sessions={sessions} onSelect={() => {}} onSpawnSession={vi.fn()} {...extra} />
      </ThemeProvider>
    </Router_>
  );
}

describe("one open actions menu across folder and session scopes (F11)", () => {
  it("opening a session menu closes the folder menu, and opening the folder menu closes the session menu", () => {
    render(list([make("s1", "/a")]));
    const folderTrigger = screen.getByTestId("folder-actions-menu-/a");
    fireEvent.click(folderTrigger);
    expect(screen.getByTestId("folder-actions-menu-panel-/a")).toBeTruthy();

    fireEvent.click(screen.getByTestId("session-actions-trigger-s1"));
    expect(screen.queryByTestId("folder-actions-menu-panel-/a")).toBeNull();
    expect(screen.getByTestId("session-actions-menu-s1")).toBeTruthy();
    expect(screen.getAllByRole("menu")).toHaveLength(1);

    fireEvent.click(folderTrigger);
    expect(screen.queryByTestId("session-actions-menu-s1")).toBeNull();
    expect(screen.getByTestId("folder-actions-menu-panel-/a")).toBeTruthy();
    expect(screen.getAllByRole("menu")).toHaveLength(1);
  });

  it("opening one session's menu closes another session's menu", () => {
    render(list([make("s1", "/a"), make("s2", "/a")]));
    fireEvent.click(screen.getByTestId("session-actions-trigger-s1"));
    fireEvent.click(screen.getByTestId("session-actions-trigger-s2"));
    expect(screen.queryByTestId("session-actions-menu-s1")).toBeNull();
    expect(screen.getByTestId("session-actions-menu-s2")).toBeTruthy();
  });

  it("the session list region is a focus fallback target", () => {
    render(list([make("s1", "/a")]));
    const region = screen.getByTestId("session-list-scroll");
    expect(region.hasAttribute("data-session-list-region")).toBe(true);
    expect(region.getAttribute("tabindex")).toBe("-1");
  });
});

describe("hover strip through the list's document listener", () => {
  function stripOf(id: string) {
    const li = document.querySelector(`[data-session-card][data-session-id="${id}"]`) as HTMLElement;
    li.getBoundingClientRect = () => ({ left: 0, top: 0, right: 300, bottom: 80, width: 300, height: 80, x: 0, y: 0, toJSON() {} }) as DOMRect;
    return li;
  }
  function move(target: Element, x: number) {
    const e = new MouseEvent("pointermove", { bubbles: true, clientX: x, clientY: 20 });
    Object.defineProperty(e, "pointerType", { value: "mouse" });
    target.dispatchEvent(e);
  }

  it("a dwell in the strip opens the card's menu without moving focus; Escape closes it", async () => {
    vi.useFakeTimers();
    render(list([make("s1", "/a")]));
    await hoverReady();
    const li = stripOf("s1");
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    act(() => {
      move(li.querySelector("span.font-semibold") as Element, 290);
      vi.advanceTimersByTime(HOVER_DWELL_MS);
    });
    expect(screen.getByTestId("session-actions-menu-s1")).toBeTruthy();
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByTestId("session-actions-menu-s1")).toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it("never arms on a device without fine hover, while the trigger still opens the menu (F10)", async () => {
    fineHover = false;
    vi.useFakeTimers();
    render(list([make("s1", "/a")]));
    await hoverReady();
    const li = stripOf("s1");
    act(() => {
      move(li.querySelector("span.font-semibold") as Element, 290);
      vi.advanceTimersByTime(HOVER_DWELL_MS * 2);
    });
    expect(screen.queryByTestId("session-actions-menu-s1")).toBeNull();
    fireEvent.click(screen.getByTestId("session-actions-trigger-s1"));
    expect(screen.getByTestId("session-actions-menu-s1")).toBeTruthy();
  });

  it("does not arm while a click-opened menu is open (F10)", async () => {
    vi.useFakeTimers();
    render(list([make("s1", "/a"), make("s2", "/a")]));
    await hoverReady();
    fireEvent.click(screen.getByTestId("session-actions-trigger-s1"));
    const li2 = stripOf("s2");
    act(() => {
      move(li2.querySelector("span.font-semibold") as Element, 290);
      vi.advanceTimersByTime(HOVER_DWELL_MS * 2);
    });
    expect(screen.queryByTestId("session-actions-menu-s2")).toBeNull();
    expect(screen.getByTestId("session-actions-menu-s1")).toBeTruthy();
  });

  it("P1: a pointer sweep across 50 cards (never dwelling) causes zero React commits", async () => {
    vi.useFakeTimers();
    const sessions = Array.from({ length: 50 }, (_, i) => make(`s${i}`, `/proj/${i % 5}`));
    let commits = 0;
    render(
      <Profiler id="list" onRender={() => { commits++; }}>
        {list(sessions)}
      </Profiler>,
    );
    await hoverReady();
    const cards = Array.from(document.querySelectorAll<HTMLElement>("[data-session-card]"));
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) {
      c.getBoundingClientRect = () => ({ left: 0, top: 0, right: 300, bottom: 80, width: 300, height: 80, x: 0, y: 0, toJSON() {} }) as DOMRect;
    }
    const before = commits;
    let t = 0;
    for (const c of cards) {
      const inner = c.querySelector("span.font-semibold") as Element;
      for (let x = 0; x <= 330; x += 22) {
        // 1.5 px/ms
        t += 15;
        vi.setSystemTime(t);
        move(x <= 300 ? inner : document.body, x);
      }
    }
    expect(commits - before).toBe(0);
  });
});
