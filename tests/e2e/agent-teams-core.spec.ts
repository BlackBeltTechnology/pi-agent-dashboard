import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { gotoDashboard, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

/**
 * L3 — agent-teams core against the docker harness (change: add-agent-teams-core,
 * test-plan rows S133, S134).
 *
 * The rendered UI of this change is minimal (the team UI arrives in change 2), so
 * L3 stays at two rows: a teammate is an ORDINARY session card, and the card state
 * converges after a server restart. Both are driven by a faux-scripted LEAD
 * (`agent-teams-lead-spawn` / `agent-teams-lead-task` in qa/fixtures/faux-scenarios.ts:
 * TeamCreate + TeammateSpawn(alice) on the faux model) and observed through the
 * read-only REST snapshot `GET /api/plugins/agent-teams/teams[/:id]`.
 * Assertions are REST invariants: alice is kept `busy` by the ~25 s single-turn
 * `steer-hold-stream` run (the harness `ask_user` is shadowed by pi-flows' tool, so a
 * parked question cannot hold a run here); the lead's task lands well inside that window.
 *
 * Port is derived (`PW_E2E_PORT` → the `page` fixture baseURL), never hardcoded.
 * Harness lifecycle:
 *   docker/test-up.sh -d --build && PW_E2E_USE_RUNNING=1 npm run test:e2e -- agent-teams-core
 * Skips when the harness server does not serve the plugin routes.
 */

const API = "/api/plugins/agent-teams";
const CARD = '[data-testid="session-card-desktop"]';

interface Member {
  name: string;
  status: string;
  sessionId?: string;
  cwd: string;
}
interface Task {
  id: string;
  status: string;
  owner?: string;
}
interface Snapshot {
  id: string;
  name: string;
  status: string;
  leadConnected: boolean;
  members: Member[];
  tasks: Task[];
}

async function teamIds(page: Page): Promise<string[] | undefined> {
  const res = await page.request.get(`${API}/teams`);
  if (res.status() === 404) return undefined; // plugin not loaded on this harness
  expect(res.ok(), "GET /teams").toBe(true);
  return ((await res.json()) as { teams: Array<{ id: string }> }).teams.map((t) => t.id);
}

async function snapshot(page: Page, id: string): Promise<Snapshot> {
  const res = await page.request.get(`${API}/teams/${id}`);
  expect(res.ok(), `GET /teams/${id}`).toBe(true);
  return (await res.json()) as Snapshot;
}

const memberOf = (snap: Snapshot, name: string): Member | undefined => snap.members.find((m) => m.name === name);

/** `{ pid, startedAt }` identifying the current server process, or null while down. */
async function serverIdentity(page: Page): Promise<{ pid: number; startedAt: string } | null> {
  try {
    const res = await page.request.get("/api/health", { timeout: 5_000 });
    if (!res.ok()) return null;
    const body = (await res.json()) as { pid: number; startedAt: string };
    return body.pid == null ? null : { pid: body.pid, startedAt: body.startedAt };
  } catch {
    return null; // mid-restart: connection refused / empty response
  }
}

/** Dismiss a leaked modal overlay that would intercept pointer events on the composer. */
async function dismissOverlays(page: Page): Promise<void> {
  for (let i = 0; i < 3; i++) {
    const overlay = page.getByTestId("propose-dialog-overlay");
    if (!(await overlay.isVisible().catch(() => false))) return;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
  }
}

interface Fixture {
  leadCard: Locator;
  leadSessionId: string;
  teamId: string;
  aliceSessionId: string;
}

/** Spawn a lead session, run `agent-teams-lead-spawn`, and wait for an idle teammate `alice`. */
async function startTeam(page: Page, known: ReadonlySet<string>): Promise<Fixture> {
  const leadCard = await spawnFreshGitSession(page);
  const leadSessionId = (await leadCard.getAttribute("data-session-id")) as string;
  expect(leadSessionId, "spawned lead card must carry a session id").toBeTruthy();
  await leadCard.click();
  await dismissOverlays(page);
  await sendPrompt(page, "[[faux:agent-teams-lead-spawn]] go");

  let teamId = "";
  await expect
    .poll(
      async () => {
        const ids = (await teamIds(page)) ?? [];
        teamId = ids.find((id) => !known.has(id)) ?? "";
        return teamId;
      },
      { timeout: 90_000, intervals: [500], message: "the lead's TeamCreate must create a team" },
    )
    .not.toBe("");

  let aliceSessionId = "";
  await expect
    .poll(
      async () => {
        const alice = memberOf(await snapshot(page, teamId), "alice");
        aliceSessionId = alice?.sessionId ?? "";
        return alice?.status;
      },
      { timeout: 120_000, intervals: [1_000], message: "alice must register and settle idle" },
    )
    .toBe("idle");
  return { leadCard, leadSessionId, teamId, aliceSessionId };
}

const cardOf = (page: Page, sessionId: string): Locator => page.locator(`${CARD}[data-session-id="${sessionId}"]`);

/** Best-effort teardown: end the sessions this spec created (the team follows its lead). */
async function shutdownSessions(page: Page, ids: string[]): Promise<void> {
  for (const id of ids) {
    await page.request.post(`/api/session/${id}/shutdown`, { timeout: 10_000 }).catch(() => undefined);
  }
}

test.describe("agent-teams core (L3)", () => {
  test.setTimeout(300_000);
  const created: string[] = [];

  test.afterEach(async ({ page }) => {
    await shutdownSessions(page, created.splice(0));
  });

  test("S133 teammate session visible as an ordinary session card", async ({ page }) => {
    await gotoDashboard(page);
    const known = await teamIds(page);
    test.skip(known === undefined, "agent-teams plugin routes are not served by this harness");
    const { leadCard, leadSessionId, teamId, aliceSessionId } = await startTeam(page, new Set(known));
    created.push(aliceSessionId, leadSessionId);
    expect(aliceSessionId, "alice must be bound to a session").toBeTruthy();

    // alice is an ordinary, openable session card showing her name.
    const aliceCard = cardOf(page, aliceSessionId);
    await expect(aliceCard).toBeVisible({ timeout: 60_000 });
    await expect(aliceCard).toContainText(/alice/i);
    const lead = await snapshot(page, teamId);
    expect(memberOf(lead, "alice")?.cwd, "the member snapshot carries her cwd").toBeTruthy();
    await aliceCard.click();
    await dismissOverlays(page);
    await expect(page.getByPlaceholder(/message/i).first()).toBeVisible();

    // The user talks to alice: a ~25 s streamed turn keeps her `busy`.
    await sendPrompt(page, "[[faux:steer-hold-stream]] hello alice");
    await expect
      .poll(async () => memberOf(await snapshot(page, teamId), "alice")?.status, { timeout: 60_000, intervals: [500] })
      .toBe("busy");

    // While she is busy a task appears: the dispatcher must NOT hand it to her (one atomic snapshot).
    await leadCard.click();
    await dismissOverlays(page);
    await sendPrompt(page, "[[faux:agent-teams-lead-task]] go");
    await expect
      .poll(async () => (await snapshot(page, teamId)).tasks.length, { timeout: 90_000, intervals: [500] })
      .toBe(1);
    const whileBusy = await snapshot(page, teamId);
    expect(memberOf(whileBusy, "alice")?.status).toBe("busy");
    expect(whileBusy.tasks[0]).toMatchObject({ status: "pending" });
    expect(whileBusy.tasks[0]?.owner).toBeUndefined();

    // Her run ends and the system converges: alice idle again, holding the task.
    await expect
      .poll(
        async () => {
          const snap = await snapshot(page, teamId);
          return `${memberOf(snap, "alice")?.status}:${snap.tasks[0]?.owner}`;
        },
        { timeout: 120_000, intervals: [1_000], message: "alice converges to idle holding the dispatched task" },
      )
      .toBe("idle:alice");
  });

  test("S134 orphan/restart card state converges after a server restart", async ({ page }) => {
    await gotoDashboard(page);
    const known = await teamIds(page);
    test.skip(known === undefined, "agent-teams plugin routes are not served by this harness");
    const { leadSessionId, teamId, aliceSessionId } = await startTeam(page, new Set(known));
    created.push(aliceSessionId, leadSessionId);
    expect(aliceSessionId, "alice must be bound to a session").toBeTruthy();
    await expect(cardOf(page, aliceSessionId)).toBeVisible({ timeout: 60_000 });

    const before = await serverIdentity(page);
    expect(before, "server identity must be readable before the restart").not.toBeNull();
    await page.request.post("/api/restart", { timeout: 10_000 }).catch(() => {
      // The server tears the socket down mid-response; a transport error here is the expected shape.
    });
    // A DIFFERENT server process, so the assertions below cannot pass vacuously on the old one.
    await expect
      .poll(
        async () => {
          const now = await serverIdentity(page);
          return now !== null && before !== null && (now.pid !== before.pid || now.startedAt !== before.startedAt);
        },
        { timeout: 150_000, intervals: [1_000] },
      )
      .toBe(true);
    await page.reload();

    // Both session cards survive and re-attach; alice is not duplicated.
    await expect(cardOf(page, leadSessionId)).toBeVisible({ timeout: 90_000 });
    await expect(cardOf(page, aliceSessionId)).toBeVisible({ timeout: 90_000 });
    await expect(cardOf(page, aliceSessionId)).toHaveCount(1);

    // The team converges to bridge truth: nobody stays `disconnected`/`spawning` after the reconcile grace.
    await expect
      .poll(
        async () => {
          const snap = await snapshot(page, teamId);
          const alice = memberOf(snap, "alice");
          return `${snap.status}:${alice?.status}`;
        },
        { timeout: 150_000, intervals: [2_000], message: "REST snapshot converges after the restart" },
      )
      .toMatch(/^(active|orphaned):(idle|busy)$/);
    const converged = await snapshot(page, teamId);
    expect(converged.members.filter((m) => m.name === "alice")).toHaveLength(1);
    expect(memberOf(converged, "alice")?.sessionId).toBe(aliceSessionId); // re-bound, not respawned
  });
});
