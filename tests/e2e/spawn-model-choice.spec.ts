import type { Page, WebSocket as PwWebSocket } from "@playwright/test";
import { connectBus, expect, test } from "./fixtures.js";
import { ensureFixtureGitGroup, FIXTURE_GIT, gotoDashboard } from "./helpers/index.js";

/**
 * L3 — spawn model · thinking · role choice through the rendered UI
 * (test-plan #F3, #F4). See change: add-spawn-model-choice.
 *
 * The harness seeds `~/.pi/agent/providers.json#roles` with every built-in role
 * → `faux/faux-1` (qa/fixtures/faux-roles.json), so `@fast` resolves to the
 * key-free faux model. Each test asserts BOTH halves: the browser's
 * `spawn_session` frame carries the pick verbatim (`@fast` / the model id), and
 * the spawned session converges on the concrete model the server resolved.
 * The harness has ACP agents configured; the folder choice is used with pi
 * selected (the default). Folder memory is cleared after each test.
 * Exemplars: directory-home.spec.ts, acp-spawn-picker.spec.ts.
 */

const CHOICE_KEY = `pi-dashboard:spawn-choice:${FIXTURE_GIT}`;

/** Collect browser→server `spawn_session` frames. */
function recordSpawnFrames(page: Page): Array<Record<string, unknown>> {
  const frames: Array<Record<string, unknown>> = [];
  page.on("websocket", (ws: PwWebSocket) => {
    ws.on("framesent", (f) => {
      if (typeof f.payload !== "string" || !f.payload.includes('"spawn_session"')) return;
      try {
        const msg = JSON.parse(f.payload) as Record<string, unknown>;
        if (msg.type === "spawn_session") frames.push(msg);
      } catch {
        /* non-JSON frame */
      }
    });
  });
  return frames;
}

/** Wait for a NEW live session in `cwd` and return its model. */
async function newSessionModel(before: Set<string>, cwd: string): Promise<string | undefined> {
  const bus = await connectBus();
  try {
    let model: string | undefined;
    await expect
      .poll(
        () => {
          const s = bus.read.sessions().find((x) => x.cwd === cwd && !before.has(x.id) && x.status !== "ended" && x.model);
          model = s?.model;
          return Boolean(s);
        },
        { timeout: 60_000 },
      )
      .toBe(true);
    return model;
  } finally {
    bus.close();
  }
}

async function sessionIds(): Promise<Set<string>> {
  const bus = await connectBus();
  try {
    return new Set(bus.read.sessions().map((s) => s.id));
  } finally {
    bus.close();
  }
}

test.afterEach(async ({ page }) => {
  await page.evaluate((k) => window.localStorage.removeItem(k), CHOICE_KEY).catch(() => {});
});

test.describe("spawn model choice (L3)", () => {
  test("F3: worktree dialog spawns on @fast; the session runs the role's concrete model", async ({ page }) => {
    test.setTimeout(180_000);
    const frames = recordSpawnFrames(page);
    await gotoDashboard(page);
    const body = await ensureFixtureGitGroup(page);
    await body.getByTestId("folder-spawn-worktree-btn").click();
    const chip = page.getByTestId("worktree-dialog-model-choice");
    await expect(chip).toBeVisible({ timeout: 30_000 });
    await chip.getByTestId("model-selector-button").click();
    await page.getByTestId("model-tab-role").click();
    await page.locator('[data-testid="role-row"][data-role="fast"]').click();
    await expect(chip.getByTestId("model-trigger-role-ref")).toContainText("@fast");

    const before = await sessionIds();
    await page.getByTestId("worktree-row-main").click();
    await expect.poll(() => frames.some((f) => f.model === "@fast" && f.cwd === FIXTURE_GIT), { timeout: 15_000 }).toBe(true);
    expect(await newSessionModel(before, FIXTURE_GIT)).toBe("faux/faux-1");
  });

  test("F4: folder New Session menu pick (role + thinking) is used by the main button; chevron is keyboard-reachable", async ({ page }) => {
    test.setTimeout(180_000);
    const frames = recordSpawnFrames(page);
    await gotoDashboard(page);
    const body = await ensureFixtureGitGroup(page);
    const chevron = body.getByTestId("folder-spawn-session-btn-chevron");
    await chevron.focus();
    await page.keyboard.press("ArrowDown");
    const menu = page.getByTestId("folder-spawn-session-btn-menu");
    await expect(menu).toBeVisible();
    const chip = menu.getByTestId("folder-spawn-session-btn-model-choice");
    // The harness catalogue does not list the faux model, so pick it through the
    // Role tab (`@fast` → faux/faux-1), then a thinking level.
    await chip.getByTestId("model-selector-button").click();
    await page.getByTestId("model-tab-role").click();
    await page.locator('[data-testid="role-row"][data-role="fast"]').click();
    await chip.getByTestId("model-selector-button").click();
    await page.locator('[data-testid="model-level-group"] [data-level="low"]').click();
    await expect(chip.getByTestId("model-trigger-role-ref")).toContainText("@fast");
    // Picking never spawns.
    expect(frames).toHaveLength(0);
    await page.keyboard.press("Escape");
    if (await menu.isVisible()) await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);

    const before = await sessionIds();
    await body.getByTestId("folder-spawn-session-btn").click();
    await expect.poll(() => frames.find((f) => f.cwd === FIXTURE_GIT)?.model, { timeout: 15_000 }).toBe("@fast");
    expect(frames.find((f) => f.cwd === FIXTURE_GIT)?.thinkingLevel).toBe("low");
    expect(await newSessionModel(before, FIXTURE_GIT)).toBe("faux/faux-1");
  });
});
