/**
 * Session-card section visibility gating (desktop + mobile), the PROCESS
 * safety chip, and the legend options menu.
 * See change: configurable-session-card-sections.
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
    const a = renderCard(undefined).container.innerHTML;
    cleanup();
    const b = renderCard({}).container.innerHTML;
    expect(b).toBe(a);
  });

  it("renders every section with no prefs", () => {
    renderCard({}, { session: { gitWorktree: { mainPath: CWD, name: "wt" } as never, cwd: `${CWD}/.worktrees/wt` }, processes: [PROC] });
    for (const t of ["OPENSPEC", "GIT", "STATUS", "PROCESS", "FLOWS", "MEMORY"]) expect(hasTitle(t)).toBe(true);
    expect(screen.queryByTestId("kb-claim")).not.toBeNull();
    expect(screen.queryByText("#ui")).not.toBeNull();
    expect(screen.queryByTestId("session-card-spawn-sibling")).not.toBeNull();
  });

  it.each([
    ["openspec", () => hasTitle("OPENSPEC")],
    ["git", () => hasTitle("GIT")],
    ["status", () => hasTitle("STATUS")],
    ["flows", () => hasTitle("FLOWS")],
    ["memory", () => hasTitle("MEMORY")],
    ["tags", () => screen.queryByText("#ui") !== null],
    ["spawn", () => screen.queryByTestId("session-card-spawn-sibling") !== null || screen.queryByTestId("session-card-spawn-worktree") !== null],
  ])("folder hide of %s removes it", (id, present) => {
    renderCard({ folders: { [CWD]: { [id]: false } } });
    expect(present()).toBe(false);
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
    expect(hasTitle("GIT")).toBe(true);
  });

  it("does not affect another folder", () => {
    renderCard({ folders: { "/other": { git: false } } });
    expect(hasTitle("GIT")).toBe(true);
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

describe("legend options menu", () => {
  function setup(prefs: CardSectionPrefs = {}) {
    const send = vi.fn();
    const showToast = vi.fn();
    const utils = renderCard(prefs, { ctx: { send, showToast } });
    return { send, showToast, ...utils };
  }

  it("no menu without a transport", () => {
    renderCard({});
    expect(screen.queryByTestId("subcard-menu-git")).toBeNull();
  });

  it("menu button is a focusable, labelled button that opens by keyboard without selecting the card", () => {
    const { onSelect } = setup();
    const btn = screen.getByTestId("subcard-menu-git");
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.getAttribute("aria-label")).toMatch(/GIT/);
    expect(btn.getAttribute("aria-haspopup")).toBe("menu");
    btn.focus();
    expect(document.activeElement).toBe(btn);
    // Native <button> activates on Enter/Space via click.
    fireEvent.click(btn);
    expect(screen.getByTestId("subcard-menu-panel-git")).toBeTruthy();
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByTestId("subcard-menu-item-settings"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("hide in folder sends the write + Undo restores the previous value", () => {
    const { send, showToast } = setup({ folders: { [CWD]: { git: true } } });
    fireEvent.click(screen.getByTestId("subcard-menu-git"));
    fireEvent.click(screen.getByTestId("subcard-menu-item-hide-folder"));
    expect(send).toHaveBeenCalledWith({ type: "set_card_section_visibility", path: CWD, section: "git", visible: false });
    expect(showToast).toHaveBeenCalledTimes(1);
    const [, variant, opts] = showToast.mock.calls[0];
    expect(variant).toBe("info");
    act(() => opts.action.onClick());
    expect(send).toHaveBeenLastCalledWith({ type: "set_card_section_visibility", path: CWD, section: "git", visible: true });
  });

  it("hide everywhere writes global; Undo restores inherit (null)", () => {
    const { send, showToast } = setup();
    fireEvent.click(screen.getByTestId("subcard-menu-flows"));
    fireEvent.click(screen.getByTestId("subcard-menu-item-hide-everywhere"));
    expect(send).toHaveBeenCalledWith({ type: "set_card_section_visibility", section: "flows", visible: false });
    act(() => showToast.mock.calls[0][2].action.onClick());
    expect(send).toHaveBeenLastCalledWith({ type: "set_card_section_visibility", section: "flows", visible: null });
  });

  it("menu for a worktree session targets the main folder", () => {
    const send = vi.fn();
    renderCard({}, { ctx: { send, showToast: vi.fn() }, session: { cwd: `${CWD}/.worktrees/x`, gitWorktree: { mainPath: CWD, name: "x" } as never } });
    fireEvent.click(screen.getByTestId("subcard-menu-git"));
    fireEvent.click(screen.getByTestId("subcard-menu-item-hide-folder"));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ path: CWD }));
  });

  it("section settings navigates to the folder's cards page", () => {
    setup();
    fireEvent.click(screen.getByTestId("subcard-menu-openspec"));
    fireEvent.click(screen.getByTestId("subcard-menu-item-settings"));
    expect(window.location.pathname).toMatch(/^\/folder\/[^/]+\/settings\/cards$/);
  });

  it("Escape closes the menu and returns focus to the trigger", () => {
    setup();
    const btn = screen.getByTestId("subcard-menu-git");
    fireEvent.click(btn);
    fireEvent.keyDown(screen.getByTestId("subcard-menu-panel-git"), { key: "Escape" });
    expect(screen.queryByTestId("subcard-menu-panel-git")).toBeNull();
    expect(document.activeElement).toBe(btn);
  });
});
