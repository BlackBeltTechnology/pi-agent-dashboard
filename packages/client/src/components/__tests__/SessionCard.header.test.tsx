/**
 * Desktop session-card header zone: four rows (title / status / git / meta) in
 * one text column, the GIT subcard's removal, the git-row gate, PR / model /
 * missing-folder rendering, omission of empty rows, mobile output, the card's
 * single host-pressure clock and the Rules of Hooks across a layout switch.
 *
 * See change: compact-session-card-header (test-plan E1–E10, E13, E14, E17,
 * E18, F5–F7, X1, X2).
 */
import { createSlotRegistry, PluginContextProvider } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { CardSectionPrefs } from "@blackbelt-technology/pi-dashboard-shared/card-sections.js";
import { DISPLAY_PRESETS } from "@blackbelt-technology/pi-dashboard-shared/display-prefs.js";
import { HOST_PRESSURE_UNRESPONSIVE_MS } from "@blackbelt-technology/pi-dashboard-shared/host-pressure.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CardSectionsProvider } from "../../lib/state/CardSectionsContext.js";
import { DisplayPrefsProvider } from "../../lib/state/DisplayPrefsContext.js";
import { SessionCard } from "../session/SessionCard.js";

vi.mock("../../hooks/useMobile.js", () => ({ useMobile: vi.fn(() => false) }));

async function setMobile(value: boolean) {
  const { useMobile } = await import("../../hooks/useMobile.js");
  (useMobile as ReturnType<typeof vi.fn>).mockReturnValue(value);
}

