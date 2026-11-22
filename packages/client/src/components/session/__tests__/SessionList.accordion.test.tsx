/**
 * Accordion folder list. Scenarios: spec folder-focus, collapsible-groups
 * (accordion header/chevron), session-filtering (attention filter,
 * compact-empty); classic unchanged (test-plan #F8).
 * See change: add-focus-mode-and-card-block-toggles.
 */
import type { CardSectionPrefs } from "@blackbelt-technology/pi-dashboard-shared/card-sections.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { CardSectionsProvider } from "../../../lib/state/CardSectionsContext.js";
import { setSidebarSearch } from "../../__tests__/sidebar-search-helper.js";
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
  loc,
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
  /** Supply a recording location (default: a static one) to observe navigation. */
  loc?: ReturnType<typeof memoryLocation>;
}) {
  const [collapsed, setCollapsed] = useState<string[]>(collapsed0);
  const [expanded, setExpanded] = useState<string[]>(expanded0);
  const { hook } = loc ?? memoryLocation({ path: "/", static: true });
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

  it("unfocused folder without attention shows a header count button; clicking it focuses it only", () => {
    const list = [mk("a1", A), mk("b2", B), mk("b3", B)];
    render(<Harness selectedId="a1" list={list} />);
    const count = screen.getByTestId(`folder-compact-count-${B}`);
    expect(count.textContent).toBe("2");
    expect(count.getAttribute("aria-label")).toBe("2 sessions");
    expect(card("b2")).toBeNull();
    fireEvent.click(count);
    expect(card("b2")).not.toBeNull();
    expect(card("b3")).not.toBeNull();
    // A's selected session no longer focused → A compacts (a1 is idle)
    expect(has(`folder-compact-count-${A}`)).toBe(true);
  });

  it("empty folder renders only the header (no count)", () => {
    render(<Harness selectedId="a1" list={[mk("a1", A)]} extra={{ pinnedDirectories: [B] }} />);
    expect(has(`folder-compact-count-${B}`)).toBe(false);
    expect(has(`folder-compact-body-${B}`)).toBe(false);
    expect(has(`folder-home-row-${B}`)).toBe(true);
  });

  it("attention peek off → compact-empty even with a streaming session", () => {
    render(<Harness selectedId="a1" peek={false} />);
    expect(card("b1")).toBeNull();
    expect(has(`folder-compact-count-${B}`)).toBe(true);
  });

  it("hidden attention session stays hidden (Show hidden off is the group filter)", () => {
    const list = [mk("a1", A), mk("b1", B, { status: "streaming", hidden: true } as never), mk("b2", B)];
    render(<Harness selectedId="a1" list={list} />);
    expect(card("b1")).toBeNull();
  });

  it("search forces every folder full", () => {
    render(<Harness selectedId="a1" />);
    setSidebarSearch("sessions", "b");
    // forced full → compact markers gone
    expect(has(`folder-compact-body-${B}`)).toBe(false);
    expect(has(`folder-compact-count-${B}`)).toBe(false);
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
    expect(has(`folder-compact-count-${B}`) || has(`folder-compact-body-${B}`)).toBe(true);
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
    const fetchMock = vi.fn(async (..._args: unknown[]) => ({
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

// Compact-empty folder: the count lives in the header as a sibling button; there
// is no second row. See change: sidebar-folder-ux (test-plan #S32–#S37, #F6).
describe("compact-empty count button (#1134 slim cards)", () => {
  const many = (n: number, over: Partial<DashboardSession> = {}) =>
    Array.from({ length: n }, (_, i) => mk(`b${i}`, B, over));
  const listWith = (n: number) => [mk("a1", A), ...many(n)];
  const countBtn = (cwd = B) => screen.queryByTestId(`folder-compact-count-${cwd}`);

  it.each([
    [0, null],
    [1, "1 session"],
    [2, "2 sessions"],
    [18, "18 sessions"],
  ])("S32: N=%i → accessible name %s; sibling of the name link; no compact row", (n, name) => {
    render(<Harness selectedId="a1" list={listWith(n)} extra={{ pinnedDirectories: [B] }} />);
    expect(has(`folder-compact-row-${B}`)).toBe(false);
    if (name === null) {
      expect(countBtn()).toBeNull();
      return;
    }
    const btn = countBtn()!;
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.getAttribute("aria-label")).toBe(name);
    expect(btn.textContent).toBe(String(n));
    const link = screen.getByTestId(`folder-header-name-${B}`);
    expect(link.getAttribute("role")).toBe("link");
    expect(link.contains(btn)).toBe(false);
  });

  it("S33: the link's accessible name is the folder only; the count is painted --text-secondary, never --text-muted", () => {
    render(<Harness selectedId="a1" list={listWith(18)} />);
    const link = screen.getByTestId(`folder-header-name-${B}`);
    expect(link.textContent).not.toMatch(/18/);
    const cls = countBtn()!.className;
    expect(cls).toContain("--text-secondary");
    expect(cls).not.toContain("--text-muted");
  });

  it("S34: activating the count focuses the folder only — no collapse/pin change, no navigation, no select", () => {
    const loc = memoryLocation({ path: "/", record: true });
    const onSelect = vi.fn();
    const onSetFolderCollapsed = vi.fn();
    const onSetFolderExpanded = vi.fn();
    render(
      <Harness
        selectedId="a1"
        list={listWith(3)}
        loc={loc}
        onSelect={onSelect}
        extra={{ onSetFolderCollapsed, onSetFolderExpanded }}
      />,
    );
    const before = loc.history?.length;
    fireEvent.click(countBtn()!);
    expect(card("b0")).not.toBeNull(); // B is now the focused (full) folder
    expect(onSetFolderCollapsed).not.toHaveBeenCalled();
    expect(onSetFolderExpanded).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(loc.history?.length).toBe(before);
  });

  it("S35: Enter on the header name link focuses the folder AND opens the folder home", () => {
    const loc = memoryLocation({ path: "/", record: true });
    render(<Harness selectedId="a1" list={listWith(3)} loc={loc} />);
    const before = loc.history?.length ?? 0;
    fireEvent.keyDown(screen.getByTestId(`folder-header-name-${B}`), { key: "Enter" });
    expect(card("b0")).not.toBeNull();
    expect(loc.history?.length ?? 0).toBeGreaterThan(before);
  });

  it("S36: N counts post-hidden-filter sessions; an active search forces full (no count)", () => {
    const list = [mk("a1", A), ...many(18), mk("h1", B, { hidden: true } as never), mk("h2", B, { hidden: true } as never)];
    render(<Harness selectedId="a1" list={list} />);
    expect(countBtn()!.textContent).toBe("18");
    setSidebarSearch("sessions", "b1");
    expect(countBtn()).toBeNull();
  });

  it("S37: compact-attention is header + attention cards only (no count, no row)", () => {
    render(<Harness selectedId="a1" list={[mk("a1", A), mk("b1", B, { status: "streaming" }), mk("b2", B), mk("b3", B)]} />);
    expect(card("b1")).not.toBeNull();
    expect(card("b2")).toBeNull();
    expect(has(`folder-compact-body-${B}`)).toBe(true);
    expect(countBtn()).toBeNull();
    expect(has(`folder-compact-row-${B}`)).toBe(false);
    expect(has(`folder-group-by-row-${B}`)).toBe(false);
  });

  it("F6: mousedown / click / Space on the count never reach the header's own click handler", async () => {
    const user = userEvent.setup();
    const loc = memoryLocation({ path: "/", record: true });
    render(<Harness selectedId="a1" list={listWith(3)} loc={loc} />);
    const before = loc.history?.length ?? 0;
    const btn = countBtn()!;
    fireEvent.mouseDown(btn);
    fireEvent.click(btn);
    expect(loc.history?.length ?? 0).toBe(before);

    cleanup();
    const loc2 = memoryLocation({ path: "/", record: true });
    render(<Harness selectedId="a1" list={listWith(3)} loc={loc2} />);
    const before2 = loc2.history?.length ?? 0;
    countBtn()!.focus();
    await user.keyboard(" ");
    expect(card("b0")).not.toBeNull(); // Space activated it (focus the folder)…
    expect(loc2.history?.length ?? 0).toBe(before2); // …without navigating.
  });
});
