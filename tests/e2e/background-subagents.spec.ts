/**
 * L3 — background subagents in the chat and the composer dock, against the
 * REAL producer (harness pins `@blackbelt-technology/pi-dashboard-subagents`
 * 0.7.0, which adds `Agent({ run_in_background: true })`).
 *
 * Drivers: `[[faux:subagent-background]]` starts ONE background `Agent` whose
 * child runs `subagent-slow-inner` (~6 s); the parent turn ends at once while
 * the child runs on. `[[faux:subagent-background-mixed]]` starts one foreground
 * and one background `Agent` in the same message.
 *
 * Ghost rows (change fix-background-subagent-ghost-rows): #F13 a deferred end
 * under the force-shed injector; #X3/#F6 reconcile scenarios skip until the
 * harness pins producer 0.8.0.
 *
 * Covers test-plan #F6 (started card + own group), #F7 (two groups), #F8 (Open
 * watches the run), #F9 (mark survives reload), #X1 (Stop from the dock), #X3
 * (session ends mid-run).
 *
 * #X1 arms an `OperatorSession`: the stop route requires operate authority,
 * which the harness browser (docker bridge address) never has by trust alone.
 * #X3 ends the session with a RAW `kill -9` on its pid (as
 * `session-ended-orphan-heal.spec.ts` #F7 does): `force_kill` SIGTERMs first,
 * which lets the producer stop the background run itself on shutdown, so the
 * server's synthesized `session_ended` heal would never be needed.
 *
 * Harness: `dashboardPort` comes from `.pi-test-harness.json` via the
 * Playwright baseURL — never hardcode :18000. Exemplars:
 * `subagent-queue-stop.spec.ts`, `session-ended-orphan-heal.spec.ts`.
 * See change: show-background-subagents-in-dock.
 */
import type { Locator, Page } from "@playwright/test";
import { SUBAGENT_BACKGROUND_MIXED_TAIL, SUBAGENT_BACKGROUND_TAIL } from "../../qa/fixtures/faux-scenarios.js";
import { expect, test } from "./fixtures.js";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";
import { dropServerFrames } from "./helpers/drop-ws-frames.js";
import { droppedFrameCounters, setForceShed } from "./helpers/force-shed.js";
import { OperatorSession } from "./helpers/operator-session.js";

const op = new OperatorSession();

const BG_DESC = "faux background child";
const FG_DESC = "faux foreground child";

/** The dock's Processes lane (desktop layout). */
const processesLane = (page: Page) => page.getByTestId("composer-dock-lane-processes");

/** The dock row for `description`. */
const dockRow = (page: Page, description: string) =>
  processesLane(page).getByTestId("composer-dock-row").filter({ hasText: description });

/** Open the Processes lane body when it is collapsed. */
async function openProcesses(page: Page): Promise<void> {
  const lane = processesLane(page);
  await expect(lane).toBeVisible({ timeout: 60_000 });
  if ((await lane.getAttribute("data-open")) !== "true") await lane.locator('[data-dock-toggle="processes"]').click();
  await expect(lane).toHaveAttribute("data-open", "true");
}

/**
 * Mount the background `Agent` row's card: open its single-member burst group
 * when collapsed, then expand the row itself (a finished row is collapsed).
 */
async function startedCard(page: Page): Promise<Locator> {
  const card = page.getByTestId("agent-bg-started");
  const burst = page.getByTestId("tool-burst-group").filter({ hasText: BG_DESC }).first();
  const row = page.locator('[data-testid="tool-call-step"][data-tool-name="Agent"]').filter({ hasText: BG_DESC }).first();
  await expect(page.getByText(BG_DESC).first()).toBeVisible({ timeout: 60_000 });
  await expect(async () => {
    if (await card.isVisible()) return;
    // The lazy renderer chunk may still be loading inside an expanded row, so
    // give it a moment before toggling (a premature click would collapse it).
    if (await card.waitFor({ state: "visible", timeout: 1_000 }).then(() => true, () => false)) return;
    if ((await burst.count()) > 0 && (await burst.getByTestId("tool-burst-body").count()) === 0) {
      await burst.getByTestId("tool-burst-header").click();
    }
    await row.locator("button").first().click();
    await expect(card).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 30_000 });
  return card;
}

/** The started card's `ui:agent-card` root. */
const cardRoot = (card: Locator) => card.locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");

