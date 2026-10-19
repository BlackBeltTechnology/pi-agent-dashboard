/**
 * Session-card section visibility gating (desktop + mobile), the PROCESS
 * safety chip, and the session actions menu's VIEW group (which replaced the
 * per-subcard legend options menu).
 * See changes: configurable-session-card-sections, add-session-actions-flyout.
 */
import { createSlotRegistry, PluginContextProvider } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { CardSectionPrefs } from "@blackbelt-technology/pi-dashboard-shared/card-sections.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type CardSectionsContextValue,
  CardSectionsProvider,
  useCardSectionVisible,
} from "../../lib/state/CardSectionsContext.js";
import { SessionCard } from "../session/SessionCard.js";

vi.mock("../../hooks/useMobile.js", () => ({ useMobile: vi.fn(() => false) }));

afterEach(async () => {
  cleanup();
  const { useMobile } = await import("../../hooks/useMobile.js");
  (useMobile as ReturnType<typeof vi.fn>).mockReturnValue(false);
  window.history.replaceState(null, "", "/");
});

const CWD = "/repo";

function makeSession(overrides: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id: "s1",
    cwd: CWD,
    source: "tui",
    status: "active",
    startedAt: Date.now() - 60000,
    tokensIn: 0,
    tokensOut: 0,
    cost: 0,
    gitBranch: "main",
    tags: ["ui"],
    // An UNATTACHED READY session renders no OPENSPEC subcard any more, so the
    // default fixture is attached to keep that section under test.
    attachedProposal: "feat-a",
    ...overrides,
  };
}

function fullRegistry() {
  const registry = createSlotRegistry();
  const claim = (slot: string, testId: string) =>
    registry.addClaim({ pluginId: testId, priority: 100, slot: slot as never, Component: () => <span data-testid={testId}>x</span> });
  claim("session-card-badge", "status-claim");
  claim("session-card-flows", "flows-claim");
  claim("session-card-memory", "memory-claim");
  claim("worktree-card-section", "kb-claim");
  return registry;
}

const PROC = { pid: 1, pgid: 1, command: "vitest --watch", elapsedMs: 60_000 } as never;

function renderCard(
  prefs: CardSectionPrefs | undefined,
  opts: { session?: Partial<DashboardSession>; processes?: unknown[]; ctx?: Partial<CardSectionsContextValue> } = {},
) {
  const onSelect = vi.fn();
  const card = (
    <PluginContextProvider registry={fullRegistry()}>
      <SessionCard
        session={makeSession(opts.session)}
        selectedId={undefined}
        onSelect={onSelect}
        now={Date.now()}
        showGitInfo
        isHidden={false}
        onArchive={() => {}}
        openspecChanges={[]}
        openspecHasDir
        onSendPrompt={() => {}}
        onAttachProposal={() => {}}
        onDetachProposal={() => {}}
        onSpawnSibling={() => {}}
        onSpawnWorktree={() => {}}
        processes={(opts.processes ?? []) as never}
        onKillProcess={() => {}}
      />
    </PluginContextProvider>
  );
  const utils = render(
    prefs === undefined ? card : <CardSectionsProvider value={{ prefs, ...opts.ctx }}>{card}</CardSectionsProvider>,
  );
  return { ...utils, onSelect };
}

const hasTitle = (t: string) => screen.queryAllByText(t, { selector: "span" }).length > 0;
// The GIT subcard is gone: the `git` section now governs the header git row.
// See change: compact-session-card-header.
const hasGitRow = () => screen.queryByTestId("session-card-git-row") !== null;

describe("useCardSectionVisible", () => {
  it("resolves from the provider snapshot and updates when the snapshot changes", () => {
    let prefs: CardSectionPrefs = {};
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CardSectionsProvider value={{ prefs }}>{children}</CardSectionsProvider>
    );
    const { result, rerender } = renderHook(() => useCardSectionVisible({ cwd: CWD }, "git"), { wrapper });
    expect(result.current).toBe(true);
    prefs = { folders: { [CWD]: { git: false } } };
    rerender();
    expect(result.current).toBe(false);
  });

  it("defaults to visible without a provider", () => {
    const { result } = renderHook(() => useCardSectionVisible({ cwd: CWD }, "git"));
    expect(result.current).toBe(true);
  });
});

