import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { changedFrame, routed, routeTeams, sessionIdOf, type TeamState, teamState, teamViewUrl } from "./helpers/agent-teams.js";
import { type FrameInjector, installFrameInjector, spawnFreshGitSession } from "./helpers/index.js";

/**
 * L3 — Team view of an IN-PROCESS team (change: add-agent-teams-in-process, tasks 13.9–13.13,
 * test-plan S107–S111). Source of the team: the ⟦fixture⟧ `page.route` server of
 * `helpers/agent-teams.ts` (the same mechanism as the `agent-teams-*.spec.ts` family) with `mode:
 * "in-process"`, members WITHOUT `sessionId` carrying `childAgentId` / `queuePosition`; the lead
 * session is a real harness session. Asserts only `data-testid` / `data-status` / URLs, never
 * translated copy (the numeric queue position is read from the testid's text).
 * Exemplars: subagent-detail-dialog.spec.ts (S107), team-llm.spec.ts header checks (S108),
 * subagent-stop-finalize.spec.ts (S109), subagent-inspector-frame-loss.spec.ts (S110),
 * subagent-queue-stop.spec.ts (S111).
 * Scope note (S109): the dock Stop → `gone` mapping of a REAL child needs the upstream package (or the
 * docker fake-subagents fixture) and is covered by the L1 rows S60/S66; here the Team view side is
 * exercised by serving the post-Stop snapshot, which is the part the browser owns.
 * Location note: this spec lives beside the other `agent-teams-*.spec.ts`, not under `tests/e2e/team/`,
 * because that directory is excluded from the default (docker-harness) config.
 * STATUS: written, not yet run (needs the docker harness).
 */
const TEAM_ID = "t-e2e";

const inProc = (over: Partial<TeamState> = {}): TeamState =>
  teamState({
    mode: "in-process",
    maxTeammates: 5,
    maxConcurrent: 4,
    members: [
      { name: "bob", status: "busy", childAgentId: "agent-bob" },
      { name: "eve", status: "idle", childAgentId: "agent-eve" },
    ],
    tasks: [{ id: "1", title: "Port it", status: "in_progress", owner: "bob" }],
    ...over,
  });

/** Route the fixture team and open its Team view from a real lead session; returns the lead id. */
async function open(page: Page, state: TeamState): Promise<{ sid: string; r: ReturnType<typeof routed> }> {
  const r = routed(state);
  await routeTeams(page, r);
  const sid = await sessionIdOf(await spawnFreshGitSession(page));
  state.leadSessionId = sid;
  await page.goto(teamViewUrl(sid));
  await expect(page.getByTestId("team-view")).toBeVisible({ timeout: 20_000 });
  return { sid, r };
}

/** Serve `rev` and tell the browser about it; resolves once the refetch happened. */
async function publish(injector: FrameInjector, r: ReturnType<typeof routed>, state: TeamState, sid: string, rev: number): Promise<void> {
  const before = r.gets.filter((g) => g.endsWith(`/teams/${TEAM_ID}`)).length;
  state.rev = rev;
  injector.send(changedFrame(sid, TEAM_ID, rev));
  await expect.poll(() => r.gets.filter((g) => g.endsWith(`/teams/${TEAM_ID}`)).length, { timeout: 15_000 }).toBeGreaterThan(before);
}

const statusOf = (page: Page, name: string) => page.locator(`[data-testid="team-member-card"][data-member="${name}"]`).getByTestId("team-member-status");
const queueOf = (page: Page, name: string) => page.locator(`[data-testid="team-member-card"][data-member="${name}"]`).getByTestId("team-member-queue");

