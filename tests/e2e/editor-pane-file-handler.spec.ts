import { execFileSync } from "node:child_process";
import { expect, type Locator, type Page, test } from "./fixtures.js";
import { resolveContainer } from "./helpers/container-proc.js";
import { FIXTURE_GIT, spawnFreshGitSession } from "./helpers/index.js";

// Browser E2E — plugin file-handler modes in the editor pane (change:
// add-editor-pane-file-handlers, test-plan F1–F3, F11, F12, X9).
//
// Drives the demo-plugin fixture's `.docx` edit claim `demo/docx` (loaded
// because the harness builds with PI_DASHBOARD_FIXTURE_PLUGINS=1, see
// docker/compose.test.yml). Its component is a textarea over the file's bytes
// that exposes `data-instance-id` (stable per mounted instance) and bumps
// `window.__demoHandlerMounts` on every (re)mount — so "same instance" is
// provable, not inferred from visibility.
//
// Files are seeded/rewritten OUT OF BAND inside the harness container (the way
// the agent would change them) and removed again in `afterEach`.
//
// Only a real browser can prove these: the page-level layer's survival across
// pane close / tab switch / session switch, the own-save banner convergence
// under a real file watch, and the conflict dialog against the real route.

const DESKTOP = { width: 1440, height: 900 } as const;
const DOCX = "report.docx";
const COPY = "report.demo.docx";
const ABS = (rel: string) => `${FIXTURE_GIT}/${rel}`;

/** Run a shell script inside the harness container (the file watcher's world). */
function inBox(script: string): string {
  return execFileSync("docker", ["exec", resolveContainer(), "sh", "-c", script], { encoding: "utf8" }).trim();
}
/** Seed or rewrite `rel` out of band (utf-8 text; `.docx` here is just bytes to the fixture handler). */
function writeOob(rel: string, text: string): void {
  inBox(`printf %s ${JSON.stringify(text)} > ${JSON.stringify(ABS(rel))} && chmod 666 ${JSON.stringify(ABS(rel))}`);
}
const readOob = (rel: string): string => inBox(`cat ${JSON.stringify(ABS(rel))}`);
const existsOob = (rel: string): boolean => inBox(`[ -e ${JSON.stringify(ABS(rel))} ] && echo y || echo n`) === "y";

test.afterEach(() => {
  inBox(`rm -f ${JSON.stringify(ABS(DOCX))} ${JSON.stringify(ABS(COPY))} ${JSON.stringify(ABS("report.demo-2.docx"))}`);
});

async function sessionIdOf(card: Locator): Promise<string> {
  const id = await card.getAttribute("data-session-id");
  if (!id) throw new Error("session card has no data-session-id");
  return id;
}

/** Deep-link the editor pane onto `rel` for the session (a fresh page load). */
async function openInPane(page: Page, sid: string, rel: string): Promise<void> {
  await page.goto(`/session/${sid}/editor?file=${encodeURIComponent(rel)}`);
  await expect(page.getByTestId("split-editor-pane").first()).toBeVisible({ timeout: 20_000 });
}

/** Select the demo handler mode for the active tab and wait for its textarea to load the file. */
async function enterHandlerMode(page: Page): Promise<{ text: Locator; instanceId: () => Promise<string | null> }> {
  await page.getByTestId("file-mode-demo/docx").click();
  const handler = page.getByTestId("demo-docx-handler");
  const text = page.getByTestId("demo-docx-text");
  await expect(handler).toBeAttached({ timeout: 20_000 });
  await expect(page.getByTestId("demo-docx-status")).toHaveText("ready", { timeout: 20_000 });
  return { text, instanceId: () => handler.getAttribute("data-instance-id") };
}

const mounts = (page: Page) => page.evaluate(() => (window as unknown as { __demoHandlerMounts?: number }).__demoHandlerMounts ?? 0);

async function showTree(page: Page): Promise<void> {
  const toggle = page.getByTestId("tree-toggle");
  if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
}