describe("SessionCard desktop gating", () => {
  it("no prefs → identical render to no provider", () => {
    // Pin the clock: makeSession/renderCard read Date.now() per render, so two
    // renders straddling a second boundary differ in the "Started …" title.
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 0, 1, 12, 0, 0));
    try {
      const a = renderCard(undefined).container.innerHTML;
      cleanup();
      const b = renderCard({}).container.innerHTML;
      expect(b).toBe(a);
    } finally {
      now.mockRestore();
    }
  });

  it("renders every section with no prefs", () => {
    renderCard({}, { session: { gitWorktree: { mainPath: CWD, name: "wt" } as never, cwd: `${CWD}/.worktrees/wt` }, processes: [PROC] });
    for (const t of ["OPENSPEC", "STATUS", "PROCESS", "FLOWS", "MEMORY"]) expect(hasTitle(t)).toBe(true);
    expect(hasTitle("GIT")).toBe(false);
    expect(screen.queryByTestId("kb-claim")).not.toBeNull();
    expect(screen.queryByText("#ui")).not.toBeNull();
    // The spawn actions are session-menu items.
    fireEvent.click(screen.getByTestId("session-actions-trigger-s1"));
    expect(screen.queryByTestId("session-card-spawn-sibling")).not.toBeNull();
  });

  it.each([
    ["openspec", () => hasTitle("OPENSPEC")],
    ["git", () => hasGitRow()],
    ["status", () => hasTitle("STATUS")],
    ["flows", () => hasTitle("FLOWS")],
    ["memory", () => hasTitle("MEMORY")],
    ["tags", () => screen.queryByText("#ui") !== null],
    ["spawn", () => {
      fireEvent.click(screen.getByTestId("session-actions-trigger-s1"));
      return screen.queryByTestId("session-card-spawn-sibling") !== null || screen.queryByTestId("session-card-spawn-worktree") !== null;
    }],
  ])("folder hide of %s removes it", (id, present) => {
    renderCard({ folders: { [CWD]: { [id]: false } } });
    expect(present()).toBe(false);
  });

  // See change: fix-slot-pill-legend-and-stale-overflow (test-plan #E14).
  it("worktree card-slot wrapper is spaced mt-2.5 flex flex-col gap-2.5; non-worktree has none", () => {
    renderCard({}, { session: { gitWorktree: { mainPath: CWD, name: "wt" } as never, cwd: `${CWD}/.worktrees/wt` } });
    const wrapper = screen.getByTestId("worktree-card-section-gap");
    const tokens = wrapper.className.split(/\s+/);
    for (const t of ["mt-2.5", "flex", "flex-col", "gap-2.5"]) expect(tokens).toContain(t);
    expect(tokens).not.toContain("mt-1.5");
    cleanup();
    renderCard({});
    expect(screen.queryByTestId("worktree-card-section-gap")).toBeNull();
  });

  it("hides kb for a worktree session via its main folder", () => {
    renderCard(
      { folders: { [CWD]: { kb: false, openspec: false } } },
      { session: { cwd: `${CWD}/.worktrees/feat`, gitWorktree: { mainPath: CWD, name: "feat" } as never } },
    );
    expect(screen.queryByTestId("kb-claim")).toBeNull();
    expect(hasTitle("OPENSPEC")).toBe(false);
  });

  it("global hide applies; folder override beats global", () => {
    renderCard({ global: { flows: false, git: false }, folders: { [CWD]: { git: true } } });
    expect(hasTitle("FLOWS")).toBe(false);
    expect(hasGitRow()).toBe(true);
  });

  it("does not affect another folder", () => {
    renderCard({ folders: { "/other": { git: false } } });
    expect(hasGitRow()).toBe(true);
  });
});