test("S107: an in-process member offers the subagent view by childAgentId — no session link, no chat input", async ({ page }) => {
  test.setTimeout(120_000);
  const { sid } = await open(page, inProc());
  const rows = page.getByTestId("team-member-card");
  await expect(rows).toHaveCount(2);
  for (const name of ["bob", "eve"]) {
    const row = page.locator(`[data-testid="team-member-card"][data-member="${name}"]`);
    await expect(row.getByTestId("team-member-status")).toHaveAttribute("data-status", name === "bob" ? "busy" : "idle");
    await expect(row.getByTestId("team-member-open-subagent")).toHaveAttribute("href", `/session/${encodeURIComponent(sid)}/subagent/agent-${name}`);
    // read-only member row: no session link, no chat affordance
    await expect(row.locator('a[href^="/session/"]:not([href*="/subagent/"])')).toHaveCount(0);
    await expect(row.locator("textarea, input, [contenteditable]")).toHaveCount(0);
  }
  await expect(page.getByTestId("composer-root")).toHaveCount(0);

  const pagesBefore = page.context().pages().length;
  await page.locator('[data-testid="team-member-card"][data-member="bob"]').getByTestId("team-member-open-subagent").click();
  await expect(page).toHaveURL(new RegExp(`/session/${encodeURIComponent(sid)}/subagent/agent-bob$`), { timeout: 20_000 });
  expect(page.context().pages().length, "the popout never opens a new tab").toBe(pagesBefore);
  await expect(page.getByTestId("composer-root")).toHaveCount(0); // read-only subagent view
});

test("S108: the header names the mode and states the parallelism bound only when maxTeammates > maxConcurrent", async ({ page }) => {
  test.setTimeout(120_000);
  const state = inProc();
  await open(page, state);
  await expect(page.getByTestId("team-header-mode")).toBeVisible();
  const cases: Array<{ maxTeammates: number; maxConcurrent: number; bound: number | null }> = [
    { maxTeammates: 5, maxConcurrent: 4, bound: 4 },
    { maxTeammates: 4, maxConcurrent: 4, bound: null },
    { maxTeammates: 3, maxConcurrent: 4, bound: null },
  ];
  for (const c of cases) {
    state.maxTeammates = c.maxTeammates;
    state.maxConcurrent = c.maxConcurrent;
    await page.reload();
    await expect(page.getByTestId("team-view")).toBeVisible({ timeout: 20_000 });
    const parallel = page.getByTestId("team-header-parallel");
    if (c.bound === null) await expect(parallel, `${c.maxTeammates}/${c.maxConcurrent}`).toHaveCount(0);
    else await expect(parallel, `${c.maxTeammates}/${c.maxConcurrent}`).toHaveAttribute("data-bound", String(c.bound));
  }

  // A session team names its mode and keeps the live working count (never a bound).
  state.mode = "session";
  state.maxTeammates = undefined;
  state.maxConcurrent = undefined;
  state.members = [{ name: "alice", status: "busy" }];
  await page.reload();
  await expect(page.getByTestId("team-header-mode")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("team-header-parallel")).not.toHaveAttribute("data-bound", /.*/);
});

test("S109: after a dock Stop the member shows gone, its task is pending, and a browser reload shows the same", async ({ page }) => {
  test.setTimeout(120_000);
  const injector = await installFrameInjector(page);
  const state = inProc({ maxConcurrent: 2, members: [{ name: "bob", status: "busy", childAgentId: "agent-bob" }, { name: "kim", status: "spawning", childAgentId: "agent-kim", queuePosition: 1 }] });
  const { sid, r } = await open(page, state);
  await expect(statusOf(page, "bob")).toHaveAttribute("data-status", "busy");

  // Stop of the busy child and of the slot-queued one (both from the Processes lane).
  state.members = [
    { name: "bob", status: "gone", childAgentId: "agent-bob", goneReason: "stopped" },
    { name: "kim", status: "gone", childAgentId: "agent-kim", goneReason: "stopped" },
  ];
  state.tasks = [{ id: "1", title: "Port it", status: "pending" }];
  await publish(injector, r, state, sid, 2);
  await expect(statusOf(page, "bob")).toHaveAttribute("data-status", "gone");
  await expect(statusOf(page, "kim")).toHaveAttribute("data-status", "gone");
  await expect(queueOf(page, "kim")).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId("team-view")).toBeVisible({ timeout: 20_000 });
  await expect(statusOf(page, "bob")).toHaveAttribute("data-status", "gone");
  await expect(statusOf(page, "kim")).toHaveAttribute("data-status", "gone");
  await expect(page.getByTestId("team-member-card")).toHaveCount(2);
});

