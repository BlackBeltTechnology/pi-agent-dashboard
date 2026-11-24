import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { Download } from "@playwright/test";
import { expect, type Locator, type Page, test } from "./fixtures.js";
import { resolveContainer } from "./helpers/container-proc.js";
import { chooseLayoutMode, FIXTURE_GIT, launchFromNewTabMenu, robustClick, spawnFreshGitSession } from "./helpers/index.js";

// Browser E2E — editor-pane chrome: pane bar + document bar, Search in the rail,
// bulk close and Search tabs (change: scope-anchor-editor-pane-controls,
// test-plan F12–F17). Fixture files come from docker/fixtures/sample-git; tabs
// are opened by deep link (`/session/:id/editor?file=`), which appends a tab.
//
// jsdom has no layout, so overflow, target sizes, the 640 px fold and "search
// does not cover the document" are only provable here with real boxes.

const DESKTOP = { width: 1440, height: 900 } as const;
const FILES = [
  "README.md",
  "hello.txt",
  "notes.md",
  "data.csv",
  "doc.pdf",
  "logo.png",
  "repair.md",
  "apply-fix.md",
  "flow.mmd",
  "mermaid-eof.md",
];

// `:visible` — the workspace renders more than one `split-editor-pane` host across layouts; only one is shown.
const pane = (page: Page) => page.locator('[data-testid="split-editor-pane"]:visible').first();

async function sessionWithPane(page: Page): Promise<string> {
  const card = await spawnFreshGitSession(page);
  const id = await card.getAttribute("data-session-id");
  if (!id) throw new Error("session card has no data-session-id");
  return id;
}

/** Deep-link `rel` into the session's pane; the persisted tab set accumulates across calls. */
async function openFile(page: Page, sid: string, rel: string): Promise<void> {
  await page.goto(`/session/${sid}/editor?file=${encodeURIComponent(rel)}`);
  await expect(pane(page)).toBeVisible({ timeout: 20_000 });
  await expect(pane(page).locator(`[data-testid="editor-tab"][data-tab-path="${rel}"]`)).toBeVisible({ timeout: 20_000 });
}

async function box(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error("no bounding box");
  return b;
}

