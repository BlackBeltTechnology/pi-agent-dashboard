import { execFileSync } from "node:child_process";
import { expect, type Locator, type Page, test } from "./fixtures.js";
import { resolveContainer } from "./helpers/container-proc.js";
import { dismissToasts, FIXTURE_GIT, robustClick, spawnFreshGitSession } from "./helpers/index.js";

// Browser E2E — plugin editor-pane file handlers (change: add-editor-pane-file-handlers).
// Folds test-plan F1, F2, F3, F11, F12, X9 (tasks 8.26–8.28, 8.36, 8.37, 8.48).
//
// Drives the demo FIXTURE plugin's `.docx` edit handler (claim `demo/demo-docx`,
// gated by PI_DASHBOARD_FIXTURE_PLUGINS=1, which the docker harness sets). The
// handler is a plain textarea over the snapshot bytes (UTF-8), so the `.docx`
// fixture here is plain text — the built-in docx preview never mounts in
// handler mode. Its root `demo-file-handler` exposes `data-instance-id` (random
// per mount) so keep-alive = "same id" and remount = "new id".
//
// Fixture files are written OUT-OF-BAND (`docker exec` into the harness, user
// `pi`) under a per-test unique dir inside the session cwd (a claimed file must
// sit under the session cwd), and removed in afterEach — specs share one
// container + fixture repo. `spawnFreshGitSession` spawns in FIXTURE_GIT.
// Exemplars: editor-pane.spec.ts, tool-created-files.spec.ts, apply-fix-to-file.spec.ts.

const CLAIM = "demo/demo-docx";
const ORIGINAL = "original report body\n";

function sh(script: string, input?: string): string {
  return execFileSync("docker", ["exec", "-i", resolveContainer(), "sh", "-c", script], {
    encoding: "utf8",
    input: input ?? "",
    timeout: 30_000,
  }).trim();
}

/** Write `content` to `<FIXTURE_GIT>/<rel>` inside the container (out-of-band; no dashboard API). */
function writeOutOfBand(rel: string, content: string): void {
  sh(`mkdir -p "$(dirname '${FIXTURE_GIT}/${rel}')" && cat > '${FIXTURE_GIT}/${rel}'`, content);
}

function readOutOfBand(rel: string): string {
  return sh(`cat '${FIXTURE_GIT}/${rel}'`);
}

function existsOutOfBand(rel: string): boolean {
  return sh(`[ -f '${FIXTURE_GIT}/${rel}' ] && echo yes || echo no`) === "yes";
}

const handler = (page: Page, rel: string): Locator => page.locator(`[data-testid="demo-file-handler"][data-path$="${rel}"]`);
const textArea = (page: Page, rel: string): Locator => handler(page, rel).getByTestId("demo-file-handler-text");
const tab = (page: Page, rel: string): Locator => page.locator(`[data-testid="editor-tab"][data-tab-path="${rel}"]`);
const banner = (page: Page): Locator => page.getByTestId("changed-on-disk-banner");

async function instanceId(page: Page, rel: string): Promise<string> {
  const id = await handler(page, rel).getAttribute("data-instance-id");
  expect(id, "demo handler instance id").toBeTruthy();
  return id as string;
}

/** Deep-link `rel` into the session's editor pane (full page load — only before a handler holds edits). */
async function openFile(page: Page, sessionId: string, rel: string): Promise<void> {
  await page.goto(`/session/${sessionId}/editor?file=${encodeURIComponent(rel)}`);
  await expect(tab(page, rel)).toBeVisible({ timeout: 30_000 });
}

/** Select the demo handler mode on the ACTIVE tab and wait for its snapshot to load. */
async function enterHandlerMode(page: Page, rel: string, expected: string): Promise<void> {
  await expect(page.getByTestId("file-mode-switcher")).toBeVisible({ timeout: 30_000 });
  await robustClick(page, `file-mode-${CLAIM}`);
  await expect(textArea(page, rel)).toHaveValue(expected, { timeout: 30_000 });
}

/** Edit the handler → it reports dirty → the core frame mirrors `data-dirty="true"`. */
async function makeDirty(page: Page, rel: string, text: string): Promise<void> {
  await dismissToasts(page);
  await textArea(page, rel).fill(text);
  await expect(page.locator(`[data-testid="file-handler-instance"][data-dirty="true"]`)).toHaveCount(1);
}

