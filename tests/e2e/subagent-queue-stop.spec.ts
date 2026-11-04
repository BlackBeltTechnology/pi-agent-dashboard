/**
 * L3 — queued subagents, per-subagent stop and the live "Max parallel
 * subagents" limit, against the REAL producer (harness pins
 * `@blackbelt-technology/pi-dashboard-subagents` 0.6.0).
 *
 * Driver: `[[faux:subagent-fanout-queued]]` emits THREE `Agent` calls in one
 * message; each child runs `subagent-slow-inner` (~6 s). With the producer's
 * `maxConcurrent: 1` (written to its settings file in the container) one child
 * runs and two wait as `queued`.
 *
 * Covers test-plan #F1 (queued cards + rows), #F2 (position update), #F3 (stop a
 * queued one), #F4 (stop the running one), #F5 (stop inside a burst group),
 * #F6/#F7 (global Save / Discard of the plugin field), #F8 (live apply).
 *
 * #F3/#F4 arm an `OperatorSession`: the stop route requires operate authority,
 * which the harness browser (docker bridge address) never has by trust alone.
 *
 * Harness: `dashboardPort` comes from `.pi-test-harness.json` via the
 * Playwright baseURL — never hardcode :18000. Exemplar:
 * `subagent-stop-finalize.spec.ts`.
 * See change: subagent-queue-visibility.
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";
import {
  readProducerSettings,
  readProducerSettingsRaw,
  restoreProducerSettings,
  writeProducerSettings,
} from "./helpers/subagent-producer-settings.js";
import { OperatorSession } from "./helpers/operator-session.js";

/** The stop route needs operate authority; the harness browser gets it only via a login session. */
const op = new OperatorSession();

const FINAL_TEXT = /fanout queued scenario complete/i;
const PROMPT = "[[faux:subagent-fanout-queued]] go";

/** Every `Agent` chat row (ToolCallStep root). */
const agentRows = (page: Page) => page.locator('[data-testid="tool-call-step"][data-tool-name="Agent"]');
/** The row whose card currently reads `#<n> in queue`. */
const queuedRow = (page: Page, n: number) =>
  agentRows(page).filter({ has: page.getByTestId("agent-queue-pill").getByText(`#${n} in queue`, { exact: true }) });
/** Rows whose card is running (the running card's activity row is always mounted). */
const runningRows = (page: Page) => agentRows(page).filter({ has: page.getByTestId("agent-activity-row") });

/** Open every collapsed burst group so its rows (and cards) are mounted. */
async function expandBursts(page: Page): Promise<void> {
  const groups = page.getByTestId("tool-burst-group");
  for (let i = 0; i < (await groups.count()); i++) {
    const g = groups.nth(i);
    if ((await g.getByTestId("tool-burst-body").count()) === 0) await g.getByTestId("tool-burst-header").click();
  }
}

/** Spawn a session, send the fan-out, and converge to 1 running + 2 queued (#F1 state). */
async function startQueuedFanout(page: Page): Promise<void> {
  const card = await spawnFreshGitSession(page);
  await card.click();
  await page.keyboard.press("Escape").catch(() => {});
  await sendPrompt(page, PROMPT);
  await expect(async () => {
    await expandBursts(page);
    await expect(queuedRow(page, 2)).toHaveCount(1, { timeout: 2_000 });
  }).toPass({ timeout: 90_000 });
  await expect(queuedRow(page, 1)).toHaveCount(1);
  await expect(runningRows(page)).toHaveCount(1);
}

/** Seconds shown by the run-time badge of `row` (`"<1s"` → 0). */
async function runSeconds(row: Locator): Promise<number> {
  const text = (await row.getByTestId("agent-run-time").innerText()).trim();
  if (text.startsWith("<1s")) return 0;
  const m = /^(\d+)s/.exec(text);
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
}

