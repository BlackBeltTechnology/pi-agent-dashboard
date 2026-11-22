import crypto from "node:crypto";
import { BusClient } from "@blackbelt-technology/pi-dashboard-bus-client";
import type { SpawnResultBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { expect, type Locator, type Page, test } from "./fixtures.js";
import { inContainer, pinViaBus, unpinViaBus } from "./helpers/folder-collapse.js";
import { gotoDashboard } from "./helpers/index.js";
import { DASHBOARD_PORT } from "./lifecycle.js";

/**
 * Browser E2E — "Remove from sidebar" folder-menu item (#1118).
 *
 * Needs REAL rendering + a real pi process: the Cancel-first focus, the focus
 * trap, focus return to the menu trigger after the menu item that opened the
 * dialog has unmounted, and the live shutdown → folder-leaves-sidebar chain.
 * The decision logic (which sessions are listed, call ordering, fault
 * isolation) is unit-tested in `SessionList.remove-from-sidebar.test.tsx`.
 *
 * Uses a private folder so the shared container's fixture folders are never
 * removed from under sibling specs.
 *
 * Covers test-plan #S40, #S41, #S42. See change: sidebar-folder-ux.
 */

const CWD = "/root/e2e-remove-from-sidebar";

const trigger = (page: Page): Locator => page.getByTestId(`folder-actions-menu-${CWD}`).first();
const item = (page: Page): Locator => page.getByTestId("folder-menu-item-remove-from-sidebar");
const dialog = (page: Page): Locator => page.getByTestId("remove-from-sidebar-confirm");
const folderName = (page: Page): Locator => page.getByTestId(`folder-header-name-${CWD}`);

async function withBus<T>(fn: (client: BusClient) => Promise<T>): Promise<T> {
  const client = new BusClient({ host: "localhost", port: DASHBOARD_PORT });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    client.close();
  }
}

/** Spawn a real session in CWD (same approach as `session-reap.spec.ts`). */
async function spawnInCwd(): Promise<string> {
  return withBus(async (client) => {
    const before = new Set(client.read.sessions().map((s) => s.id));
    const requestId = crypto.randomUUID();
    const result = client.await<SpawnResultBrowserMessage>({ type: "spawn_result", requestId }, { timeout: 45_000 });
    client.send({ type: "spawn_session", cwd: CWD, requestId });
    const res = await result;
    expect(res.success, res.message).toBe(true);
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const fresh = client.read.sessions().find((s) => !before.has(s.id));
      if (fresh) return fresh.id;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error("no new session appeared after spawn_result success");
  });
}

async function liveSessionCount(): Promise<number> {
  return withBus(async (c) =>
    c.read.sessions().filter((s) => s.cwd === CWD && s.status !== "ended").length,
  );
}

async function openMenuItem(page: Page): Promise<void> {
  await expect(trigger(page)).toBeVisible({ timeout: 30_000 });
  await trigger(page).click();
  await expect(item(page)).toBeVisible({ timeout: 10_000 });
}

test.describe("remove from sidebar (#1118)", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    inContainer(`mkdir -p ${CWD}`);
    await pinViaBus(CWD);
    await gotoDashboard(page);
  });

  test.afterEach(async () => {
    await unpinViaBus(CWD);
    // End anything a test left running so the shared container stays small.
    await withBus(async (c) => {
      for (const s of c.read.sessions().filter((x) => x.cwd === CWD && x.status !== "ended")) {
        c.send({ type: "shutdown", sessionId: s.id });
      }
      await new Promise((r) => setTimeout(r, 300));
    });
  });

  // S40 — no live session: removal is immediate (no dialog) and the folder goes.
  test("S40: a folder with no live session is removed in one step, no dialog", async ({ page }) => {
    await openMenuItem(page);
    await expect(folderName(page)).toBeVisible();
    await item(page).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(folderName(page)).toHaveCount(0, { timeout: 30_000 });
  });

  // S40 — live session: confirm dialog with Cancel focused; confirm ends it and the folder leaves.
  test("S40: a live session needs confirmation, Cancel is focused, confirm ends it and the folder leaves", async ({ page }) => {
    await spawnInCwd();
    // Reload so the page's snapshot already holds the live session (a menu opened
    // before the WS frame lands would see "no live session" and skip the dialog).
    await gotoDashboard(page);
    await openMenuItem(page);
    await item(page).click();
    await expect(dialog(page)).toBeVisible();
    await expect(page.getByTestId("remove-from-sidebar-confirm-cancel")).toBeFocused();
    await page.getByTestId("remove-from-sidebar-confirm-action").click();
    await expect.poll(liveSessionCount, { timeout: 45_000 }).toBe(0);
    await expect(folderName(page)).toHaveCount(0, { timeout: 45_000 });
  });

  // S41 — real-browser focus: trapped in the dialog, returned to the trigger on close.
  test("S41: Tab stays inside the dialog and Escape returns focus to the menu trigger", async ({ page }) => {
    await spawnInCwd();
    // Reload so the page's snapshot already holds the live session (a menu opened
    // before the WS frame lands would see "no live session" and skip the dialog).
    await gotoDashboard(page);
    await openMenuItem(page);
    await item(page).focus();
    await page.keyboard.press("Enter");
    await expect(dialog(page)).toBeVisible();
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("Tab");
      await expect(dialog(page).locator(":focus")).toHaveCount(1);
    }
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    await expect(trigger(page)).toBeFocused();
    // Cancelled: the folder and its live session are untouched.
    expect(await liveSessionCount()).toBeGreaterThan(0);
  });

  // S42 — starting a session in a removed folder brings it back.
  test("S42: a new session in a removed folder restores it", async ({ page }) => {
    await openMenuItem(page);
    await item(page).click();
    await expect(folderName(page)).toHaveCount(0, { timeout: 30_000 });
    const id = await spawnInCwd();
    await expect(folderName(page)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(`[data-session-id="${id}"]`).first()).toBeVisible({ timeout: 30_000 });
  });
});