beforeEach(async () => {
  await setMobile(false);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const CWD = "/repo";

function makeSession(overrides: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id: "s1",
    name: "fix header",
    cwd: CWD,
    source: "tui",
    status: "idle",
    startedAt: Date.now() - 60_000,
    tokensIn: 0,
    tokensOut: 0,
    cost: 0,
    ...overrides,
  };
}

const PROC = { pid: 1, pgid: 1, command: "vitest --watch", elapsedMs: 60_000 } as never;

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

interface RenderOpts {
  prefs?: CardSectionPrefs;
  contextBar?: boolean;
  showGitInfo?: boolean;
  processes?: unknown[];
  registry?: boolean;
  openspec?: boolean;
}

function tree(session: DashboardSession, opts: RenderOpts = {}) {
  const { prefs = {}, contextBar = true, showGitInfo = true, processes = [], registry = false, openspec = false } = opts;
  const card = (
    <SessionCard
      session={session}
      selectedId={undefined}
      onSelect={() => {}}
      now={Date.now()}
      showGitInfo={showGitInfo}
      isHidden={false}
      onArchive={() => {}}
      openspecChanges={openspec ? [] : undefined}
      openspecHasDir={openspec ? true : undefined}
      onSendPrompt={openspec ? () => {} : undefined}
      onAttachProposal={openspec ? () => {} : undefined}
      onDetachProposal={openspec ? () => {} : undefined}
      processes={processes as never}
      onKillProcess={() => {}}
    />
  );
  const wrapped = registry ? <PluginContextProvider registry={fullRegistry()}>{card}</PluginContextProvider> : card;
  return (
    <DisplayPrefsProvider
      value={{ global: { ...DISPLAY_PRESETS.standard, contextUsageBar: contextBar }, getSessionOverride: () => undefined }}
    >
      <CardSectionsProvider value={{ prefs }}>{wrapped}</CardSectionsProvider>
    </DisplayPrefsProvider>
  );
}

function renderCard(session: DashboardSession, opts: RenderOpts = {}) {
  return render(tree(session, opts));
}

const q = (id: string) => screen.queryByTestId(id);
const row = (name: "title" | "status" | "git" | "meta") => q(`session-card-${name}-row`);

/** `a` precedes `b` in document order. */
function before(a: Element, b: Element): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

const WORKTREE = { mainPath: CWD, name: "feat-x", base: "develop" } as never;

describe("header zone — fixed row order (E1)", () => {
  it("renders name < activity < worktree pill < branch < model < cost, all before the first subcard", () => {
    const { container } = renderCard(
      makeSession({
        status: "streaming",
        currentTool: "bash",
        gitBranch: "os/feat-x",
        gitWorktree: WORKTREE,
        gitPrNumber: 812,
        gitStatus: { dirtyCount: 3, staged: 0, unstaged: 3, untracked: 0, ahead: 0, behind: 0 },
        model: "anthropic/claude-opus-4-1",
        cost: 1.84,
      }),
      { processes: [PROC] },
    );
    const name = screen.getByText("fix header");
    const bash = within(row("status")!).getByText("bash");
    const pill = screen.getByTestId("worktree-pill");
    const branch = screen.getByText("os/feat-x");
    const model = screen.getByText("claude-opus-4-1");
    const cost = screen.getByText("$1.84");
    const subcard = container.querySelector(".uppercase.rounded-full")!;
    const chain = [name, bash, pill, branch, model, cost, subcard];
    for (let i = 0; i < chain.length - 1; i++) expect(before(chain[i], chain[i + 1]), `index ${i}`).toBe(true);
  });
});

describe("subcards — GIT / WORKSPACE removed (E2)", () => {
  it("lists OPENSPEC, STATUS, PROCESS, FLOWS, MEMORY in order and no GIT / WORKSPACE", () => {
    const { container } = renderCard(
      makeSession({ attachedProposal: "feat-a", gitBranch: "os/feat-x", gitWorktree: WORKTREE, cwd: `${CWD}/.worktrees/feat-x` }),
      { processes: [PROC], registry: true, openspec: true },
    );
    const titles = Array.from(container.querySelectorAll(".uppercase.rounded-full")).map((el) => el.textContent);
    expect(titles).toEqual(["OPENSPEC", "STATUS", "PROCESS", "FLOWS", "MEMORY"]);
    expect(titles).not.toContain("GIT");
    expect(titles).not.toContain("WORKSPACE");
  });
});

describe("git row render gate (E3)", () => {
  const combos: Array<[boolean, boolean, boolean, boolean]> = [];
  for (const showGitInfo of [false, true])
    for (const worktree of [false, true])
      for (const branch of [false, true])
        for (const visible of [false, true]) combos.push([showGitInfo, worktree, branch, visible]);

  it.each(combos)("showGitInfo=%s worktree=%s branch=%s visible=%s", (showGitInfo, worktree, branch, visible) => {
    renderCard(
      makeSession({
        gitBranch: branch ? "feat/a" : undefined,
        gitWorktree: worktree ? WORKTREE : undefined,
      }),
      { showGitInfo, prefs: visible ? {} : { global: { git: false } } },
    );
    const expected = (showGitInfo || worktree) && branch && visible;
    expect(row("git") !== null).toBe(expected);
  });
});

describe("worktree pill leads the git row (E4, E5)", () => {
  it("a: pill first, before the branch, created-from tooltip", () => {
    renderCard(makeSession({ gitBranch: "feat/dark", gitWorktree: WORKTREE }));
    const pill = screen.getByTestId("worktree-pill");
    expect(row("git")!.firstElementChild).toBe(pill);
    expect(before(pill, screen.getByText("feat/dark"))).toBe(true);
    expect(pill.getAttribute("title")).toBe("created from develop");
  });

  it("b: no base → generic tooltip", () => {
    renderCard(makeSession({ gitBranch: "feat/dark", gitWorktree: { mainPath: CWD, name: "feat-dark" } as never }));
    expect(screen.getByTestId("worktree-pill").getAttribute("title")).toBe("git worktree");
  });

  it("c: not a worktree → no pill", () => {
    renderCard(makeSession({ gitBranch: "feat/dark" }));
    expect(q("worktree-pill")).toBeNull();
    expect(row("git")).not.toBeNull();
  });

  it("E5: worktree without a branch yet → no git row, no pill", () => {
    renderCard(makeSession({ gitBranch: undefined, gitWorktree: WORKTREE }));
    expect(row("git")).toBeNull();
    expect(q("worktree-pill")).toBeNull();
  });
});

describe("PR status reuse (E6)", () => {
  it("a: open + passing checks", () => {
    renderCard(makeSession({ gitBranch: "b", gitPrNumber: 812, gitPrState: "open", gitPrChecks: "passing" }));
    const seg = screen.getByTestId("worktree-pr-segment");
    expect(seg.textContent).toContain("#812");
    expect(seg.textContent).toContain("open");
    expect(within(seg).queryByTestId("worktree-pr-checks")).not.toBeNull();
    expect(within(row("git")!).getByTestId("worktree-pr-segment")).toBe(seg);
  });

  it("b: draft → draft word, no checks", () => {
    renderCard(makeSession({ gitBranch: "b", gitPrNumber: 812, gitPrState: "open", gitPrDraft: true, gitPrChecks: "passing" }));
    const seg = screen.getByTestId("worktree-pr-segment");
    expect(seg.textContent).toContain("draft");
    expect(within(seg).queryByTestId("worktree-pr-checks")).toBeNull();
  });

  it("c: number only → #N alone", () => {
    renderCard(makeSession({ gitBranch: "b", gitPrNumber: 5 }));
    const seg = screen.getByTestId("worktree-pr-segment");
    expect(seg.textContent).toContain("#5");
    expect(seg.textContent).not.toMatch(/open|draft|merged|closed/);
    expect(within(seg).queryByTestId("worktree-pr-checks")).toBeNull();
  });
});

describe("missing-folder pill in the title row (E7, E13)", () => {
  const cases: Array<[string, Partial<DashboardSession>, RenderOpts]> = [
    ["a: no git branch", { cwdMissing: true }, {}],
    ["b: non-worktree member of a 2-session group", { cwdMissing: true, gitBranch: "main" }, { showGitInfo: false }],
    ["c: worktree with branch", { cwdMissing: true, gitBranch: "b", gitWorktree: WORKTREE }, {}],
  ];
  it.each(cases)("%s", (_label, session, opts) => {
    renderCard(makeSession(session), opts);
    const pill = screen.getByTestId("cwd-gone-pill");
    expect(pill.textContent).toBe("folder missing");
    const titleRow = row("title")!;
    expect(titleRow.contains(pill)).toBe(true);
    expect(row("git")?.contains(pill) ?? false).toBe(false);
    const name = screen.getByText("fix header");
    const time = pill.nextElementSibling!;
    expect(before(name, pill)).toBe(true);
    expect(before(pill, time)).toBe(true);
  });

  it.each([[false], [undefined]])("d/e: cwdMissing=%s → no pill", (cwdMissing) => {
    renderCard(makeSession({ cwdMissing }));
    expect(q("cwd-gone-pill")).toBeNull();
  });

  it("E13: hiding git removes the git row but keeps the missing-folder pill", () => {
    renderCard(
      makeSession({
        gitBranch: "b",
        gitWorktree: WORKTREE,
        gitPrNumber: 1,
        gitPrState: "open",
        gitStatus: { dirtyCount: 2, staged: 0, unstaged: 2, untracked: 0, ahead: 0, behind: 0 },
        cwdMissing: true,
      }),
      { prefs: { folders: { [CWD]: { git: false } } } },
    );
    for (const id of ["worktree-pill", "worktree-pr-segment", "git-dirty-pill"]) expect(q(id)).toBeNull();
    expect(screen.queryByText("b")).toBeNull();
    expect(row("title")!.contains(screen.getByTestId("cwd-gone-pill"))).toBe(true);
  });
});

describe("section-visibility resolution order applies to the git row (E14)", () => {
  const session = () => makeSession({ gitBranch: "feat/a" });
  it("global hide + folder override show → git row renders", () => {
    renderCard(session(), { prefs: { global: { git: false }, folders: { [CWD]: { git: true } } } });
    expect(row("git")).not.toBeNull();
  });

  it("Focus profile hide over folder show → git row absent", () => {
    renderCard(session(), {
      prefs: { folders: { [CWD]: { git: true } }, focus: { enabled: true, profile: { sections: { git: false } } } },
    });
    expect(row("git")).toBeNull();
  });
});

describe("model label (E8)", () => {
  it("strips the provider, appends thinking level, keeps the full value in title", () => {
    renderCard(makeSession({ model: "anthropic/claude-opus-4-1", thinkingLevel: "high" }));
    const el = within(row("meta")!).getByText("claude-opus-4-1 (high)");
    expect(el.getAttribute("title")).toContain("anthropic/claude-opus-4-1");
  });

  it("bare id unchanged", () => {
    renderCard(makeSession({ model: "gpt-5" }));
    expect(within(row("meta")!).getByText("gpt-5")).toBeTruthy();
  });

  it("empty id part → full value", () => {
    renderCard(makeSession({ model: "anthropic/" }));
    expect(within(row("meta")!).getByText("anthropic/")).toBeTruthy();
  });

  it("no model → no label, cost still renders", () => {
    renderCard(makeSession({ model: undefined, cost: 0.12 }), { contextBar: false });
    const meta = row("meta")!;
    expect(meta.textContent).toContain("$0.12");
    expect(meta.querySelector("[title]")).toBeNull();
  });
});

describe("status row omission (E9)", () => {
  it("ended without a reason and healthy pressure → no status row", () => {
    renderCard(makeSession({ status: "ended", closedReason: undefined, hostPressure: undefined }));
    expect(row("status")).toBeNull();
  });

  it("control: ended with process_gone → status row with the reason pill", () => {
    const { container } = renderCard(makeSession({ status: "ended", closedReason: "process_gone" }));
    expect(row("status")).not.toBeNull();
    expect(container.querySelector('[data-closed-reason="process_gone"]')).not.toBeNull();
  });
});

describe("meta row omission + cost boundary (E10)", () => {
  it("cost 0 + pref off → no meta row", () => {
    renderCard(makeSession({ cost: 0 }), { contextBar: false });
    expect(row("meta")).toBeNull();
  });

  it("cost 0.01 → meta row with $0.01", () => {
    renderCard(makeSession({ cost: 0.01 }), { contextBar: false });
    expect(row("meta")!.textContent).toContain("$0.01");
  });

  it("pref on + cost 0 → context bar, no cost element", () => {
    renderCard(makeSession({ cost: 0 }), { contextBar: true });
    const meta = row("meta")!;
    expect(within(meta).queryByTestId("context-usage-bar")).not.toBeNull();
    expect(meta.textContent).not.toContain("$");
  });
});

describe("header extras and KB wrapper order (E18)", () => {
  it("meta row < OpenSpec badge < tags < OPENSPEC < worktree-card-section gap < STATUS", () => {
    const { container } = renderCard(
      makeSession({
        attachedProposal: "feat-a",
        openspecChange: "feat-xyz",
        tags: ["alpha", "beta"],
        model: "gpt-5",
        gitWorktree: WORKTREE,
        gitBranch: "os/x",
        cwd: `${CWD}/.worktrees/x`,
      }),
      { registry: true, openspec: true },
    );
    const legends = Array.from(container.querySelectorAll(".uppercase.rounded-full"));
    const openspec = legends.find((el) => el.textContent === "OPENSPEC")!;
    const status = legends.find((el) => el.textContent === "STATUS")!;
    const chain = [
      row("meta")!,
      screen.getByText(/feat-xyz/),
      screen.getByText("#alpha"),
      openspec,
      screen.getByTestId("worktree-card-section-gap"),
      status,
    ];
    for (let i = 0; i < chain.length - 1; i++) expect(before(chain[i], chain[i + 1]), `index ${i}`).toBe(true);
  });
});

describe("mobile card unchanged (E17)", () => {
  it("renders activity + host pressure, no status / git / meta rows or header pill", async () => {
    await setMobile(true);
    renderCard(
      makeSession({
        status: "streaming",
        currentTool: "bash",
        hostPressure: { state: "degraded", since: Date.now() - 40_000 },
        cwdMissing: true,
        gitBranch: "b",
        gitWorktree: WORKTREE,
      }),
    );
    expect(screen.getByText("bash")).toBeTruthy();
    expect(screen.getByTestId("session-host-pressure-s1").textContent).toMatch(/host slow/);
    for (const r of ["status", "git", "meta", "title"] as const) expect(row(r)).toBeNull();
    expect(q("cwd-gone-pill")).toBeNull();
  });
});

describe("host-pressure clock (F5, F6)", () => {
  it("F5: the status row escalates degraded → unresponsive within one tick, with no prop change", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const base = Date.now();
    renderCard(
      makeSession({
        status: "streaming",
        hostPressure: { state: "degraded", since: base - (HOST_PRESSURE_UNRESPONSIVE_MS - 3_000) },
      }),
    );
    const pill = () => within(row("status")!).getByTestId("session-host-pressure-s1");
    expect(pill().getAttribute("data-host-pressure")).toBe("degraded");
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(pill().getAttribute("data-host-pressure")).toBe("unresponsive");
  });

  it("F6: no card-level interval and no timer-driven re-render while hostPressure is absent", () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(window, "setInterval");
    let commits = 0;
    render(
      <Profiler id="card" onRender={() => { commits += 1; }}>
        {tree(makeSession({ status: "streaming" }))}
      </Profiler>,
    );
    expect(spy.mock.calls.filter(([, ms]) => ms === 5_000)).toHaveLength(0);
    const afterMount = commits;
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(commits).toBe(afterMount);
  });

  it("F6 control: the 5 s interval is registered when hostPressure is present", () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(window, "setInterval");
    renderCard(makeSession({ status: "streaming", hostPressure: { state: "degraded", since: Date.now() - 36_000 } }));
    expect(spy.mock.calls.filter(([, ms]) => ms === 5_000).length).toBeGreaterThanOrEqual(1);
  });
});

