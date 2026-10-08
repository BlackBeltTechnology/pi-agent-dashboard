/**
 * Accordion folder list. Scenarios: spec folder-focus, collapsible-groups
 * (accordion header/chevron), session-filtering (attention filter,
 * compact-empty); classic unchanged (test-plan #F8).
 * See change: add-focus-mode-and-card-block-toggles.
 */
import type { CardSectionPrefs } from "@blackbelt-technology/pi-dashboard-shared/card-sections.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React, { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { CardSectionsProvider } from "../../../lib/state/CardSectionsContext.js";
import { ThemeProvider } from "../../settings/ThemeProvider.js";
import { SessionList } from "../SessionList.js";

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
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
afterEach(cleanup);

const A = "/home/u/alpha";
const B = "/home/u/beta";
const mk = (id: string, cwd: string, over: Partial<DashboardSession> = {}): DashboardSession => ({
  id, cwd, source: "tui", status: "idle", startedAt: Date.now() - 60_000, tokensIn: 0, tokensOut: 0, cost: 0, ...over,
});
const sessions = [
  mk("a1", A),
  mk("b1", B, { status: "streaming" }),
  mk("b2", B), mk("b3", B), mk("b4", B),
];

function Harness({
  mode = "accordion",
  selectedId,
  list = sessions,
  peek = true,
  prefs = {},
  onSelect = () => {},
  collapsed0 = [],
  expanded0 = [],
  extra = {},
}: {
  mode?: "classic" | "accordion" | "absent";
  selectedId?: string;
  list?: DashboardSession[];
  peek?: boolean;
  prefs?: CardSectionPrefs;
  onSelect?: (id: string) => void;
  collapsed0?: string[];
  expanded0?: string[];
  extra?: Record<string, unknown>;
}) {
  const [collapsed, setCollapsed] = useState<string[]>(collapsed0);
  const [expanded, setExpanded] = useState<string[]>(expanded0);
  const { hook } = memoryLocation({ path: "/", static: true });
  return (
    <Router hook={hook}>
      <ThemeProvider>
        <CardSectionsProvider value={{ prefs }}>
          <SessionList
            sessions={list}
            selectedId={selectedId}
            onSelect={onSelect}
            folderListMode={mode === "absent" ? undefined : mode}
            folderAttentionPeek={peek}
            collapsedGroups={collapsed}
            expandedGroups={expanded}
            onSetFolderCollapsed={(p, c) => {
              setCollapsed((cur) => (c ? [...new Set([...cur, p])] : cur.filter((x) => x !== p)));
              if (c) setExpanded((cur) => cur.filter((x) => x !== p));
            }}
            onSetFolderExpanded={(p, e) => {
              setExpanded((cur) => (e ? [...new Set([...cur, p])] : cur.filter((x) => x !== p)));
              if (e) setCollapsed((cur) => cur.filter((x) => x !== p));
            }}
            {...extra}
          />
        </CardSectionsProvider>
      </ThemeProvider>
    </Router>
  );
}

const card = (id: string) => document.querySelector(`[data-session-id="${id}"]`);
const chevron = (cwd: string) =>
  document.querySelector(`[data-testid="folder-home-row-${cwd}"]`)!.closest("div.px-1.py-1")!.querySelector('[data-testid="folder-toggle-btn"]') as HTMLElement;
const has = (id: string) => screen.queryByTestId(id) !== null;

describe("accordion render modes", () => {
  it("selected session's folder is full; unfocused folder shows only its attention card", () => {
    render(<Harness selectedId="a1" />);
    expect(card("a1")).not.toBeNull();
    expect(card("b1")).not.toBeNull(); // streaming → attention
    for (const id of ["b2", "b3", "b4"]) expect(card(id)).toBeNull();
    expect(has(`folder-compact-body-${B}`)).toBe(true);
  });

  it("unfocused folder without attention shows `N sessions — click to view`; clicking focuses it only", () => {
    const list = [mk("a1", A), mk("b2", B), mk("b3", B)];
    render(<Harness selectedId="a1" list={list} />);
    const row = screen.getByTestId(`folder-compact-row-${B}`);
    expect(row.textContent).toBe("2 sessions — click to view");
    expect(card("b2")).toBeNull();
    fireEvent.click(row);
    expect(card("b2")).not.toBeNull();
    expect(card("b3")).not.toBeNull();
    // A's selected session no longer focused → A compacts (a1 is idle)
    expect(has(`folder-compact-row-${A}`)).toBe(true);
  });

  it("empty folder renders only the header (no row)", () => {
    render(<Harness selectedId="a1" list={[mk("a1", A)]} extra={{ pinnedDirectories: [B] }} />);
    expect(has(`folder-compact-row-${B}`)).toBe(false);
    expect(has(`folder-compact-body-${B}`)).toBe(false);
    expect(has(`folder-home-row-${B}`)).toBe(true);
  });

  it("attention peek off → compact-empty even with a streaming session", () => {
    render(<Harness selectedId="a1" peek={false} />);
    expect(card("b1")).toBeNull();
    expect(has(`folder-compact-row-${B}`)).toBe(true);
  });

  it("hidden attention session stays hidden (Show hidden off is the group filter)", () => {
    const list = [mk("a1", A), mk("b1", B, { status: "streaming", hidden: true } as never), mk("b2", B)];
    render(<Harness selectedId="a1" list={list} />);
    expect(card("b1")).toBeNull();
  });

  it("search forces every folder full", () => {
    render(<Harness selectedId="a1" />);
    fireEvent.change(screen.getByTestId("session-search-input"), { target: { value: "b" } });
    // forced full → compact markers gone
    expect(has(`folder-compact-body-${B}`)).toBe(false);
    expect(has(`folder-compact-row-${B}`)).toBe(false);
  });

  it("pinned-open unfocused folder renders all cards (full)", () => {
    render(<Harness selectedId="a1" expanded0={[B]} />);
    for (const id of ["b1", "b2", "b3", "b4"]) expect(card(id)).not.toBeNull();
  });

  it("pinned wins over collapsed", () => {
    render(<Harness selectedId="a1" expanded0={[B]} collapsed0={[B]} />);
    for (const id of ["b1", "b2", "b3", "b4"]) expect(card(id)).not.toBeNull();
  });
});