describe("OpenSpec activity badge follows the openspec section", () => {
  const withChange = { openspecChange: "feat-xyz" } as Partial<DashboardSession>;

  it("desktop: shown by default, hidden with openspec", () => {
    renderCard({}, { session: withChange });
    expect(screen.queryByText(/feat-xyz/)).not.toBeNull();
    cleanup();
    renderCard({ folders: { [CWD]: { openspec: false } } }, { session: withChange });
    expect(screen.queryByText(/feat-xyz/)).toBeNull();
  });

  it("mobile: hidden with openspec, including the attached-proposal chip", async () => {
    const { useMobile } = await import("../../hooks/useMobile.js");
    (useMobile as ReturnType<typeof vi.fn>).mockReturnValue(true);
    renderCard({ folders: { [CWD]: { openspec: false } } }, { session: { ...withChange, attachedProposal: "feat-xyz" } });
    expect(screen.queryByText(/feat-xyz/)).toBeNull();
    expect(screen.queryByTestId("mobile-card-attached-chip")).toBeNull();
  });
});

describe("OpenSpec phase shown once (add-focus-mode-and-card-block-toggles #E14)", () => {
  const phased = { openspecPhase: "apply", openspecChange: "feat-xyz" } as Partial<DashboardSession>;
  const badgeCount = () => screen.queryAllByText("Applying").length;
  const rawChipCount = () => screen.queryAllByText("apply").length;

  it.each([false, true])("desktop/mobile=%s: phase exactly once with badge on, tags strip has only user tags", async (mobile) => {
    const { useMobile } = await import("../../hooks/useMobile.js");
    (useMobile as ReturnType<typeof vi.fn>).mockReturnValue(mobile);
    renderCard({}, { session: { ...phased, tags: [] } });
    expect(badgeCount()).toBe(1);
    expect(rawChipCount()).toBe(0);
    cleanup();
    renderCard({}, { session: { ...phased, tags: ["x"] } });
    expect(badgeCount()).toBe(1);
    expect(rawChipCount()).toBe(0);
    expect(screen.queryByText("#x")).not.toBeNull();
  });

  it("badge off → zero phase mentions even with openspec + tags visible", () => {
    renderCard({ global: { "openspec-badge": false } }, { session: { ...phased, tags: ["x"] } });
    expect(badgeCount()).toBe(0);
    expect(rawChipCount()).toBe(0);
    expect(screen.queryByText("#x")).not.toBeNull();
    expect(hasTitle("OPENSPEC")).toBe(true);
  });

  it("openspec off, openspec-badge on → badge line without the subcard", () => {
    renderCard({ global: { openspec: false, "openspec-badge": true } }, { session: phased });
    expect(screen.queryByText(/feat-xyz/)).not.toBeNull();
    expect(hasTitle("OPENSPEC")).toBe(false);
  });
});

describe("per-plugin badge / action-bar switches (#E15)", () => {
  it("hiding the only badge plugin removes the STATUS frame; others unaffected", () => {
    renderCard({ global: { "badge-status-claim": false } });
    expect(hasTitle("STATUS")).toBe(false);
    expect(screen.queryByTestId("status-claim")).toBeNull();
    expect(hasTitle("FLOWS")).toBe(true);
  });
  it("legacy status parent still hides every badge", () => {
    renderCard({ global: { status: false } });
    expect(hasTitle("STATUS")).toBe(false);
  });
});

