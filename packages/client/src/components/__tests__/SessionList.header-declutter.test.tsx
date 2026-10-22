/**
 * Declutter-sidebar-header: row-1 order/grouping, scoped search box, filter funnel.
 * See change: declutter-sidebar-header (test-plan #E1 #E2 #E9-#E14 #E19 #E20 #F2 #F3).
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { SessionList } from "../session/SessionList.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";
import { openFilterFunnel, setSidebarSearch } from "./sidebar-search-helper.js";

function TestRouter({ children }: { children: React.ReactNode }) {
  const { hook } = memoryLocation({ path: "/", static: true });
  return <Router hook={hook}>{children}</Router>;
}

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
  window.localStorage.clear();
});
afterEach(() => cleanup());

let seq = 0;
const mk = (over: Partial<DashboardSession> = {}): DashboardSession => {
  seq += 1;
  return { id: `s-${seq}`, cwd: "/w/dashboard", source: "tui", status: "active", startedAt: Date.now() - 60000, tokensIn: 0, tokensOut: 0, cost: 0, ...over };
};

function renderList(sessions: DashboardSession[], extra: Record<string, unknown> = {}) {
  return render(
    <TestRouter>
      <ThemeProvider>
        <SessionList sessions={sessions} onSelect={() => {}} {...extra} />
      </ThemeProvider>
    </TestRouter>,
  );
}
const ids = (el: HTMLElement) => [...el.querySelectorAll("[data-testid]")].map((e) => e.getAttribute("data-testid"));
const sessionVisible = (c: HTMLElement, id: string) => !!c.querySelector(`[data-session-id="${id}"]`);
const folderVisible = (cwd: string) => !!screen.queryByTestId(`folder-home-row-${cwd}`);

describe("row 1", () => {
  it("E1: order is logo → Discord → divider → Appearance → Focus, then the right group; the divider is aria-hidden", () => {
    const extra = (
      <>
        <span data-testid="pi-update-badge" />
        <button type="button" data-testid="connection-chip" />
      </>
    );
    renderList([mk()], { headerExtra: extra });
    const bar = screen.getByTestId("header-app-bar");
    const order = ids(bar);
    const pos = (id: string) => order.indexOf(id);
    expect(pos("discord-btn")).toBeGreaterThanOrEqual(0);
    expect(pos("discord-btn")).toBeLessThan(pos("theme-picker-trigger"));
    expect(pos("theme-picker-trigger")).toBeLessThan(pos("focus-toggle-btn"));
    expect(pos("focus-toggle-btn")).toBeLessThan(pos("pi-update-badge"));
    expect(pos("pi-update-badge")).toBeLessThan(pos("connection-chip"));
    expect(pos("connection-chip")).toBeLessThan(pos("settings-btn"));
    expect(order).not.toContain("question-pill");
    const divider = bar.querySelector('span[aria-hidden="true"].w-px');
    expect(divider).toBeTruthy();
    // the divider sits between Discord and Appearance
    const discord = screen.getByTestId("discord-btn");
    const picker = screen.getByTestId("theme-picker");
    expect(discord.compareDocumentPosition(divider as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect((divider as Node).compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("E2: row 1 holds no standalone ThemeToggle / TunnelButton / InstallButton; the header is a container-query root", () => {
    renderList([mk()]);
    const bar = screen.getByTestId("header-app-bar");
    for (const id of ["theme-toggle", "tunnel-btn", "install-btn"]) expect(bar.querySelector(`[data-testid="${id}"]`)).toBeNull();
    expect(bar.className).toContain("flex-wrap");
    expect(bar.parentElement?.className).toContain("@container");
  });
});

describe("header icon buttons (polish-sidebar-header-controls)", () => {
  it("E1: five header icon buttons share the 28 px recipe, an 18 px glyph and no palette colour class", () => {
    renderList([mk()]);
    for (const id of ["discord-btn", "theme-picker-trigger", "focus-toggle-btn", "settings-btn", "filter-funnel-btn"]) {
      const btn = screen.getByTestId(id);
      expect(btn.className, id).toContain("size-7");
      expect(btn.className, id).toContain("rounded-md");
      expect(btn.className, id).not.toMatch(/\b(text|bg)-(blue|red|green|gray)-\d/);
      const svg = btn.querySelector("svg") as SVGElement;
      expect(svg.style.width, id).toBe("1.125rem");
    }
  });
});

describe("scoped search", () => {
  const setup = (extra: Record<string, unknown> = {}) => {
    const a1 = mk({ cwd: "/w/dashboard", name: "Refactor auth" });
    const a2 = mk({ cwd: "/w/dashboard", name: "fix css" });
    const b1 = mk({ cwd: "/w/other", name: "auth flow" });
    const utils = renderList([a1, a2, b1], { pinnedDirectories: ["/w/dashboard", "/w/other"], ...extra });
    return { a1, a2, b1, ...utils };
  };

  it("E10: folder query AND session query compose through the one box; the inactive query shows as a chip", () => {
    const { a1, a2, b1, container } = setup();
    setSidebarSearch("folders", "dashboard");
    setSidebarSearch("sessions", "auth");
    expect(folderVisible("/w/dashboard")).toBe(true);
    expect(folderVisible("/w/other")).toBe(false);
    expect(sessionVisible(container, a1.id)).toBe(true);
    expect(sessionVisible(container, a2.id)).toBe(false);
    expect(sessionVisible(container, b1.id)).toBe(false);
    expect((screen.getByTestId("session-search-input") as HTMLInputElement).value).toBe("auth");
    expect(screen.getByTestId("search-chip-switch").textContent).toBe("dashboard");
  });

  it("E11: switching scope keeps the other query applied; testid and name follow the scope", () => {
    setup();
    setSidebarSearch("folders", "dashboard");
    expect(screen.getByTestId("workspace-filter-input").getAttribute("aria-label")).toBe("Filter folders by path");
    fireEvent.click(screen.getByTestId("search-scope-sessions"));
    const input = screen.getByTestId("session-search-input") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(input.getAttribute("aria-label")).toBe("Search sessions across folders");
    expect(folderVisible("/w/other")).toBe(false);
    expect(screen.getByTestId("search-scope-sessions").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("search-scope-folders").getAttribute("aria-pressed")).toBe("false");
  });

  it("E12a: the chip label switches scope, shows its query in the input and focuses it", () => {
    setup();
    setSidebarSearch("folders", "dashboard");
    setSidebarSearch("sessions", "auth");
    fireEvent.click(screen.getByTestId("search-chip-switch"));
    const input = screen.getByTestId("workspace-filter-input") as HTMLInputElement;
    expect(input.value).toBe("dashboard");
    expect(screen.getByTestId("search-chip-switch").textContent).toBe("auth");
    expect(document.activeElement).toBe(input);
  });

  it("E12b: the chip's clear button empties only its query, removes the chip and focuses the input", () => {
    const { a1, a2, container } = setup();
    setSidebarSearch("folders", "dashboard");
    setSidebarSearch("sessions", "auth");
    fireEvent.click(screen.getByTestId("search-chip-clear"));
    expect(screen.queryByTestId("search-chip")).toBeNull();
    expect((screen.getByTestId("session-search-input") as HTMLInputElement).value).toBe("auth");
    expect(sessionVisible(container, a1.id)).toBe(true);
    expect(sessionVisible(container, a2.id)).toBe(false);
    expect(folderVisible("/w/other")).toBe(true);
    expect(document.activeElement).toBe(screen.getByTestId("session-search-input"));
    // the chip is two sibling buttons, never nested
    cleanup();
    setup();
    setSidebarSearch("folders", "x");
    setSidebarSearch("sessions", "y");
    const chip = screen.getByTestId("search-chip");
    expect(within(chip).getAllByRole("button")).toHaveLength(2);
    expect(screen.getByTestId("search-chip-switch").querySelector("button")).toBeNull();
    expect(screen.getByTestId("search-chip-clear").getAttribute("aria-label")).toBe("Clear folder filter");
  });

  // NOTE (test-plan #E13a): the capability spec says session-only search shows pinned folders only,
  // but the shipped filtering code (untouched by this change, design D5) also lists unpinned alive
  // folders. Reported as a pre-existing spec/code gap; only the Folders-scope half is asserted here.
  it("E13: a folder query (scope Folders) brings an unpinned folder's matching sessions into the result", () => {
    const x = mk({ cwd: "/w/a", name: "auth x" });
    const y = mk({ cwd: "/w/b", name: "auth y" });
    const { container } = renderList([x, y], { pinnedDirectories: ["/w/a"] });
    setSidebarSearch("sessions", "auth");
    expect(sessionVisible(container, x.id)).toBe(true);
    setSidebarSearch("folders", "b");
    expect(sessionVisible(container, y.id)).toBe(true);
  });

  it("E14: a collapsed folder auto-expands while any query is non-empty and collapses again once both are empty", () => {
    const s = mk({ cwd: "/w/a", name: "x thing" });
    const { container } = renderList([s], { pinnedDirectories: ["/w/a"], collapsedGroups: ["/w/a"] });
    expect(sessionVisible(container, s.id)).toBe(false);
    setSidebarSearch("sessions", "x");
    expect(sessionVisible(container, s.id)).toBe(true);
    setSidebarSearch("sessions", "");
    expect(sessionVisible(container, s.id)).toBe(false);
    setSidebarSearch("folders", "/w/a");
    expect(sessionVisible(container, s.id)).toBe(true);
    fireEvent.click(screen.getByTestId("search-scope-sessions"));
    setSidebarSearch("sessions", "x");
    setSidebarSearch("sessions", "");
    expect(sessionVisible(container, s.id)).toBe(true);
    fireEvent.click(screen.getByTestId("search-scope-folders"));
    setSidebarSearch("folders", "");
    expect(sessionVisible(container, s.id)).toBe(false);
  });
});

describe("filter funnel", () => {
  it("E9: the badge counts Include archive and Show hidden only; tag filters never count", () => {
    renderList([mk({ tags: ["wip"] })]);
    const funnel = () => screen.getByTestId("filter-funnel-btn");
    expect(screen.queryByTestId("filter-funnel-badge")).toBeNull();
    expect(funnel().getAttribute("aria-label")).toBe("Filters, 0 on");
    openFilterFunnel();
    fireEvent.click(screen.getByTestId("search-include-archive"));
    expect(screen.getByTestId("filter-funnel-badge").textContent).toBe("1");
    expect(funnel().getAttribute("aria-label")).toBe("Filters, 1 on");
    fireEvent.click(screen.getByTestId("show-hidden-toggle"));
    expect(screen.getByTestId("filter-funnel-badge").textContent).toBe("2");
    expect(funnel().getAttribute("aria-label")).toBe("Filters, 2 on");
    fireEvent.click(screen.getByTestId("search-include-archive"));
    expect(funnel().getAttribute("aria-label")).toBe("Filters, 1 on");
  });

  it("E19: Show hidden in the funnel reveals hidden sessions", () => {
    const h = mk({ hidden: true });
    const { container } = renderList([h, mk()]);
    expect(sessionVisible(container, h.id)).toBe(false);
    openFilterFunnel();
    const toggle = screen.getByTestId("show-hidden-toggle");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(sessionVisible(container, h.id)).toBe(true);
  });

  it("F3: opening the funnel focuses Include archive", async () => {
    renderList([mk()]);
    fireEvent.click(screen.getByTestId("filter-funnel-btn"));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("search-include-archive")));
  });

  it("F2: Escape closes the funnel and focuses its button", async () => {
    renderList([mk()]);
    fireEvent.click(screen.getByTestId("filter-funnel-btn"));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("search-include-archive")));
    // Keyboard Escape from inside the panel: document handler closes, panel handler returns focus.
    act(() => { fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" }); });
    expect(screen.queryByTestId("filter-funnel-panel")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("filter-funnel-btn"));
  });

  it("E20: the filter row carries no pin-folder button", () => {
    renderList([mk()], { onPinDirectory: () => {}, onOpenPinDialog: () => {} });
    const row = screen.getByTestId("header-filter-bar");
    expect(row.querySelector('[data-testid="pin-dir-dialog-btn"]')).toBeNull();
    expect(row.textContent).not.toContain("Add folder");
  });
});