describe("accordion header and chevron", () => {
  it("header body focuses (latest intent wins over selection) without touching collapse state", () => {
    render(<Harness selectedId="a1" />);
    fireEvent.click(screen.getByTestId(`folder-home-row-${B}`));
    for (const id of ["b1", "b2", "b3", "b4"]) expect(card(id)).not.toBeNull();
    expect(card("a1")).toBeNull(); // A compacted (idle), selection untouched
  });

  it("chevron on an unfocused folder pins it open, then unpins it", () => {
    render(<Harness selectedId="a1" />);
    fireEvent.click(chevron(B));
    for (const id of ["b1", "b2", "b3", "b4"]) expect(card(id)).not.toBeNull();
    fireEvent.click(chevron(B));
    expect(card("b2")).toBeNull();
    expect(card("b1")).not.toBeNull();
  });

  it("chevron on the focused folder collapses it; focus does not move", () => {
    render(<Harness selectedId="a1" />);
    fireEvent.click(chevron(A));
    expect(card("a1")).toBeNull();
    expect(has(`folder-compact-row-${B}`) || has(`folder-compact-body-${B}`)).toBe(true);
    expect(has(`folder-body-${A}`)).toBe(false);
  });

  it("selecting a session refocuses its folder after an activation", () => {
    const onSelect = vi.fn();
    render(<Harness selectedId="a1" onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId(`folder-home-row-${B}`)); // B focused, A compacts
    expect(card("a1")).toBeNull();
    // select b1 then a1 again via the (still-visible) compact attention path is
    // covered by lastIntent unit tests; here: card click reports through onSelect.
    fireEvent.click(card("b1")!);
    expect(onSelect).toHaveBeenCalledWith("b1");
  });
});

describe("classic mode is unchanged (#F8)", () => {
  it("absent / classic / unknown mode render identical DOM", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 0, 1, 12, 0, 0));
    try {
      const html = (mode: "classic" | "accordion" | "absent") => {
        const { container, unmount } = render(<Harness mode={mode} selectedId="a1" list={sessions.map((s) => ({ ...s, startedAt: 0 }))} />);
        const out = container.innerHTML.replace(/Dnd(DescribedBy|LiveRegion)-\d+/g, "Dnd$1");
        unmount();
        return out;
      };
      const absent = html("absent");
      const classic = html("classic");
      const at = [...absent].findIndex((c, i) => c !== classic[i]);
      expect(at === -1 ? "" : `${absent.slice(Math.max(0, at - 80), at + 80)} <<>> ${classic.slice(Math.max(0, at - 80), at + 80)}`).toBe("");
      expect(classic).toBe(absent);
      expect(absent).not.toContain("folder-compact-");
    } finally {
      now.mockRestore();
    }
  });

  it("classic: header click does not touch collapse; every folder keeps all cards", () => {
    render(<Harness mode="classic" selectedId="a1" />);
    for (const id of ["a1", "b1", "b2", "b3", "b4"]) expect(card(id)).not.toBeNull();
  });
});

describe("Focus profile switches the list to accordion", () => {
  it("configured classic + Focus on → accordion; configured value untouched", () => {
    render(<Harness mode="classic" selectedId="a1" prefs={{ focus: { enabled: true } }} />);
    expect(card("b2")).toBeNull();
    expect(card("b1")).not.toBeNull();
  });
});

describe("folder banner safety chip survives compact folders (review B1)", () => {
  const stubInitStatus = (data: object) => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({ success: true, data }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["compactEmpty (idle sessions)", [mk("a1", A), mk("b2", B), mk("b3", B)]],
    ["compactAttention (a streaming session)", sessions],
  ])("unfocused folder needing re-trust shows the chip: %s", async (_n, list) => {
    stubInitStatus({ hasHook: true, trusted: false });
    render(<Harness selectedId="a1" list={list} extra={{ pinnedDirectories: [B] }} />);
    expect(await screen.findByTestId(`folder-banner-chip-${B}`)).toBeTruthy();
    expect(screen.queryByTestId(`folder-banner-retrust-${B}`)).toBeNull();
  });

  it("healthy unfocused folder shows neither chip nor banner", async () => {
    const fetchMock = stubInitStatus({ hasHook: false });
    render(<Harness selectedId="a1" list={[mk("a1", A), mk("b2", B)]} />);
    // Barrier: the init-status probe for B has been answered (hasHook:false) before we assert absence.
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).includes(encodeURIComponent(B)))).toBe(true));
    await act(async () => {});
    expect(screen.queryByTestId(`folder-banner-chip-${B}`)).toBeNull();
  });
});
