/**
 * Sidebar pill colour roles — the four SessionList sites of
 * fix-folder-card-pill-contrast (test-plan #E19 ToggleButton / include-archive,
 * add-to-workspace node, pinned indicator).
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { SessionList } from "../session/SessionList.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";

const CWD = "/home/user/project";

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
  const store: Record<string, string> = {};
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, val: string) => { store[key] = val; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const k in store) delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  });
});
afterEach(() => cleanup());

const session: DashboardSession = {
  id: "s1", cwd: CWD, source: "tui", status: "active",
  startedAt: Date.now() - 60000, tokensIn: 0, tokensOut: 0, cost: 0,
};

function renderList(extra: Partial<React.ComponentProps<typeof SessionList>> = {}) {
  return render(
    <TestRouter>
      <ThemeProvider>
        <SessionList sessions={[session]} onSelect={() => {}} {...extra} />
      </ThemeProvider>
    </TestRouter>,
  );
}

const PRESSED = ["text-[var(--text-primary)]", "bg-[var(--accent-soft)]", "border-[var(--accent)]"];

describe("SessionList pill colour roles", () => {
  it("include-archive chip: unpressed --text-secondary, pressed = selected-chip recipe, 12px", () => {
    renderList();
    const chip = screen.getByTestId("search-include-archive");
    expect(chip.className).toContain("text-[var(--text-secondary)]");
    expect(chip.className).toContain("text-[12px]");
    fireEvent.click(chip);
    const on = screen.getByTestId("search-include-archive");
    for (const c of PRESSED) expect(on.className).toContain(c);
    expect(on.className).not.toMatch(/-(blue)-\d{3}/);
    expect(on.className).not.toContain("--text-tertiary");
  });

  it("Hidden ToggleButton: same recipe on then off", () => {
    renderList();
    const btn = screen.getByText("Hidden").closest("button") as HTMLElement;
    expect(btn.className).toContain("text-[var(--text-secondary)]");
    expect(btn.className).toContain("text-[12px]");
    fireEvent.click(btn);
    const on = screen.getByText("Hidden").closest("button") as HTMLElement;
    for (const c of PRESSED) expect(on.className).toContain(c);
    fireEvent.click(on);
    const off = screen.getByText("Hidden").closest("button") as HTMLElement;
    expect(off.className).toContain("text-[var(--text-secondary)]");
    expect(off.className).not.toContain("bg-[var(--accent-soft)]");
  });

  it("add-to-workspace node is neutral: --text-primary label, --border-secondary, no hue", () => {
    renderList({
      workspaces: [{ id: "ws1", name: "WS", folders: [], collapsed: false }],
      onAddFolderToWorkspace: () => {},
    });
    fireEvent.click(screen.getByTestId(`folder-actions-menu-${CWD}`));
    const btn = screen.getByTestId(`add-to-workspace-btn-${CWD}`);
    expect(btn.className).toContain("text-[var(--text-primary)]");
    expect(btn.className).toContain("border-[var(--border-secondary)]");
    expect(btn.className).not.toMatch(/-(blue|red|amber|green)-\d{3}/);
  });

  it("pinned indicator paints --accent-yellow-text", () => {
    renderList({ pinnedDirectories: [CWD], onUnpinDirectory: () => {} });
    const ind = screen.getByTestId(`folder-pinned-indicator-${CWD}`);
    expect(ind.className).toContain("text-[var(--accent-yellow-text)]");
    expect(ind.className).not.toContain("text-yellow-400");
  });
});