test.describe("editor pane file-handler modes", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    writeOob(DOCX, "original");
  });

  test("F1: a keep-alive handler survives a tab switch with its edits (no remount)", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await openInPane(page, await sessionIdOf(card), DOCX);
    const h = await enterHandlerMode(page);
    const id = await h.instanceId();
    await h.text.fill("abc");
    const before = await mounts(page);

    await showTree(page);
    await page.getByText("hello.txt", { exact: true }).first().click();
    await expect(page.getByText("hello from the sample-git fixture")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("editor-tab").filter({ hasText: DOCX }).click();

    await expect(h.text).toHaveValue("abc");
    expect(await h.instanceId()).toBe(id);
    expect(await mounts(page)).toBe(before);
  });

  test("F2: closing and reopening the editor pane keeps the instance and its edits", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await openInPane(page, await sessionIdOf(card), DOCX);
    const h = await enterHandlerMode(page);
    const id = await h.instanceId();
    await h.text.fill("dirty edit");
    const before = await mounts(page);

    await page.getByTestId("layout-mode-closed").click(); // Chat only: EditorPane unmounts
    await expect(page.getByTestId("split-editor-pane")).toHaveCount(0);
    await page.getByTestId("layout-mode-split").click();
    await expect(page.getByTestId("file-mode-switcher")).toBeVisible({ timeout: 15_000 });

    await expect(h.text).toBeVisible();
    await expect(h.text).toHaveValue("dirty edit");
    expect(await h.instanceId()).toBe(id);
    expect(await mounts(page)).toBe(before);
  });

  test("F3: switching to another session and back keeps the instance", async ({ page }) => {
    const cardB = await spawnFreshGitSession(page);
    const sidB = await sessionIdOf(cardB);
    const cardA = await spawnFreshGitSession(page);
    const sidA = await sessionIdOf(cardA);
    await openInPane(page, sidA, DOCX);
    const h = await enterHandlerMode(page);
    const id = await h.instanceId();
    await h.text.fill("session A edit");
    const before = await mounts(page);

    await page.locator(`[data-testid="session-card-desktop"][data-session-id="${sidB}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/session/${sidB}`), { timeout: 15_000 });
    await page.locator(`[data-testid="session-card-desktop"][data-session-id="${sidA}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/session/${sidA}`), { timeout: 15_000 });

    await expect(h.text).toBeVisible({ timeout: 15_000 });
    await expect(h.text).toHaveValue("session A edit");
    expect(await h.instanceId()).toBe(id);
    expect(await mounts(page)).toBe(before);
  });

  test("F11: the handler's own overwrite raises no changed-on-disk banner, even with a touch in flight", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await openInPane(page, await sessionIdOf(card), DOCX);
    const h = await enterHandlerMode(page);
    await h.text.fill("saved by handler");

    // A watch signal lands while the write is in flight.
    await Promise.all([page.getByTestId("demo-docx-save").click(), Promise.resolve().then(() => inBox(`touch ${JSON.stringify(ABS(DOCX))}`))]);
    await expect(page.getByTestId("demo-docx-status")).toHaveText("saved (overwrite)", { timeout: 20_000 });
    expect(readOob(DOCX)).toBe("saved by handler");

    // Settle (150 ms) + catch-up (1 s) windows have both passed: still no banner.
    await page.waitForTimeout(2_500);
    await expect(page.getByTestId("changed-on-disk-banner")).toHaveCount(0);
  });

  test("F12: an agent rewrite raises the banner; Refresh confirms, Cancel keeps banner and edits, confirm remounts", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await openInPane(page, await sessionIdOf(card), DOCX);
    const h = await enterHandlerMode(page);
    await h.text.fill("my unsaved edit");

    writeOob(DOCX, "agent rewrote this");
    const banner = page.getByTestId("changed-on-disk-banner");
    await expect(banner).toBeVisible({ timeout: 20_000 });
    const before = await mounts(page);

    // Cancel at the confirm → banner stays, edits kept, no remount.
    await banner.getByTestId("changed-refresh").click();
    const guard = page.getByTestId("file-handler-guard-dialog");
    await expect(guard).toBeVisible();
    await page.getByTestId("file-handler-guard-dialog-cancel").click();
    await expect(guard).toHaveCount(0);
    await expect(banner).toBeVisible();
    await expect(h.text).toHaveValue("my unsaved edit");
    expect(await mounts(page)).toBe(before);

    // Confirm → the handler remounts with the new content and the banner clears.
    await banner.getByTestId("changed-refresh").click();
    await page.getByTestId("file-handler-guard-dialog-discard").click();
    await expect(page.getByTestId("demo-docx-text")).toHaveValue("agent rewrote this", { timeout: 20_000 });
    await expect(banner).toHaveCount(0);
    expect(await mounts(page)).toBe(before + 1);
  });

  test("X9: saving over an agent rewrite shows the conflict dialog; the handler keeps its edits; Save as copy creates report.demo.docx", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await openInPane(page, await sessionIdOf(card), DOCX);
    const h = await enterHandlerMode(page);
    await h.text.fill("handler edit");

    writeOob(DOCX, "agent rewrite");
    await page.getByTestId("demo-docx-save").click();

    const dlg = page.getByTestId("file-handler-conflict-dialog");
    await expect(dlg).toBeVisible({ timeout: 20_000 });
    await expect(h.text).toHaveValue("handler edit");
    expect(readOob(DOCX)).toBe("agent rewrite"); // nothing written

    await page.getByTestId("file-handler-conflict-dialog-copy").click();
    await expect(dlg).toHaveCount(0);
    await expect.poll(() => existsOob(COPY), { timeout: 15_000 }).toBe(true);
    expect(readOob(COPY)).toBe("handler edit");
    expect(readOob(DOCX)).toBe("agent rewrite");
    await expect(page.getByText(/Saved a copy: report\.demo\.docx/)).toBeVisible();
    // The tab stays bound to the original file, still holding the edits.
    await expect(h.text).toHaveValue("handler edit");
  });
});