test.describe("editor pane chrome", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP);
  });

  test("F12: with many tabs the strip scrolls and the pane-bar controls stay in the pane box", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    const sid = await sessionWithPane(page);
    for (const f of FILES) await openFile(page, sid, f);
    const p = pane(page);
    const tablist = p.getByRole("tablist").first();
    const overflow = await tablist.evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(overflow, "tab strip scrolls instead of pushing the controls out").toBe(true);
    const paneBox = await box(p);
    for (const id of ["new-tab-menu-toggle", "tab-search-toggle", "editor-pane-close"]) {
      const c = p.getByTestId(id);
      await expect(c).toBeVisible();
      const b = await box(c);
      expect(b.x).toBeGreaterThanOrEqual(paneBox.x - 1);
      expect(b.x + b.width).toBeLessThanOrEqual(paneBox.x + paneBox.width + 1);
    }
  });

  test("F13: every control is a ≥ 24 px target; the tab × shows on keyboard focus", async ({ page }) => {
    const sid = await sessionWithPane(page);
    await openFile(page, sid, "README.md");
    await openFile(page, sid, "hello.txt");
    const p = pane(page);
    const tooSmall = async (scope: Locator, selector: string) =>
      scope.locator(selector).evaluateAll((els) =>
        els
          .map((e) => e.getBoundingClientRect())
          .filter((r) => r.width > 0 && (r.width < 24 || r.height < 24))
          .map((r) => `${Math.round(r.width)}x${Math.round(r.height)}`),
      );

    expect(await tooSmall(p.getByTestId("pane-bar"), "button:not([disabled])")).toEqual([]);
    expect(await tooSmall(p.getByTestId("doc-bar"), "button")).toEqual([]);

    await robustClick(page, "new-tab-menu-toggle");
    expect(await tooSmall(page.getByRole("menu"), '[role="menuitem"]')).toEqual([]);
    await page.keyboard.press("Escape");

    await p.getByTestId("editor-tab").first().click({ button: "right" });
    expect(await tooSmall(page.getByTestId("tab-context-menu"), '[role="menuitem"]')).toEqual([]);
    await page.keyboard.press("Escape");

    await robustClick(page, "tab-search-toggle");
    expect(await tooSmall(page.getByTestId("tab-search-popover"), '[role="option"], button')).toEqual([]);
    await page.keyboard.press("Escape");

    const x = p.getByTestId("editor-tab").first().getByRole("button");
    await x.focus();
    await expect(x).toHaveCSS("opacity", "1");
  });

  test("F14: below 640 px the breadcrumb folds to … and Files keeps its label", async ({ page }) => {
    const sid = await sessionWithPane(page);
    await openFile(page, sid, "craft/AGENTS.md");
    const p = pane(page);
    const crumb = p.getByTestId("doc-breadcrumb");

    await page.setViewportSize({ width: 1800, height: 900 });
    await expect.poll(async () => (await box(p)).width, { timeout: 10_000 }).toBeGreaterThan(640);
    await expect(crumb).toContainText("craft");
    await expect(crumb).not.toContainText("…");
    await expect(p.getByTestId("tree-toggle")).toContainText("Files");

    await page.setViewportSize({ width: 900, height: 900 });
    await expect.poll(async () => (await box(p)).width, { timeout: 10_000 }).toBeLessThan(640);
    await expect(crumb).toContainText("…");
    await expect(crumb).not.toContainText("craft");
    await expect(p.getByTestId("tree-toggle")).toContainText("Files");
  });

  test("F15: Close all keeps a terminal on 'Close all but these 1' and its xterm still takes input", async ({ page }) => {
    const sid = await sessionWithPane(page);
    await openFile(page, sid, "README.md");
    await openFile(page, sid, "hello.txt");
    await launchFromNewTabMenu(page, "new-terminal-launch");
    const p = pane(page);
    await expect(p.getByRole("tab")).toHaveCount(3, { timeout: 30_000 });

    await robustClick(page, "tab-search-toggle");
    await page.getByTestId("tab-search-bulk-all").click();
    const dialog = page.getByTestId("bulk-close-confirm");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("bulk-close-list").locator("li")).toHaveCount(1);
    await dialog.getByTestId("bulk-close-keep").click();

    await expect(p.getByRole("tab")).toHaveCount(1);
    await expect(p.getByRole("tab").first()).toHaveAttribute("data-tab-path", /^term:/);
    const term = page.getByRole("textbox", { name: /terminal input/i }).first();
    await expect(term).toBeVisible({ timeout: 30_000 });
    await term.focus();
    await page.keyboard.type("echo chrome-ok");
    await expect(term).toBeFocused();
  });

  test("F16: Search sits beside the document in the rail and collapses again on Escape", async ({ page }) => {
    const sid = await sessionWithPane(page);
    await openFile(page, sid, "README.md");
    const p = pane(page);
    await expect(page.getByTestId("editor-rail")).toHaveCount(0); // collapsed by default
    const body = p.getByTestId("editor-pane-body");
    const before = await box(body);

    await page.keyboard.press("ControlOrMeta+Shift+F");
    const input = page.getByTestId("editor-search-input");
    await expect(input).toBeVisible();
    await input.fill("hello");
    const rail = await box(page.getByTestId("editor-rail"));
    const after = await box(body);
    expect(after.height, "the document keeps its height").toBeCloseTo(before.height, 0);
    expect(rail.x + rail.width, "the rail does not overlap the document").toBeLessThanOrEqual(after.x + 1);

    await input.press("Escape");
    await expect(page.getByTestId("editor-rail")).toHaveCount(0);
  });

  test("F17: Search tabs filters the open tabs and Enter activates the first match", async ({ page }) => {
    const sid = await sessionWithPane(page);
    for (const f of ["README.md", "hello.txt", "notes.md", "repair.md"]) await openFile(page, sid, f);
    const p = pane(page);
    await robustClick(page, "tab-search-toggle");
    const input = page.getByTestId("tab-search-input");
    await input.fill("re");
    const options = page.getByTestId("tab-search-option");
    await expect(options).toHaveCount(2);
    await input.press("Enter");
    await expect(page.getByTestId("tab-search-popover")).toHaveCount(0);
    await expect(p.locator('[data-testid="editor-tab"][aria-selected="true"]')).toHaveAttribute("data-tab-path", "README.md");
  });
});

// ── Unsaved built-in buffer guard (change: fix-file-link-editor-routing, test-plan #S59, #S60, #S62, #S79) ──
// A buffer is "dirty" once typed into in Edit mode; every leave point (tab ✕, pane ✕, Chat segment, bulk close,
// sidebar session switch) must ask Save / Discard / Cancel first. A `page.goto` reloads the page and drops the
// buffer, so tabs are opened first and the dirty edit is made last. Scratch files are written out of band in
// the harness container and removed again.
const GUARD = ["guard-a.md", "guard-b.md", "guard-c.md"];
const guardAbs = (rel: string) => `${FIXTURE_GIT}/${rel}`;
function inBox(script: string): string {
  return execFileSync("docker", ["exec", resolveContainer(), "sh", "-c", script], { encoding: "utf8" }).trim();
}
const readGuard = (rel: string): string => inBox(`cat ${JSON.stringify(guardAbs(rel))}`);