describe("Rules of Hooks across a layout switch (F7)", () => {
  it("desktop → mobile → desktop re-renders the same instance without a hook-order error", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const session = makeSession({
      status: "streaming",
      currentTool: "bash",
      gitBranch: "feat/a",
      hostPressure: { state: "degraded", since: Date.now() - 40_000 },
    });
    const view = renderCard(session);
    expect(row("status")).not.toBeNull();
    await setMobile(true);
    view.rerender(tree(session));
    expect(row("status")).toBeNull();
    expect(screen.getByText("bash")).toBeTruthy();
    await setMobile(false);
    view.rerender(tree(session));
    expect(row("status")).not.toBeNull();
    expect(row("git")).not.toBeNull();
    const hookErrors = errors.mock.calls.filter((c) => /hook/i.test(String(c[0])));
    expect(hookErrors).toEqual([]);
  });
});

describe("error handling (X1, X2)", () => {
  it("X1: gitStatus absent → git row renders the branch with no dirty pill and no console error", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    // Unique cwd: the git-status cache is module-level and keyed by cwd.
    renderCard(makeSession({ cwd: "/x1-legacy-probe", gitBranch: "feat/a", gitWorktree: WORKTREE, gitStatus: undefined }));
    expect(within(row("git")!).getByText("feat/a")).toBeTruthy();
    expect(q("git-dirty-pill")).toBeNull();
    expect(errors).not.toHaveBeenCalled();
  });

  it("X2: an unknown ended reason does not crash and reads 'reason unknown'", () => {
    renderCard(makeSession({ status: "ended", closedReason: "constructor" as never }));
    expect(within(row("status")!).getByText(/reason unknown/)).toBeTruthy();
  });
});

describe("session chips render on the meta row when their predicate holds (E12)", () => {
  it("moved-away, remote-origin and ACP sessions each show their chip; a plain one shows none", () => {
    renderCard(makeSession({ status: "ended", movedTo: { instanceId: "i2" } as never, closedReason: "process_gone" }), { contextBar: false });
    expect(within(row("meta")!).getByTestId("session-moved-badge-s1")).toBeTruthy();
    cleanup();
    renderCard(makeSession({ originDeviceId: "laptop" }), { contextBar: false });
    expect(within(row("meta")!).getByTestId("session-origin-s1")).toBeTruthy();
    cleanup();
    renderCard(makeSession({ driver: "acp", acpAgentId: "agent-x" }), { contextBar: false });
    expect(within(row("meta")!).getByTestId("session-driver-chip")).toBeTruthy();
    cleanup();
    renderCard(makeSession(), { contextBar: false });
    expect(row("meta")).toBeNull();
  });
});