test.describe("editor-pane file handlers (demo .docx handler)", () => {
  let dir = "";
  let report = "";

  test.beforeEach(async ({ page }) => {
    test.setTimeout(180_000);
    // Never let a beforeunload guard (unsaved handler edits) block a navigation.
    page.on("dialog", (d) => void d.accept().catch(() => {}));
    dir = `e2e-fh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    report = `${dir}/report.docx`;
    writeOutOfBand(report, ORIGINAL);
    writeOutOfBand(`${dir}/foo.ts`, "export const foo = 1;\n");
  });

  test.afterEach(() => {
    if (dir) sh(`rm -rf '${FIXTURE_GIT}/${dir}'`);
  });

  async function setup(page: Page): Promise<string> {
    const card = await spawnFreshGitSession(page);
    const sessionId = await card.getAttribute("data-session-id");
    expect(sessionId).toBeTruthy();
    return sessionId as string;
  }

  test("F1: keep-alive across a tab switch — same instance, edits kept", async ({ page }) => {
    const sessionId = await setup(page);
    await openFile(page, sessionId, `${dir}/foo.ts`);
    await openFile(page, sessionId, report); // tabs persist across the reload → both open
    await expect(tab(page, `${dir}/foo.ts`)).toBeVisible();
    await enterHandlerMode(page, report, ORIGINAL);

    await makeDirty(page, report, `${ORIGINAL}abc`);
    const id = await instanceId(page, report);
    const mounts = await handler(page, report).getAttribute("data-mount-count");

    await tab(page, `${dir}/foo.ts`).click();
    // Hidden, never unmounted.
    await expect(page.locator(`[data-testid="file-handler-instance"][data-visible="false"]`)).toHaveCount(1);
    await expect(handler(page, report)).toBeAttached();

    await tab(page, report).click();
    await expect(page.locator(`[data-testid="file-handler-instance"][data-visible="true"]`)).toHaveCount(1);
    expect(await instanceId(page, report)).toBe(id);
    await expect(handler(page, report)).toHaveAttribute("data-mount-count", mounts ?? "");
    await expect(textArea(page, report)).toHaveValue(`${ORIGINAL}abc`);
  });

  test("F2: closing and reopening the editor pane keeps the instance", async ({ page }) => {
    const sessionId = await setup(page);
    await openFile(page, sessionId, report);
    await enterHandlerMode(page, report, ORIGINAL);
    await makeDirty(page, report, `${ORIGINAL}pane-close edit`);
    const id = await instanceId(page, report);

    await dismissToasts(page);
    await page.getByTitle("Close editor", { exact: true }).first().click();
    await expect(page.getByTestId("split-editor-pane")).toHaveCount(0, { timeout: 15_000 });
    // The layer lives at the app shell: the instance survives the pane unmount.
    await expect(handler(page, report)).toBeAttached();
    await expect(page.locator(`[data-testid="file-handler-instance"][data-visible="false"]`)).toHaveCount(1);

    await robustClick(page, "layout-mode-split");
    await expect(page.locator(`[data-testid="file-handler-instance"][data-visible="true"]`)).toHaveCount(1, { timeout: 15_000 });
    expect(await instanceId(page, report)).toBe(id);
    await expect(textArea(page, report)).toHaveValue(`${ORIGINAL}pane-close edit`);
  });

  test("F3: switching to another session and back keeps the instance", async ({ page }) => {
    // Spawn B first: every spawn is a full navigation, which would drop a live instance.
    const cardB = await spawnFreshGitSession(page);
    const sessionB = await cardB.getAttribute("data-session-id");
    const sessionA = await setup(page);
    expect(sessionB).toBeTruthy();
    expect(sessionB).not.toBe(sessionA);

    await openFile(page, sessionA, report);
    await enterHandlerMode(page, report, ORIGINAL);
    await makeDirty(page, report, `${ORIGINAL}session-switch edit`);
    const id = await instanceId(page, report);

    const cardA = page.locator(`[data-testid="session-card-desktop"][data-session-id="${sessionA}"]`);
    const cardBLoc = page.locator(`[data-testid="session-card-desktop"][data-session-id="${sessionB}"]`);
    await dismissToasts(page);
    await cardBLoc.click();
    await expect(page).toHaveURL(new RegExp(`/session/${sessionB}`), { timeout: 15_000 });
    // A's instance is hidden (another session selected), never unmounted.
    await expect(page.locator(`[data-testid="file-handler-instance"][data-visible="false"]`)).toHaveCount(1, { timeout: 15_000 });
    await expect(handler(page, report)).toBeAttached();

    await dismissToasts(page);
    await cardA.click();
    await expect(page).toHaveURL(new RegExp(`/session/${sessionA}`), { timeout: 15_000 });
    await expect(page.locator(`[data-testid="file-handler-instance"][data-visible="true"]`)).toHaveCount(1, { timeout: 30_000 });
    expect(await instanceId(page, report)).toBe(id);
    await expect(textArea(page, report)).toHaveValue(`${ORIGINAL}session-switch edit`);
  });

  test("F11: own save never raises the changed-on-disk banner (touch during the in-flight save)", async ({ page }) => {
    const sessionId = await setup(page);
    await openFile(page, sessionId, report);
    await enterHandlerMode(page, report, ORIGINAL);
    await makeDirty(page, report, `${ORIGINAL}own save`);

    // Hold the overwrite request and touch the file out-of-band while it is in
    // flight — deterministic "touch during the save" (the watcher candidate
    // must wait for the tracked write and then match the saved bytes).
    let touched = false;
    await page.route("**/api/file/write-binary**", async (route) => {
      if (route.request().url().includes("mode=overwrite") && !touched) {
        touched = true;
        sh(`touch '${FIXTURE_GIT}/${report}'`);
        await new Promise((r) => setTimeout(r, 1_500)); // let the watch event reach the client mid-save
      }
      await route.continue();
    });

    await handler(page, report).getByTestId("demo-file-handler-save").click();
    // First overwrite of this instance → the claim's notice; proceed.
    await expect(page.getByTestId("file-handler-first-overwrite")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("file-handler-first-overwrite-overwrite").click();
    await expect(handler(page, report).getByTestId("demo-file-handler-status")).toHaveText(`saved: ${report}`, { timeout: 30_000 });
    expect(touched).toBe(true);
    await page.unroute("**/api/file/write-binary**");

    expect(readOutOfBand(report)).toBe(`${ORIGINAL}own save`.trim());
    await expect(page.locator(`[data-testid="file-handler-instance"][data-dirty="false"]`)).toHaveCount(1);
    // A second, post-save mtime-only touch: the content gate keeps the banner off.
    sh(`touch '${FIXTURE_GIT}/${report}'`);
    // Negative assertion: give the watcher + SETTLE_MS digest round-trip time to (not) fire.
    await page.waitForTimeout(4_000);
    await expect(banner(page)).toHaveCount(0);
  });

  test("F12: out-of-band rewrite of a dirty handler → banner; Cancel keeps edits; Refresh → confirm → remount", async ({ page }) => {
    const sessionId = await setup(page);
    await openFile(page, sessionId, report);
    await enterHandlerMode(page, report, ORIGINAL);
    await makeDirty(page, report, `${ORIGINAL}my edits`);
    const id = await instanceId(page, report);

    const AGENT = "rewritten by the agent\n";
    writeOutOfBand(report, AGENT);
    await expect(banner(page)).toBeVisible({ timeout: 30_000 });

    // Refresh → leave guard → Cancel: banner stays, same instance, edits kept.
    await dismissToasts(page);
    await banner(page).getByTestId("changed-refresh").click();
    await expect(page.getByTestId("file-handler-confirm")).toBeVisible();
    await page.getByTestId("file-handler-confirm-cancel").click();
    await expect(page.getByTestId("file-handler-confirm")).toHaveCount(0);
    await expect(banner(page)).toBeVisible();
    expect(await instanceId(page, report)).toBe(id);
    await expect(textArea(page, report)).toHaveValue(`${ORIGINAL}my edits`);

    // Refresh → confirm: remount (new instance id) with the on-disk content; banner clears.
    await dismissToasts(page);
    await banner(page).getByTestId("changed-refresh").click();
    await page.getByTestId("file-handler-confirm-action").click();
    await expect(textArea(page, report)).toHaveValue(AGENT, { timeout: 30_000 });
    expect(await instanceId(page, report)).not.toBe(id);
    await expect(banner(page)).toHaveCount(0, { timeout: 15_000 });
  });

  test("X9: overwrite after an out-of-band rewrite → 409 conflict dialog; Save as copy writes report.demo.docx", async ({ page }) => {
    const sessionId = await setup(page);
    await openFile(page, sessionId, report);
    await enterHandlerMode(page, report, ORIGINAL);
    const EDITS = `${ORIGINAL}conflicting edits`;
    await makeDirty(page, report, EDITS);

    const AGENT = "agent wrote this meanwhile\n";
    writeOutOfBand(report, AGENT);
    // Overwrite carries the snapshot sha1 → server 409 (the banner may or may not
    // have surfaced yet; the conflict token is independent of it).
    await dismissToasts(page);
    await handler(page, report).getByTestId("demo-file-handler-save").click();
    await expect(page.getByTestId("file-handler-first-overwrite")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("file-handler-first-overwrite-overwrite").click();

    const conflict = page.getByTestId("file-handler-conflict");
    await expect(conflict).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("file-handler-conflict-reload")).toBeVisible();
    await expect(page.getByTestId("file-handler-conflict-overwrite")).toBeVisible();
    // The handler still holds the edits while the dialog is open.
    await expect(textArea(page, report)).toHaveValue(EDITS);

    await page.getByTestId("file-handler-conflict-copy").click();
    await expect(conflict).toHaveCount(0);
    const copy = `${dir}/report.demo.docx`;
    await expect(handler(page, report).getByTestId("demo-file-handler-status")).toHaveText(`saved: ${copy}`, { timeout: 30_000 });
    expect(existsOutOfBand(copy)).toBe(true);
    expect(readOutOfBand(copy)).toBe(EDITS.trim());
    // The original keeps the out-of-band content; the edits are still open.
    expect(readOutOfBand(report)).toBe(AGENT.trim());
    await expect(textArea(page, report)).toHaveValue(EDITS);
  });
});
