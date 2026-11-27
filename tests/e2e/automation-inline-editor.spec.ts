import type { APIRequestContext } from "@playwright/test";
import { expect, type Locator, type Page, test } from "./fixtures.js";
import { ensureGitSession, FIXTURE_GIT } from "./helpers/index.js";

/**
 * L3 — the automation editor renders inline in the board (no modal): the folder
 * menu "New automation" item lands on the board's draft without leaving a
 * history entry that reopens it, the phone layout has no horizontal scroll,
 * and the two-column layout only appears when the editor itself is wide.
 *
 * Seeding: one definition through the create/delete REST endpoints (cron Feb
 * 31, never fires), name prefixed `iae-`; deleted on entry and in `afterAll`.
 *
 * See change: inline-automation-editor (test-plan #F10, #F12, #F14).
 */

const NAME = "iae-phone";
const CRON = "0 0 31 2 *";

/** base64url of the cwd — the automation overlay route's folder segment. */
function encodeFolder(cwd: string): string {
  return Buffer.from(cwd, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const BOARD_PATH = `/folder/${encodeFolder(FIXTURE_GIT)}/automations`;

async function deleteDefinition(request: APIRequestContext): Promise<void> {
  await request
    .delete(`/api/plugins/automation?scope=folder&cwd=${encodeURIComponent(FIXTURE_GIT)}&name=${NAME}`)
    .catch(() => undefined);
}

async function openEditor(page: Page): Promise<Locator> {
  await page.goto(BOARD_PATH);
  const board = page.getByTestId("automation-board");
  await expect(board).toBeVisible({ timeout: 25_000 });
  await board.getByTestId(`edit-${NAME}`).click({ timeout: 25_000 });
  const editor = board.getByTestId(`automation-editor-folder:${NAME}`);
  await expect(editor).toBeVisible();
  await expect(editor.getByTestId("editor-loading")).toHaveCount(0);
  return editor;
}

test.describe("automation inline editor", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(120_000);

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await ensureGitSession(page);
      await deleteDefinition(page.request);
      const res = await page.request.post("/api/plugins/automation/create", {
        data: {
          scope: "folder",
          cwd: FIXTURE_GIT,
          name: NAME,
          config: {
            on: { kind: "schedule", cron: CRON },
            action: { kind: "prompt", prompt: "./prompt.md" },
            model: "@fast",
            mode: "local",
            sandbox: "workspace-write",
            concurrency: "skip",
            visibility: "shown",
          },
          promptBody: "Summarise the day.",
        },
      });
      expect(res.ok(), `create ${NAME} failed: ${res.status()} ${await res.text()}`).toBe(true);
    } finally {
      await page.close();
    }
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      await deleteDefinition(page.request);
    } finally {
      await page.close();
    }
  });

  // test-plan #F10
  test("F10: closing the menu-opened draft does not reopen it on Back", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await ensureGitSession(page);
    await page.getByTestId(`folder-actions-menu-${FIXTURE_GIT}`).first().click();
    await page.getByTestId("folder-menu-item-new-automation").click();
    const draft = page.getByTestId("automation-draft");
    await expect(draft).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId("create-automation-dialog")).toHaveCount(0);
    // `?new=1` is consumed with replace on open.
    await expect(page).toHaveURL((u) => u.pathname === BOARD_PATH && !u.search.includes("new=1"));

    await expect(draft.getByTestId("editor-loading")).toHaveCount(0);
    await draft.getByTestId("editor-cancel").click();
    await expect(draft).toHaveCount(0);

    await page.getByTestId("automation-board-back").click();
    await expect(page).not.toHaveURL(/\/automations/);
    await page.goBack();
    await expect(page).not.toHaveURL(/new=1/);
    await expect(page.getByTestId("automation-draft")).toHaveCount(0);
  });

  // test-plan #F12
  test("F12: phone width has no horizontal scroll; planned triggers fold into one chip", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const editor = await openEditor(page);
    const board = page.getByTestId("automation-board");
    const card = page.getByTestId(`automation-def-${NAME}`);

    const overflow = async (l: Locator) => l.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(await overflow(board), "board scrolls horizontally").toBeLessThanOrEqual(1);
    expect(await overflow(card), "editing card scrolls horizontally").toBeLessThanOrEqual(1);

    const kinds = (await (await page.request.get("/api/plugins/automation/trigger-kinds")).json()) as {
      categories?: Array<{ status: string }>;
    };
    const planned = (kinds.categories ?? []).filter((c) => c.status === "planned").length;
    expect(planned, "harness advertises planned trigger kinds").toBeGreaterThan(0);
    await expect(editor.getByTestId("trigger-coming-soon")).toHaveText(`+${planned} coming soon`);
    const visiblePlanned = await editor
      .locator('[data-testid^="trigger-cat-"]:disabled')
      .evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent !== null).length);
    expect(visiblePlanned, "planned trigger pills still visible on a phone").toBe(0);
  });

  // test-plan #F14
  test("F14: two columns only when the editor container fits", async ({ page }) => {
    for (const [width, sideBySide] of [
      [1280, true],
      [700, false],
    ] as const) {
      await page.setViewportSize({ width, height: 900 });
      const editor = await openEditor(page);
      const trigger = (await editor.getByTestId("group-trigger").boundingBox())!;
      const action = (await editor.getByTestId("group-action").boundingBox())!;
      if (sideBySide) {
        expect(trigger.x, `@${width}: Trigger left of Action`).toBeLessThan(action.x);
        expect(action.x, `@${width}: Action starts right of Trigger`).toBeGreaterThanOrEqual(trigger.x + trigger.width - 1);
      } else {
        expect(action.y, `@${width}: Action stacked below Trigger`).toBeGreaterThanOrEqual(trigger.y + trigger.height - 1);
      }
    }
  });
});