test.describe("queued subagents + per-subagent stop (L3)", () => {
  let originalProducer: string | null = null;

  test.beforeEach(() => {
    originalProducer = readProducerSettingsRaw();
    writeProducerSettings({ maxConcurrent: 1 });
  });
  test.afterEach(() => {
    restoreProducerSettings(originalProducer);
  });

  test("#F1/#F2 queued cards and rows, then the queue advances", async ({ page }) => {
    test.setTimeout(180_000);
    await startQueuedFanout(page);

    // #F1 — queued cards never spin; their rows read `queued · #n`.
    for (const n of [1, 2]) {
      const row = queuedRow(page, n);
      await expect(row.locator(".animate-spin")).toHaveCount(0);
      await expect(row.getByTestId("tool-row-status-label").first()).toHaveText(`queued · #${n}`);
      await expect(row.getByTestId("tool-row-status-queued").first()).toBeVisible();
    }

    // #F2 — the first child finishes: former #1 runs from ~0 s, former #2 becomes #1.
    await expect(queuedRow(page, 2)).toHaveCount(0, { timeout: 30_000 });
    await expect(queuedRow(page, 1)).toHaveCount(1);
    const fresh = runningRows(page).first();
    await expect(fresh).toBeVisible();
    expect(await runSeconds(fresh)).toBeLessThan(5);

    await expect(page.getByText(FINAL_TEXT).first()).toBeVisible({ timeout: 90_000 });
  });

  test("#F3/#F5 stopping a queued row removes only it; the turn keeps going", async ({ page, request, context }) => {
    test.setTimeout(180_000);
    await op.arm(request, context);
    await startQueuedFanout(page);
    const target = queuedRow(page, 2);
    const desc = (await target.innerText()).match(/faux queued child \d/)?.[0];
    expect(desc).toBeTruthy();

    await target.getByTestId("tool-stop-button").first().click();

    const stopped = agentRows(page).filter({ hasText: desc! });
    await expect(stopped.getByTestId("agent-stopped-note")).toHaveText("removed from queue · never started", {
      timeout: 15_000,
    });
    // The running child keeps running; the session was not aborted.
    await expect(runningRows(page)).toHaveCount(1);
    // #F5 — the burst group's own stop is still offered while the turn runs.
    const groups = page.getByTestId("tool-burst-group");
    if ((await groups.count()) > 0) {
      await expect(page.getByTestId("tool-burst-stop-button").first()).toBeVisible();
    }
    await expect(page.getByText(FINAL_TEXT).first()).toBeVisible({ timeout: 90_000 });
    // The burst group (and the rows' cards) collapse when the turn ends; the
    // collapsed row keeps its terminal status label.
    await expandBursts(page);
    await expect(stopped).toContainText("removed from queue");
  });

  test("#F4 stopping the running card frees its slot for the next one", async ({ page, request, context }) => {
    test.setTimeout(180_000);
    await op.arm(request, context);
    await startQueuedFanout(page);
    const running = runningRows(page).first();
    const desc = (await running.innerText()).match(/faux queued child \d/)?.[0];
    expect(desc).toBeTruthy();

    await running.getByTestId("agent-stop-button").click();

    const stopped = agentRows(page).filter({ hasText: desc! });
    await expect(stopped.getByTestId("agent-stopped-note")).toContainText("stopped by you", { timeout: 15_000 });
    // The former #1 gets the slot within 3 s.
    await expect(queuedRow(page, 2)).toHaveCount(0, { timeout: 3_000 });
    await expect(runningRows(page)).toHaveCount(1, { timeout: 3_000 });
    await expect(page.getByText(FINAL_TEXT).first()).toBeVisible({ timeout: 90_000 });
  });

  test("#F8 raising the limit starts both waiting subagents without a reload", async ({ page, context }) => {
    test.setTimeout(180_000);
    // Stage the settings edit first so the save is one click once the queue exists.
    const settings = await context.newPage();
    await settings.goto("/settings/plugins/subagents");
    const field = settings.getByTestId("subagents-max-concurrent");
    await expect(field).toBeVisible({ timeout: 30_000 });
    await field.fill("3");
    await field.blur();
    await expect(settings.getByTestId("settings-save-bar")).toBeVisible();

    await startQueuedFanout(page);
    await settings.getByTestId("save-btn").first().click();
    await expect(settings.getByTestId("settings-save-bar")).toBeHidden({ timeout: 20_000 });

    await expect(page.getByTestId("agent-queue-pill")).toHaveCount(0, { timeout: 3_000 });
    await expect(runningRows(page)).toHaveCount(3, { timeout: 3_000 });
    await settings.close();
  });
});

test.describe("Max parallel subagents on the global save state (L3)", () => {
  let originalProducer: string | null = null;

  test.beforeEach(() => {
    originalProducer = readProducerSettingsRaw();
  });
  test.afterEach(async ({ request }) => {
    // Re-pin the plugin config to the producer default, then put the file back verbatim.
    await request.post("/api/config/plugins/subagents", { data: { maxConcurrent: 4 } });
    restoreProducerSettings(originalProducer);
  });

  async function openField(page: Page): Promise<Locator> {
    await page.goto("/settings/plugins/subagents");
    const field = page.getByTestId("subagents-max-concurrent");
    await expect(field).toBeVisible({ timeout: 30_000 });
    return field;
  }

  test("#F6 an edit marks the page unsaved; global Save writes the producer file", async ({ page }) => {
    const field = await openField(page);
    const next = (await field.inputValue()) === "8" ? "9" : "8";
    await field.fill(next);
    await field.blur();
    await expect(page.getByTestId("settings-save-bar")).toBeVisible();
    // Nothing written before Save.
    expect(readProducerSettings().maxConcurrent).not.toBe(Number(next));

    await page.getByTestId("save-btn").first().click();
    await expect(page.getByTestId("settings-save-bar")).toBeHidden({ timeout: 20_000 });
    await expect.poll(() => readProducerSettings().maxConcurrent, { timeout: 10_000 }).toBe(Number(next));
  });

  test("#F7 global Discard reverts the field and writes nothing", async ({ page }) => {
    const field = await openField(page);
    const before = await field.inputValue();
    const fileBefore = readProducerSettingsRaw();
    await field.fill(before === "8" ? "9" : "8");
    await field.blur();
    await expect(page.getByTestId("settings-save-bar")).toBeVisible();

    await page.getByRole("button", { name: /discard/i }).last().click();
    await expect(field).toHaveValue(before);
    expect(readProducerSettingsRaw()).toBe(fileBefore);
  });
});