test("S110: busy→idle→busy→gone with half of the change frames lost converges to the server snapshot — no stale busy, no duplicate rows", async ({ page }) => {
  test.setTimeout(120_000);
  const injector = await installFrameInjector(page);
  const state = inProc();
  const { sid, r } = await open(page, state);
  await expect(statusOf(page, "bob")).toHaveAttribute("data-status", "busy");

  // Three more transitions (busy → idle → busy → gone); the frames of revs 2 and 3 never reach the browser.
  const bob = (status: string, goneReason?: string) => ({ name: "bob", status, childAgentId: "agent-bob", ...(goneReason ? { goneReason } : {}) });
  const eve = { name: "eve", status: "idle", childAgentId: "agent-eve" };
  state.members = [bob("idle"), eve];
  state.rev = 2; // frame lost
  state.members = [bob("busy"), eve];
  state.rev = 3; // frame lost
  state.members = [bob("gone", "stopped"), eve];
  await publish(injector, r, state, sid, 4); // the 4th frame arrives
  await expect(statusOf(page, "bob")).toHaveAttribute("data-status", "gone", { timeout: 15_000 });
  await expect(page.getByTestId("team-member-card")).toHaveCount(2);
  await expect(page.locator('[data-testid="team-member-card"][data-member="bob"]')).toHaveCount(1);
  await expect(page.getByTestId("team-member-open-subagent")).toHaveCount(2);

  // A reconnect-style full reload equals the server snapshot too.
  await page.reload();
  await expect(statusOf(page, "bob")).toHaveAttribute("data-status", "gone", { timeout: 20_000 });
  await expect(page.locator('[data-testid="team-member-card"][data-member="bob"]')).toHaveCount(1);
});

test("S111: maxConcurrent 2 with four teammates — queued members show spawning + a 1-based position, then become busy without a reload", async ({ page }) => {
  test.setTimeout(120_000);
  const injector = await installFrameInjector(page);
  const state = inProc({
    maxTeammates: 4,
    maxConcurrent: 2,
    members: [
      { name: "a", status: "busy", childAgentId: "agent-a" },
      { name: "b", status: "busy", childAgentId: "agent-b" },
      { name: "c", status: "spawning", childAgentId: "agent-c", queuePosition: 1 },
      { name: "d", status: "spawning", childAgentId: "agent-d", queuePosition: 2 },
    ],
  });
  const { sid, r } = await open(page, state);
  const positions = async (): Promise<number[]> => {
    const texts = await page.getByTestId("team-member-queue").allTextContents();
    return texts.map((t) => Number(/\d+/.exec(t)?.[0] ?? Number.NaN));
  };

  await expect(statusOf(page, "c")).toHaveAttribute("data-status", "spawning");
  await expect(statusOf(page, "d")).toHaveAttribute("data-status", "spawning");
  expect((await positions()).sort((x, y) => x - y)).toEqual([1, 2]); // 1-based, never 0, no duplicate
  await expect(queueOf(page, "a")).toHaveCount(0);

  // A slot frees: a goes idle, c starts, d moves up.
  state.members = [
    { name: "a", status: "idle", childAgentId: "agent-a" },
    { name: "b", status: "busy", childAgentId: "agent-b" },
    { name: "c", status: "busy", childAgentId: "agent-c" },
    { name: "d", status: "spawning", childAgentId: "agent-d", queuePosition: 1 },
  ];
  await publish(injector, r, state, sid, 2);
  await expect(statusOf(page, "c")).toHaveAttribute("data-status", "busy");
  await expect(statusOf(page, "d")).toHaveAttribute("data-status", "spawning");
  await expect.poll(positions).toEqual([1]);

  // Next slot frees: d starts, no queue line is left.
  state.members = [
    { name: "a", status: "idle", childAgentId: "agent-a" },
    { name: "b", status: "idle", childAgentId: "agent-b" },
    { name: "c", status: "busy", childAgentId: "agent-c" },
    { name: "d", status: "busy", childAgentId: "agent-d" },
  ];
  await publish(injector, r, state, sid, 3);
  await expect(statusOf(page, "d")).toHaveAttribute("data-status", "busy");
  await expect(page.getByTestId("team-member-queue")).toHaveCount(0);
});
