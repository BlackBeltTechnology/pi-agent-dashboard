import { expect, type Locator, type Page, test } from "./fixtures.js";
import { launchFromNewTabMenu, robustClick, spawnFreshGitSession } from "./helpers/index.js";

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
