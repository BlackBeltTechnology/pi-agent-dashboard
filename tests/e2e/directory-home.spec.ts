import { execFileSync } from "node:child_process";
import { expect, type Page, test } from "./fixtures.js";
import { ensureGitSession, FIXTURE_GIT, gotoDashboard, pinDirectory } from "./helpers/index.js";
import { harnessProject } from "./lifecycle.js";

// Mirror of packages/client/src/lib/folder-encoding.ts::encodeFolderPath — the
// web package does not export internals, and duplicating this 6-line pure fn is
// cheaper than widening its export surface for a test.
function encodeFolderPath(cwd: string): string {
  const bytes = new TextEncoder().encode(cwd);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Browser E2E — directory home page (change: add-directory-home-page).
//
// Drives the real sidebar "open" affordance → bare `/folder/:encodedCwd` home
// → centered prompt → spawn → auto-navigate round-trip against the Docker
// harness. The pinned folder is the baked git fixture (FIXTURE_GIT), pinned by
// `ensureGitSession`. The dedicated `folder-open-home-<cwd>` icon is DELETED by
// change add-folder-actions-menu (D3): the header ROW (`folder-home-row-<cwd>`)
// is the only open affordance, so these cases drive it directly (it is not in
// the shared TESTIDS map — the map is for static ids).

test.describe("directory home page", () => {
  // F1 — click-open → type → send → lands in a new session.
  test("open affordance → type → send → converges on a new /session/:id", async ({ page }) => {
    await ensureGitSession(page); // guarantees FIXTURE_GIT is pinned

    const openBtn = page.getByTestId(`folder-home-row-${FIXTURE_GIT}`);
    await expect(openBtn).toBeVisible({ timeout: 15_000 });
    await openBtn.click();

    // Bare directory home route.
    await expect(page).toHaveURL(new RegExp(`/folder/${encodeFolderPath(FIXTURE_GIT)}$`), {
      timeout: 15_000,
    });

    // Centered prompt: type + send spawns a session with initialPrompt.
    const composer = page.getByPlaceholder(/message/i).first();
    await composer.waitFor({ state: "visible", timeout: 15_000 });
    await composer.fill("hello");
    await page.getByTestId("send-button").click();

    // D6 — Tier-1 spawn correlation auto-navigates to the new session.
    await expect(page).toHaveURL(/\/session\/[^/]+$/, { timeout: 60_000 });

    // The first user prompt "hello" surfaces in the new session's transcript.
    await expect(page.getByText("hello", { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
  });
});

// F5 — mobile back from the home page pops to the predecessor (cards), proving
// the bare route is a depth-1 detail surface (D1a), not a dead depth-0 no-op.
// Setup (pin + spawn) runs at the default desktop viewport because
// `ensureGitSession` resolves the desktop session card; only then do we resize
// to a mobile viewport and exercise the mobile shell.
test.describe("directory home page (mobile)", () => {
  test("mobile back from the home page returns to the card list", async ({ page }) => {
    await ensureGitSession(page); // desktop viewport — guarantees FIXTURE_GIT is pinned

    // Switch to a mobile viewport: the MobileShell now drives depth.
    await page.setViewportSize({ width: 375, height: 800 });
    await gotoDashboard(page);

    // Depth-0 list panel shows the pinned folder row + its open affordance.
    const openBtn = page.getByTestId(`folder-home-row-${FIXTURE_GIT}`);
    await expect(openBtn).toBeVisible({ timeout: 15_000 });
    await openBtn.click();

    // Depth-1 detail: the directory home renders.
    await expect(page).toHaveURL(new RegExp(`/folder/${encodeFolderPath(FIXTURE_GIT)}$`), {
      timeout: 15_000,
    });
    await expect(page.getByTestId("directory-home")).toBeVisible({ timeout: 15_000 });

    // Trigger back → pops one depth to the card list at "/", not stuck on the
    // home page and not a depth-0 no-op.
    await page.goBack();
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
    await expect(page.getByTestId(`folder-home-row-${FIXTURE_GIT}`)).toBeVisible({
      timeout: 15_000,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fix-terminals-action-opens-terminal — the Terminals quick action now targets
// a terminal-focused editor entry (`?focus=terminal`), distinct from Editor,
// and the parameter is consumed once honoured. Folds test-plan F5–F9.
//
// SELF-ISOLATION: terminals are per-cwd and persist in the shared container, so
// these tests pin a UNIQUE fixture cwd per run — it starts with zero terminals,
// making the create path (F7) and the "no duplicate" deltas deterministic.
// ─────────────────────────────────────────────────────────────────────────────

/** Container id resolved from the compose project recorded in the harness state. */
let harnessContainerId: string | undefined;
function harnessContainer(): string {
  if (harnessContainerId) return harnessContainerId;
  // harnessProject() prefers PW_E2E_PROJECT (set by globalSetup) and only falls
  // back to the repo-root state file for a manual `docker/test-up.sh` run. Read
  // the file directly made this spec die with ENOENT on every CI shard, where
  // the state file lives in the throwaway workspace, not the checkout.
  const project = harnessProject();
  const id = execFileSync(
    "docker",
    ["ps", "-q", "--filter", `label=com.docker.compose.project=${project}`],
    { encoding: "utf8", timeout: 30_000 },
  )
    .trim()
    .split("\n")[0];
  if (!id) throw new Error(`no running container for compose project ${project}`);
  harnessContainerId = id;
  return id;
}

function inContainer(script: string): string {
  return execFileSync("docker", ["exec", harnessContainer(), "sh", "-c", script], {
    encoding: "utf8",
    timeout: 60_000,
  }).trim();
}

const FOCUS_TOKEN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const FOCUS_CWD = `/fixtures/e2e-terminal-focus-${FOCUS_TOKEN}`;
const FOCUS_ENC = encodeFolderPath(FOCUS_CWD);
const FOCUS_HOME_URL = new RegExp(`/folder/${FOCUS_ENC}$`);
const FOCUS_EDITOR_URL = new RegExp(`/folder/${FOCUS_ENC}/editor$`);

// F6 needs a file TREE, and `/api/file/tree` only serves a known-session cwd —
// so it runs on the fixture folder (which has a session) and asserts deltas.
const DIR_ENC = encodeFolderPath(FIXTURE_GIT);
const DIR_HOME_URL = new RegExp(`/folder/${DIR_ENC}$`);
const DIR_EDITOR_URL = new RegExp(`/folder/${DIR_ENC}/editor$`);

/** `term:`-tab locator (EditorTabs carries the stable D4 testids). */
function termTabs(page: Page) {
  return page.locator('[data-testid="editor-tab"][data-tab-path^="term:"]');
}

/** The active editor tab. */
function activeTab(page: Page) {
  return page.locator('[data-testid="editor-tab"][aria-selected="true"]');
}

async function dismissToasts(page: Page): Promise<void> {
  for (const btn of await page.getByRole("button", { name: "Dismiss" }).all()) {
    await btn.click().catch(() => {});
  }
}

/** Click a testid, dismissing overlapping spawn toasts and retrying until it lands. */
async function robustClick(page: Page, testid: string): Promise<void> {
  const target = page.getByTestId(testid);
  await expect(async () => {
    await dismissToasts(page);
    await target.click({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

/** Navigate to the bare directory home for this run's unique focus fixture. */
async function openFocusDirectoryHome(page: Page): Promise<void> {
  await gotoDashboard(page);
  const row = page.getByTestId(`folder-home-row-${FOCUS_CWD}`);
  // Bounded wait: a later test in this run reuses the pin from the first one.
  const present = await row
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!present) await pinDirectory(page, FOCUS_CWD);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();
  await expect(page).toHaveURL(FOCUS_HOME_URL, { timeout: 15_000 });
  await expect(page.getByTestId("directory-home")).toBeVisible({ timeout: 15_000 });
}

/** Reveal the editor pane's file-tree rail (its visible state persists). */
async function ensureTreeVisible(page: Page): Promise<void> {
  const toggle = page.getByTestId("tree-toggle");
  await expect(toggle).toBeVisible({ timeout: 20_000 });
  if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
}

/** Navigate to the bare directory home for the fixture folder (has a session). */
async function openFixtureDirectoryHome(page: Page): Promise<void> {
  await ensureGitSession(page);
  await gotoDashboard(page);
  const row = page.getByTestId(`folder-home-row-${FIXTURE_GIT}`);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();
  await expect(page).toHaveURL(DIR_HOME_URL, { timeout: 15_000 });
  await expect(page.getByTestId("directory-home")).toBeVisible({ timeout: 15_000 });
}

/** Click Terminals and wait for the terminal-focused entry to converge (≥1 tab). */
async function openTerminals(page: Page, editorUrl: RegExp): Promise<void> {
  await robustClick(page, "directory-home-open-terminals");
  await expect(page).toHaveURL(editorUrl, { timeout: 15_000 });
  await expect(termTabs(page).first()).toBeVisible({ timeout: 30_000 });
}

test.describe("terminal-focused editor entry", () => {
  test.setTimeout(120_000);

  test.beforeAll(() => {
    // A fresh cwd per run → zero terminals, so the create path is deterministic.
    inContainer(`mkdir -p ${FOCUS_CWD}`);
  });

  // F7 — Terminals lands on an active term: tab (create path on a clean cwd).
  test("F7: Terminals converges on exactly one active term: tab", async ({ page }) => {
    await openFocusDirectoryHome(page);
    await openTerminals(page, FOCUS_EDITOR_URL);
    await expect(termTabs(page)).toHaveCount(1);
    await expect(termTabs(page).first()).toHaveAttribute("aria-selected", "true");
  });

  // F8 — a second Terminals entry activates the existing terminal, never duplicates it.
  test("F8: a second Terminals entry reuses the existing terminal", async ({ page }) => {
    await openFocusDirectoryHome(page);
    await openTerminals(page, FOCUS_EDITOR_URL);
    // Back to the directory home (history holds the bare URL, not `?focus=terminal`).
    await page.goBack();
    await expect(page).toHaveURL(FOCUS_HOME_URL, { timeout: 15_000 });
    await openTerminals(page, FOCUS_EDITOR_URL);
    await expect(termTabs(page)).toHaveCount(1);
    await expect(termTabs(page).first()).toHaveAttribute("aria-selected", "true");
  });

  // F9 — Editor lands on the file editor and creates no terminal.
  test("F9: Editor lands on the file editor without creating a terminal", async ({ page }) => {
    await openFocusDirectoryHome(page);
    await openTerminals(page, FOCUS_EDITOR_URL);
    const n = await termTabs(page).count();
    await page.goBack();
    await expect(page).toHaveURL(FOCUS_HOME_URL, { timeout: 15_000 });
    await robustClick(page, "directory-home-open-editor");
    await expect(page).toHaveURL(FOCUS_EDITOR_URL, { timeout: 15_000 });
    expect(page.url()).not.toContain("focus");
    // The folder EditorPane mounted (its header controls are present).
    await expect(page.getByTestId("new-terminal-launch")).toBeVisible({ timeout: 20_000 });
    await expect(termTabs(page)).toHaveCount(n);
  });

  // F5 — the parameter is consumed with a REPLACE navigation (no history entry).
  test("F5: ?focus=terminal is stripped; Back returns to the directory home", async ({ page }) => {
    await openFocusDirectoryHome(page);
    await openTerminals(page, FOCUS_EDITOR_URL);
    expect(page.url()).not.toContain("focus");
    await page.goBack();
    await expect(page).toHaveURL(FOCUS_HOME_URL, { timeout: 15_000 });
    expect(page.url()).not.toContain("focus");
  });

  // F6 — a remount after consumption keeps the user's file tab and creates nothing.
  // Runs on the fixture folder so the file tree resolves (known-session cwd).
  test("F6: remount after consumption does not re-focus", async ({ page }) => {
    await openFixtureDirectoryHome(page);
    await openTerminals(page, DIR_EDITOR_URL);

    // Open a real fixture file from the tree → the file tab becomes active.
    await ensureTreeVisible(page);
    await page.getByText("hello.txt", { exact: true }).first().click();
    await expect(activeTab(page)).toHaveAttribute("data-tab-path", "hello.txt", { timeout: 30_000 });
    const n = await termTabs(page).count();

    // Remount the folder pane: out to the directory home, forward to the same
    // (now param-less) editor URL.
    await page.goBack();
    await expect(page).toHaveURL(DIR_HOME_URL, { timeout: 15_000 });
    await page.goForward();
    await expect(page).toHaveURL(DIR_EDITOR_URL, { timeout: 15_000 });

    await expect(activeTab(page)).toHaveAttribute("data-tab-path", "hello.txt", { timeout: 30_000 });
    await expect(termTabs(page)).toHaveCount(n, { timeout: 20_000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// add-folder-actions-menu — the folder header's trailing cluster is ONE control.
// Real geometry is the point here: opening must not bubble into the navigating
// header row, and the sheet-vs-popover choice is a live media-query decision
// jsdom cannot make. Covers test-plan F1, F2, F3, F4, F5, F6, F7.
// ─────────────────────────────────────────────────────────────────────────────
test.describe("folder actions menu", () => {
  const HOME_URL = new RegExp(`/folder/${encodeFolderPath(FIXTURE_GIT)}$`);

  /** The folder body only renders while expanded — a reliable expansion probe. */
  function folderBody(page: import("@playwright/test").Page) {
    return page.getByTestId(`folder-body-${FIXTURE_GIT}`);
  }

  async function seed(page: import("@playwright/test").Page) {
    await ensureGitSession(page);
    await expect(page.getByTestId(`folder-actions-menu-${FIXTURE_GIT}`)).toBeVisible({
      timeout: 15_000,
    });
  }

  // F1 — opening the menu neither navigates nor collapses.
  test("F1: opening the menu keeps the route and the expanded state", async ({ page }) => {
    await seed(page);
    await gotoDashboard(page);
    const trigger = page.getByTestId(`folder-actions-menu-${FIXTURE_GIT}`);
    await expect(folderBody(page)).toBeVisible({ timeout: 15_000 });
    const before = page.url();

    await trigger.click();
    await expect(page.getByTestId(`folder-actions-menu-panel-${FIXTURE_GIT}`)).toBeVisible();
    expect(page.url()).toBe(before);
    await expect(folderBody(page)).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  // F2 — the header row is the open affordance.
  test("F2: clicking the header row outside the trigger opens the home page", async ({ page }) => {
    await seed(page);
    await gotoDashboard(page);
    await page.getByTestId(`folder-header-leaf-${FIXTURE_GIT}`).click();
    await expect(page).toHaveURL(HOME_URL, { timeout: 15_000 });
  });

  // F3 — that navigation does not collapse the folder.
  test("F3: header-row navigation leaves the folder expanded", async ({ page }) => {
    await seed(page);
    await gotoDashboard(page);
    await expect(folderBody(page)).toBeVisible({ timeout: 15_000 });
    await page.getByTestId(`folder-home-row-${FIXTURE_GIT}`).click();
    await expect(page).toHaveURL(HOME_URL, { timeout: 15_000 });
    await expect(folderBody(page)).toBeVisible();
  });

  // F4 — the dedicated icon control is gone everywhere.
  test("F4: no folder-open-home node renders on a pinned folder", async ({ page }) => {
    await seed(page);
    await gotoDashboard(page);
    await expect(page.locator('[data-testid^="folder-open-home-"]')).toHaveCount(0);
  });

  // F5 / F6 / F7 — the sheet gates on the app's compound mobile predicate
  // (<768w OR <600h), reused verbatim, so a short-but-wide window is mobile too.
  for (const [label, width, height, form] of [
    ["F5: 375x900 narrow", 375, 900, "sheet"],
    ["F6: 1200x560 short-but-wide", 1200, 560, "sheet"],
    ["F7: 1200x900 desktop", 1200, 900, "popover"],
  ] as const) {
    test(`${label} presents a ${form}`, async ({ page }) => {
      await ensureGitSession(page); // desktop viewport for the setup
      await page.setViewportSize({ width, height });
      await gotoDashboard(page);

      const trigger = page.getByTestId(`folder-actions-menu-${FIXTURE_GIT}`);
      await expect(trigger).toBeVisible({ timeout: 15_000 });
      await trigger.click();

      const panel = page.getByTestId(`folder-actions-menu-panel-${FIXTURE_GIT}`);
      await expect(panel).toBeVisible({ timeout: 15_000 });
      await expect(panel).toHaveAttribute("data-menu-form", form);

      const box = await panel.boundingBox();
      if (!box) throw new Error("menu panel has no bounding box");
      if (form === "sheet") {
        // Full-width, flush to the viewport, and no horizontal overflow.
        expect(box.width).toBeGreaterThanOrEqual(width - 2);
        expect(box.x).toBeLessThanOrEqual(1);
        expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      } else {
        // A floating popover is narrower than the viewport, not a full-width sheet.
        expect(box.width).toBeLessThan(width / 2);
      }
    });
  }
});