/** Spawn a session, send `prompt`, wait for the background row in the dock. Returns the session id. */
async function startBackground(page: Page, prompt = "[[faux:subagent-background]] go"): Promise<string> {
  const card = await spawnFreshGitSession(page);
  await card.click();
  await page.keyboard.press("Escape").catch(() => {});
  await sendPrompt(page, prompt);
  await openProcesses(page);
  await expect(dockRow(page, BG_DESC)).toHaveCount(1, { timeout: 60_000 });
  const id = /\/session\/([^/?#]+)/.exec(page.url())?.[1];
  expect(id, "session id from the URL").toBeTruthy();
  return decodeURIComponent(id!);
}

test.describe("background subagents (L3)", () => {
  test.beforeEach(async ({ page }) => {
    // The container seeds NO display prefs; without toolResults no Agent card body
    // renders. Send a COMPLETE prefs object (see pi-1-5-floor-smoke.spec.ts).
    const res = await page.request.patch("/api/preferences/display", {
      data: { reasoning: true, toolResults: true, toolCalls: { read: true, bash: true, edit: true, agent: true, generic: true } },
    });
    expect(res.ok()).toBeTruthy();
  });

  test("#F6 started card, own dock group, row leaves when the child ends", async ({ page }) => {
    test.setTimeout(180_000);
    await startBackground(page);

    const card = await startedCard(page);
    await expect(card).toContainText("Started in background");
    await expect(card.getByTestId("agent-bg-id")).toHaveText(/^bg-/);
    await expect(cardRoot(card).locator(".animate-spin")).toHaveCount(0);
    const cardHtml = await card.innerHTML();

    const lane = processesLane(page);
    await expect(lane).toContainText("1 background subagent");
    const row = dockRow(page, BG_DESC);
    await expect(row.getByRole("button", { name: /^Stop subagent / })).toBeVisible();
    await expect(row.getByRole("link", { name: /^Open subagent / })).toBeVisible();
    await expect(row).not.toContainText("tick-one");

    await expect(page.getByText(SUBAGENT_BACKGROUND_TAIL).first()).toBeVisible({ timeout: 60_000 });
    // The child (~6 s) ends: the row leaves; the card never changes.
    await expect(dockRow(page, BG_DESC)).toHaveCount(0, { timeout: 60_000 });
    expect(await (await startedCard(page)).innerHTML()).toBe(cardHtml);
  });

  test("#F7 a foreground and a background subagent sit in two groups", async ({ page }) => {
    test.setTimeout(180_000);
    await startBackground(page, "[[faux:subagent-background-mixed]] go");
    await expect(dockRow(page, FG_DESC)).toHaveCount(1, { timeout: 30_000 });

    const lane = processesLane(page);
    await expect(lane).toContainText("2 running");
    await expect(lane).toContainText("1 subagent · 1 background subagent");
    const headings = lane.getByTestId("composer-dock-group-heading");
    await expect(headings).toHaveText(["Subagent", "Background subagent"]);
    // One row under each heading, in that order.
    const order = await lane.evaluate((el, [fg, bg]) => {
      const nodes = [...el.querySelectorAll('[data-testid="composer-dock-group-heading"], [data-testid="composer-dock-row"]')];
      return nodes.map((n) =>
        n.getAttribute("data-testid") === "composer-dock-group-heading"
          ? `H:${n.textContent}`
          : n.textContent?.includes(fg) ? "fg" : n.textContent?.includes(bg) ? "bg" : "?",
      );
    }, [FG_DESC, BG_DESC]);
    expect(order).toEqual(["H:Subagent", "fg", "H:Background subagent", "bg"]);
    await expect(page.getByText(SUBAGENT_BACKGROUND_MIXED_TAIL).first()).toBeVisible({ timeout: 90_000 });
  });

  test("#F8 Open shows the background run's live timeline", async ({ page }) => {
    test.setTimeout(180_000);
    await startBackground(page);
    await dockRow(page, BG_DESC).getByRole("link", { name: /^Open subagent / }).click();
    await expect(page).toHaveURL(/\/session\/[^/]+\/subagent\/[^/]+/);
    await expect(page.getByText(/tick-one/).first()).toBeVisible({ timeout: 30_000 });
  });

  test("#F9 the background mark survives a reload", async ({ page }) => {
    test.setTimeout(180_000);
    await startBackground(page);
    await page.reload();
    await openProcesses(page);
    await expect(processesLane(page)).toContainText("1 background subagent", { timeout: 30_000 });
    await expect(dockRow(page, BG_DESC)).toHaveCount(1);
    await expect(await startedCard(page)).toContainText("Started in background");
  });

  test("#X1 Stop from the dock stops only the background subagent", async ({ page, request, context }) => {
    test.setTimeout(180_000);
    await op.arm(request, context);
    const aborts: string[] = [];
    page.on("websocket", (ws) => {
      ws.on("framesent", (f) => {
        const p = typeof f.payload === "string" ? f.payload : "";
        if (p.includes('"type":"abort"')) aborts.push(p);
      });
    });
    await startBackground(page);
    const card = await startedCard(page);
    const cardHtml = await card.innerHTML();

    const row = dockRow(page, BG_DESC);
    const href = await row.getByRole("link", { name: /^Open subagent / }).getAttribute("href");
    const stopResponse = page.waitForResponse((r) => r.url().endsWith("/api/plugins/subagents/stop"));
    await row.getByRole("button", { name: /^Stop subagent / }).click();
    expect((await stopResponse).ok()).toBe(true);
    await expect(dockRow(page, BG_DESC)).toHaveCount(0, { timeout: 15_000 });
    expect(aborts, "no session abort was sent").toEqual([]);
    expect(await (await startedCard(page)).innerHTML()).toBe(cardHtml);
    // The full-screen view shows the neutral stopped state.
    await page.goto(href!);
    await expect(page.getByTestId("subagent-stopped-note")).toBeVisible({ timeout: 30_000 });
  });

  test("#X3 the session ends mid-run: the row leaves, the view reads parent session ended", async ({ page }) => {
    test.setTimeout(240_000);
    const sessionId = await startBackground(page);
    const href = await dockRow(page, BG_DESC).getByRole("link", { name: /^Open subagent / }).getAttribute("href");
    expect(href).toBeTruthy();

    await page.evaluate(
      ([id]) => {
        const ws = new WebSocket(`ws://${location.host}/ws`);
        ws.onopen = () => ws.send(JSON.stringify({ type: "force_kill", sessionId: id }));
      },
      [sessionId],
    );
    await expect
      .poll(
        async () => {
          const r = await page.request.get("/api/sessions?status=all");
          return ((await r.json()).data as Array<{ id: string; status?: string }>).find((s) => s.id === sessionId)?.status;
        },
        { timeout: 60_000 },
      )
      .toBe("ended");

    await expect(dockRow(page, BG_DESC)).toHaveCount(0, { timeout: 60_000 });
    await page.goto(href!);
    await expect(page.getByText("parent session ended").first()).toBeVisible({ timeout: 30_000 });
  });
});

// ---------------------------------------------------------------------------
// Ghost rows: a subagent end survives back-pressure; reconcile clears ghosts.
// See change: fix-background-subagent-ghost-rows (tasks 5.2, 5.4, 5.5).
// ---------------------------------------------------------------------------
/** The producer the harness pins answers stops and the registry query from 0.8.0 on. */
const PRODUCER_RECONCILE_SKIP = "needs producer pi-dashboard-subagents >= 0.8.0 (stop verdicts + registry); harness pins 0.7.0";

test.describe("background subagent end under back-pressure (L3)", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeEach(async ({ page }) => {
    const res = await page.request.patch("/api/preferences/display", {
      data: { reasoning: true, toolResults: true, toolCalls: { read: true, bash: true, edit: true, agent: true, generic: true } },
    });
    expect(res.ok()).toBeTruthy();
  });
  test.afterEach(async ({ page }) => {
    // Process-wide injector: never leak `true` into the next spec.
    await setForceShed(page, false).catch(() => {});
  });

  test("#F13 the child ends while the socket sheds: the end is deferred, the row leaves", async ({ page }) => {
    test.setTimeout(180_000);
    await startBackground(page);
    const before = await droppedFrameCounters(page);
    // Saturate while the child (~6 s) is still running, so its end hits the shed branch.
    await setForceShed(page, true);
    await expect
      .poll(async () => (await droppedFrameCounters(page)).deferredSubagentFrames, { timeout: 60_000 })
      .toBeGreaterThanOrEqual(before.deferredSubagentFrames + 1);
    await setForceShed(page, false);
    await expect(dockRow(page, BG_DESC)).toHaveCount(0, { timeout: 5_000 });
    expect((await droppedFrameCounters(page)).deferredSubagentFrames).toBeGreaterThanOrEqual(1);
  });
});

test.describe("ghost background rows cleared by the session (L3, producer >= 0.8.0)", () => {
  test.beforeEach(async ({ page }) => {
    const res = await page.request.patch("/api/preferences/display", {
      data: { reasoning: true, toolResults: true, toolCalls: { read: true, bash: true, edit: true, agent: true, generic: true } },
    });
    expect(res.ok()).toBeTruthy();
  });

  /** Start a background child whose end frames never reach this page, and wait until it really ended. */
  async function ghost(page: Page): Promise<string> {
    await dropServerFrames(page, (f) =>
      f.type === "event" && (f.event?.eventType === "subagent_completed" || f.event?.eventType === "subagent_failed"),
    );
    const sessionId = await startBackground(page);
    await expect(page.getByText(SUBAGENT_BACKGROUND_TAIL).first()).toBeVisible({ timeout: 60_000 });
    // The child (~6 s) has ended in the session; the row is a ghost.
    await page.waitForTimeout(10_000);
    await expect(dockRow(page, BG_DESC)).toHaveCount(1);
    return sessionId;
  }

  test("#X3 /reload in the session clears the ghost row without a click", async ({ page }) => {
    test.skip(true, PRODUCER_RECONCILE_SKIP);
    test.setTimeout(240_000);
    await ghost(page);
    await sendPrompt(page, "/reload");
    await expect(dockRow(page, BG_DESC)).toHaveCount(0, { timeout: 60_000 });
  });

  test("#F6 after the ghost is cleared, a page reload shows no background row or count", async ({ page, request, context }) => {
    test.skip(true, PRODUCER_RECONCILE_SKIP);
    test.setTimeout(240_000);
    await op.arm(request, context);
    await ghost(page);
    await dockRow(page, BG_DESC).getByRole("button", { name: /^Stop subagent / }).click();
    await expect(dockRow(page, BG_DESC)).toHaveCount(0, { timeout: 15_000 });
    await page.reload();
    await openProcesses(page).catch(() => {});
    await expect(dockRow(page, BG_DESC)).toHaveCount(0);
    await expect(page.getByText(/background subagents?$/)).toHaveCount(0);
  });
});