test.describe("unsaved built-in buffer guard", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    for (const f of GUARD) inBox(`printf %s DISK-${f} > ${JSON.stringify(guardAbs(f))} && chmod 666 ${JSON.stringify(guardAbs(f))}`);
  });
  test.afterEach(() => {
    inBox(`rm -f ${GUARD.map((f) => JSON.stringify(guardAbs(f))).join(" ")}`);
  });

  const tabOf = (page: Page, rel: string) => pane(page).locator(`[data-testid="editor-tab"][data-tab-path="${rel}"]`);
  const dialog = (page: Page) => page.getByTestId("unsaved-dialog");
  const monaco = (page: Page) => page.locator(".monaco-editor").first();

  /** Edit toggle + typed text: the active markdown tab is now dirty. */
  async function dirtyActiveTab(page: Page, text: string): Promise<void> {
    await page.getByTestId("md-edit-toggle").click();
    await monaco(page).click();
    await page.keyboard.type(text);
    await expect(page.getByTestId("md-dirty-dot")).toBeVisible();
  }
  const closeTabX = (page: Page, rel: string) => tabOf(page, rel).getByRole("button").click();

  test("S59: ✕ on a dirty tab asks; Cancel keeps text, Discard drops it, Save writes then closes; clean ✕ is silent", async ({ page }) => {
    const sid = await sessionWithPane(page);
    await openFile(page, sid, "guard-a.md");
    await dirtyActiveTab(page, "TYPED-1");

    await closeTabX(page, "guard-a.md");
    await expect(dialog(page)).toBeVisible();
    await page.getByTestId("unsaved-cancel").click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(tabOf(page, "guard-a.md")).toBeVisible();
    await expect(monaco(page)).toContainText("TYPED-1");

    await closeTabX(page, "guard-a.md");
    await page.getByTestId("unsaved-discard").click();
    await expect(tabOf(page, "guard-a.md")).toHaveCount(0);
    expect(readGuard("guard-a.md")).not.toContain("TYPED-1");
    await openFile(page, sid, "guard-a.md");
    await expect(pane(page)).toContainText("DISK-guard-a.md", { timeout: 20_000 });

    await dirtyActiveTab(page, "TYPED-2");
    await closeTabX(page, "guard-a.md");
    await page.getByTestId("unsaved-save").click();
    await expect(tabOf(page, "guard-a.md")).toHaveCount(0, { timeout: 20_000 });
    expect(readGuard("guard-a.md")).toContain("TYPED-2");

    // A clean tab closes without a dialog — including one that was just saved via the toolbar.
    await openFile(page, sid, "guard-a.md");
    await dirtyActiveTab(page, "TYPED-3");
    await page.getByTestId("md-save-btn").click();
    await expect(page.getByTestId("md-dirty-dot")).toHaveCount(0, { timeout: 20_000 });
    await closeTabX(page, "guard-a.md");
    await expect(dialog(page)).toHaveCount(0);
    await expect(tabOf(page, "guard-a.md")).toHaveCount(0);
  });

  test("S60: sidebar session switch is held until Save/Discard; Cancel keeps the buffer; clean switches at once", async ({ page }) => {
    const sid1 = await sessionWithPane(page);
    const card2 = await spawnFreshGitSession(page);
    const sid2 = await card2.getAttribute("data-session-id");
    if (!sid2) throw new Error("second session has no id");
    const card = (id: string) => page.locator(`[data-testid="session-card-desktop"][data-session-id="${id}"]`);

    await openFile(page, sid1, "guard-a.md");
    await dirtyActiveTab(page, "SWITCH-EDIT");
    await card(sid2).click();
    await expect(dialog(page)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/session/${sid1}`));
    await page.getByTestId("unsaved-cancel").click();
    await expect(page).toHaveURL(new RegExp(`/session/${sid1}`));
    await expect(monaco(page)).toContainText("SWITCH-EDIT");

    await card(sid2).click();
    await page.getByTestId("unsaved-discard").click();
    await expect(page).toHaveURL(new RegExp(`/session/${sid2}`), { timeout: 20_000 });

    // Clean buffer (back on session 1, nothing typed): switching is immediate.
    await card(sid1).click();
    await expect(page).toHaveURL(new RegExp(`/session/${sid1}`), { timeout: 20_000 });
    await card(sid2).click();
    await expect(page).toHaveURL(new RegExp(`/session/${sid2}`), { timeout: 20_000 });
    await expect(dialog(page)).toHaveCount(0);
    // The folder-pane variant of this guard is pinned at L1 (useSessionActions.no-focus.test.tsx): the store is page-level.
  });

  test("S62: pane ✕, the Chat segment and Close all ask when a buffer is dirty; Cancel leaves layout and tabs", async ({ page }) => {
    const sid = await sessionWithPane(page);
    await openFile(page, sid, "guard-b.md");
    await openFile(page, sid, "guard-c.md");
    await openFile(page, sid, "guard-a.md");
    await dirtyActiveTab(page, "PANE-EDIT");
    const p = pane(page);

    await robustClick(page, "editor-pane-close");
    await expect(dialog(page)).toBeVisible();
    await page.getByTestId("unsaved-cancel").click();
    await expect(p).toBeVisible();
    await expect(p.getByRole("tab")).toHaveCount(3);

    await chooseLayoutMode(page, "closed");
    await expect(dialog(page)).toBeVisible();
    await page.getByTestId("unsaved-cancel").click();
    await expect(p).toBeVisible();
    await expect(p.getByRole("tab")).toHaveCount(3);

    await robustClick(page, "tab-search-toggle");
    await page.getByTestId("tab-search-bulk-all").click();
    const bulk = page.getByTestId("bulk-close-confirm");
    await expect(bulk).toBeVisible();
    await expect(bulk.getByTestId("bulk-close-list")).toContainText("guard-a.md");
    await bulk.getByTestId("bulk-close-cancel").click();
    await expect(p.getByRole("tab")).toHaveCount(3);
    await expect(monaco(page)).toContainText("PANE-EDIT");
  });

  test("S79: the unsaved dialog focuses Cancel; Enter never discards; Escape / backdrop cancel; Tab reaches Discard and Save", async ({ page }) => {
    const sid = await sessionWithPane(page);
    await openFile(page, sid, "guard-a.md");
    await dirtyActiveTab(page, "KEY-EDIT");

    await closeTabX(page, "guard-a.md");
    await expect(dialog(page)).toBeVisible();
    await expect(page.getByTestId("unsaved-cancel")).toBeFocused();
    await page.keyboard.press("Enter"); // activates the focused Cancel, never Discard
    await expect(dialog(page)).toHaveCount(0);
    await expect(tabOf(page, "guard-a.md")).toBeVisible();
    await expect(monaco(page)).toContainText("KEY-EDIT");

    await closeTabX(page, "guard-a.md");
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    await expect(tabOf(page, "guard-a.md")).toBeVisible();
    await expect(monaco(page)).toContainText("KEY-EDIT");

    await closeTabX(page, "guard-a.md");
    await expect(dialog(page)).toBeVisible();
    await page.getByTestId("unsaved-dialog-overlay").click({ position: { x: 4, y: 4 } });
    await expect(dialog(page)).toHaveCount(0);
    await expect(monaco(page)).toContainText("KEY-EDIT");

    await closeTabX(page, "guard-a.md");
    await expect(page.getByTestId("unsaved-cancel")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("unsaved-discard")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("unsaved-save")).toBeFocused();
    await page.keyboard.press("Escape");
  });
});

// ── File download (change: add-file-download, test-plan #F12, #F13) ──
// The viewer More menu and the tree row menu both save the file under its
// basename with the exact bytes. `hello.txt` is a fixture file with known content.
test.describe("file download", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP);
  });

  const expectedBytes = (): string => inBox(`cat ${JSON.stringify(`${FIXTURE_GIT}/hello.txt`)}`);

  async function saved(download: Download): Promise<string> {
    const path = await download.path();
    if (!path) throw new Error("download has no saved path");
    return readFileSync(path, "utf8").trim();
  }

  test("F12: viewer More → Download saves hello.txt with its exact content", async ({ page }) => {
    const sid = await sessionWithPane(page);
    await openFile(page, sid, "hello.txt");
    const p = pane(page);
    await p.getByTestId("doc-more-menu").click();
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("doc-download").click()]);
    expect(download.suggestedFilename()).toBe("hello.txt");
    expect(await saved(download)).toBe(expectedBytes());
  });

  test("F13: tree row right-click → Download saves the file and leaves the tabs unchanged", async ({ page }) => {
    const sid = await sessionWithPane(page);
    await openFile(page, sid, "README.md");
    const p = pane(page);
    const tabsBefore = await p.getByTestId("editor-tab").count();
    await p.getByTestId("tree-toggle").click();
    const row = p.locator('[data-row="hello.txt"]');
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.click({ button: "right" });
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("tree-row-download").click()]);
    expect(download.suggestedFilename()).toBe("hello.txt");
    expect(await saved(download)).toBe(expectedBytes());
    await expect(p.getByTestId("editor-tab")).toHaveCount(tabsBefore);
  });
});