describe("PROCESS safety chip", () => {
  it("hidden PROCESS + 1 background process → chip, no subcard", () => {
    renderCard({ folders: { [CWD]: { process: false } } }, { processes: [PROC] });
    expect(hasTitle("PROCESS")).toBe(false);
    expect(screen.getByTestId("process-safety-chip").textContent).toMatch(/1 background process/);
  });

  it("hidden PROCESS + nothing running → no chip", () => {
    renderCard({ folders: { [CWD]: { process: false } } });
    expect(screen.queryByTestId("process-safety-chip")).toBeNull();
  });

  it("visible PROCESS → no chip (the subcard carries the warning)", () => {
    renderCard({}, { processes: [PROC] });
    expect(screen.queryByTestId("process-safety-chip")).toBeNull();
  });

  it("activating the chip opens the process list without selecting the card", () => {
    const { onSelect } = renderCard({ folders: { [CWD]: { process: false } } }, { processes: [PROC] });
    fireEvent.click(screen.getByTestId("process-safety-chip"));
    expect(screen.getByTestId("process-safety-sheet").textContent).toContain("vitest --watch");
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("SessionCard mobile gating", () => {
  async function mobile() {
    const { useMobile } = await import("../../hooks/useMobile.js");
    (useMobile as ReturnType<typeof vi.fn>).mockReturnValue(true);
  }

  it("omits hidden tags and process rows", async () => {
    await mobile();
    const bash = { toolCallId: "t", command: "npm test", startedAt: Date.now() };
    render(
      <CardSectionsProvider value={{ prefs: { folders: { [CWD]: { tags: false, process: false } } } }}>
        <SessionCard
          session={makeSession()}
          selectedId={undefined}
          onSelect={() => {}}
          now={Date.now()}
          showGitInfo={false}
          isHidden={false}
          onArchive={() => {}}
          inflightBashTools={[bash]}
          onAbortTool={() => {}}
        />
      </CardSectionsProvider>,
    );
    expect(screen.queryByText("#ui")).toBeNull();
    expect(screen.queryByTestId("session-activity-bar")).toBeNull();
  });

  it("renders tags + process rows with no prefs", async () => {
    await mobile();
    const bash = { toolCallId: "t", command: "npm test", startedAt: Date.now() };
    render(
      <CardSectionsProvider value={{ prefs: {} }}>
        <SessionCard session={makeSession()} selectedId={undefined} onSelect={() => {}} now={Date.now()} showGitInfo={false} isHidden={false} onArchive={() => {}} inflightBashTools={[bash]} onAbortTool={() => {}} />
      </CardSectionsProvider>,
    );
    expect(screen.queryByText("#ui")).not.toBeNull();
    expect(screen.queryByTestId("session-activity-bar")).not.toBeNull();
  });

  it("safety chip applies on mobile", async () => {
    await mobile();
    renderCard({ folders: { [CWD]: { process: false } } }, { processes: [PROC] });
    expect(screen.queryByTestId("background-drawer-chip")).toBeNull();
    expect(screen.getByTestId("process-safety-chip")).toBeTruthy();
  });
});

describe("session actions menu VIEW group (replaces the legend options menu)", () => {
  function setup(session: Partial<DashboardSession> = {}) {
    const utils = renderCard({}, { session });
    fireEvent.click(screen.getByTestId("session-actions-trigger-s1"));
    return utils;
  }

  it("no subcard legend carries an options button any more", () => {
    renderCard({}, { processes: [PROC] });
    expect(screen.queryByTestId("subcard-menu-git")).toBeNull();
    // capsule text stays exactly the title
    const title = screen.getAllByText("PROCESS", { selector: "span" })[0];
    expect(title.textContent).toBe("PROCESS");
  });

  it("Card sections… opens the folder's Session cards page without selecting the card", () => {
    const { onSelect } = setup();
    fireEvent.click(screen.getByTestId("session-menu-item-card-sections"));
    expect(window.location.pathname).toMatch(/^\/folder\/[^/]+\/settings\/cards$/);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("Card sections… for a worktree session targets the main folder", () => {
    setup({ cwd: `${CWD}/.worktrees/x`, gitWorktree: { mainPath: CWD, name: "x" } as never });
    fireEvent.click(screen.getByTestId("session-menu-item-card-sections"));
    // the folder segment is the base64url-encoded main path, not the worktree cwd
    const folder = window.location.pathname.split("/")[2];
    expect(atob(folder.replace(/-/g, "+").replace(/_/g, "/"))).toBe(CWD);
  });

  it("Card section defaults… opens the global Session cards defaults in Settings", () => {
    setup();
    fireEvent.click(screen.getByTestId("session-menu-item-card-defaults"));
    expect(window.location.pathname).toBe("/settings/general");
  });

  it("hiding `openspec` / `git` card sections keeps their menu groups", () => {
    renderCard({ folders: { [CWD]: { openspec: false, git: false } } });
    fireEvent.click(screen.getByTestId("session-actions-trigger-s1"));
    expect(screen.getByTestId("session-menu-group-openspec")).toBeTruthy();
    expect(screen.getByTestId("session-menu-group-git")).toBeTruthy();
  });
});
