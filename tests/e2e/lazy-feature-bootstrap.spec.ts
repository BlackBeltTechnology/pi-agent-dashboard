import { expect, type Page, test } from "./fixtures.js";
import { byTestId, gotoDashboard, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";
import { BASE_URL } from "./lifecycle.js";

// Browser E2E for change `add-lazy-terminal-diff-bootstrap`.
//
// WHAT LIVES HERE vs L1: the chunk REACHABILITY property (feature chunks absent
// from the entry document, matcher anchoring, chunk partition) is pinned at L1
// by `packages/client/src/__tests__/lazy-feature-preload.test.ts`, because it is
// a build-artifact property and needs no browser. What needs a real browser is
// the RUNTIME claim: a cold landing must not *fetch* the terminal/diff chunks,
// and the activation latch must fire them exactly once.
//
// See test-plan: F1 (cold landing), F4 (latch fires), F5 (latch sticky), P1
// (root JS transfer budget).

/** Feature-chunk request paths. Anchored on the basename so `jsdiff-*.js` (the
 *  npm `diff` chunk, deliberately eager on the chat path) does NOT match. */
const FEATURE_CHUNK_RE = /\/assets\/(xterm|diff)-[^/]*\.(js|css)$/;

/** Match only the xterm JS chunk (the "was the terminal code fetched" signal). */
const XTERM_JS_RE = /\/assets\/xterm-[^/]*\.js$/;
/** The git-diff-view JS chunk (the rich diff). Note `jsdiff-*.js` must NOT match. */
const DIFF_JS_RE = /\/assets\/diff-[^/]*\.js$/;
const XTERM_ALL_RE = /\/assets\/xterm-[^/]*\.(js|css)$/;

function collectChunkRequests(page: Page, re: RegExp): string[] {
  const hits: string[] = [];
  page.on("request", (req) => {
    let pathname: string;
    try {
      pathname = new URL(req.url()).pathname;
    } catch {
      return;
    }
    if (re.test(pathname)) hits.push(pathname);
  });
  return hits;
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

test.describe("lazy feature bootstrap — cold landing excludes terminal + diff code", () => {
  test("F1 · a cold landing with no terminal/diff surface fetches neither chunk", async ({ page }) => {
    const hits = collectChunkRequests(page, FEATURE_CHUNK_RE);

    await gotoDashboard(page);
    await expect(byTestId(page, "headerAppBar")).toBeVisible();
    await page.waitForLoadState("networkidle");

    // The whole point of the change: neither feature family is reachable from
    // the landing document, so nothing requests it before a surface opens.
    expect(hits, `feature chunks fetched on landing:\n${hits.join("\n")}`).toEqual([]);
  });

  test("F4 · activating a terminal tab fetches the xterm chunk exactly once", async ({ page }) => {
    const xtermJs = collectChunkRequests(page, XTERM_JS_RE);

    const card = await spawnFreshGitSession(page);
    await card.click();

    // Open the split so the EditorPane (with the + Terminal control) mounts.
    await page.getByTestId("layout-mode-switch").waitFor({ state: "visible", timeout: 30_000 });
    await robustClick(page, "layout-mode-split");
    await expect(page.getByTestId("split-editor-pane")).toBeVisible();

    // D3: opening the pane alone must not latch — no terminal code yet.
    expect(xtermJs, "xterm fetched before any terminal was opened").toEqual([]);

    // + Terminal creates + ACTIVATES a terminal (session-split branch keeps
    // activation) → the latch fires → the lazy layer mounts → one chunk fetch.
    await robustClick(page, "new-terminal-launch");
    await expect(page.getByRole("textbox", { name: /terminal input/i }).first()).toBeVisible({
      timeout: 30_000,
    });

    expect(xtermJs.length, `xterm JS requests: ${xtermJs.join(", ")}`).toBe(1);
  });
});

// P1 / task 8.1 — the measured budget. Method-consistent with the committed
// baseline in `tasks.md`: parse the served entry document, sum the RAW bytes of
// the entry script + every modulepreload JS. The harness serves uncompressed
// assets, so the comparison unit is raw bytes exactly as the baseline recorded
// it (7957.0 KB raw on `develop`).
const BASELINE_RAW_BYTES = 7957.0 * 1024;
const MIN_REDUCTION = 0.15;

test.describe("lazy feature bootstrap — root JS transfer budget (P1)", () => {
  test("P1 · root JS transfer is at least 15% below the committed baseline", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/`);
    expect(res.ok()).toBeTruthy();
    const html = await res.text();

    const refs = new Set<string>();
    for (const m of html.matchAll(/<script\b[^>]*>/gi)) {
      if (!/type="module"/i.test(m[0])) continue;
      const src = /src="([^"]+)"/i.exec(m[0])?.[1];
      if (src) refs.add(src);
    }
    for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
      if (!/rel="modulepreload"/i.test(m[0])) continue;
      const href = /href="([^"]+)"/i.exec(m[0])?.[1];
      if (href) refs.add(href);
    }
    expect(refs.size, "entry document must reference its eager JS").toBeGreaterThan(0);

    let total = 0;
    for (const ref of refs) {
      const r = await request.get(`${BASE_URL}${ref}`);
      expect(r.ok(), `failed to fetch eager asset ${ref}`).toBeTruthy();
      total += (await r.body()).length;
    }

    const reduction = (BASELINE_RAW_BYTES - total) / BASELINE_RAW_BYTES;
    // Report the measured number so a failure is diagnosable, not just "false".
    expect(
      reduction,
      `root JS transfer ${(total / 1024).toFixed(1)} KB vs baseline ${(BASELINE_RAW_BYTES / 1024).toFixed(1)} KB = ${(reduction * 100).toFixed(1)}% reduction`,
    ).toBeGreaterThanOrEqual(MIN_REDUCTION);
  });
});

// ---------------------------------------------------------------------------
// Diff lazy boundaries (F13/F14), inline-terminal carve-out (F15), and error
// containment under a failing chunk fetch (X1).
// ---------------------------------------------------------------------------

test.describe("lazy feature bootstrap — diff boundaries + fetch faults", () => {
  test("F13 · the diff pseudo-tab fetches the diff chunk lazily and renders", async ({ page }) => {
    test.setTimeout(180_000);
    const diffJs = collectChunkRequests(page, DIFF_JS_RE);
    await page.setViewportSize({ width: 1400, height: 900 });

    const card = await spawnFreshGitSession(page);
    await card.click();
    await sendPrompt(page, "[[faux:tool-edit]] make an edit");

    // No diff code before a diff surface opens.
    const chip = page.getByTestId("changed-files-chip");
    await expect(chip).toBeVisible({ timeout: 60_000 });
    expect(diffJs, `diff chunk fetched before any diff surface: ${diffJs.join(", ")}`).toEqual([]);

    // Open the Changes rail, then the file's `diff:` viewer tab (F12).
    await chip.click();
    const rail = page.getByTestId("changes-rail-section");
    await expect(rail).toBeVisible({ timeout: 10_000 });
    await rail.getByText("example.ts").first().click();
    await expect(page.getByRole("tab").filter({ hasText: "diff" }).first()).toBeVisible({ timeout: 20_000 });

    // The chunk is fetched at that moment (F13).
    await expect
      .poll(() => diffJs.length, { timeout: 30_000, message: "diff chunk never fetched on diff open" })
      .toBeGreaterThan(0);
  });

  test("F14 · a mobile viewport stays jsdiff-only (no git-diff-view fetch)", async ({ page }) => {
    test.setTimeout(180_000);
    const diffJs = collectChunkRequests(page, DIFF_JS_RE);
    await page.setViewportSize({ width: 390, height: 844 });

    const card = await spawnFreshGitSession(page);
    await card.click();
    await sendPrompt(page, "[[faux:tool-edit]] make an edit");

    const chip = page.getByTestId("changed-files-chip");
    await expect(chip).toBeVisible({ timeout: 60_000 });
    // Chat renders the edit result (homegrown line list) with no rich-diff chunk.
    await expect(page.locator("div.font-mono").first()).toBeVisible({ timeout: 60_000 });
    expect(page.getByTestId("rich-diff")).toHaveCount(0);
    expect(diffJs, `mobile must stay jsdiff-only, got: ${diffJs.join(", ")}`).toEqual([]);
  });

  test("F15 · a transcript containing an inline terminal card DOES fetch the terminal chunk", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1400, height: 900 });
    const xterm = collectChunkRequests(page, XTERM_ALL_RE);

    const card = await spawnFreshGitSession(page);
    await card.click();
    const openBtn = page.getByTestId("open-inline-terminal-button");
    if (await openBtn.first().isVisible().catch(() => false)) {
      await openBtn.first().click();
    } else {
      await page.getByTestId("overflow-button").first().click();
      await page.getByTestId("overflow-menu").waitFor({ state: "visible", timeout: 10_000 });
      await page.getByTestId("overflow-menu").getByTestId("open-inline-terminal-button").click();
    }
    await expect(page.getByTestId("terminal-card").first()).toBeVisible({ timeout: 45_000 });

    // Cold reload replays a transcript that CONTAINS a terminal card, so (per
    // design D3b) the terminal chunk is legitimately fetched. This pins the
    // documented carve-out so a later change cannot silently regress it into an
    // untested assumption.
    await page.reload();
    await page.waitForLoadState("networkidle");
    expect(xterm.length, "inline-terminal history must still load xterm").toBeGreaterThan(0);
  });

  test("X1 · an aborted terminal chunk fetch is contained; the shell stays interactive", async ({ page }) => {
    await page.route("**/assets/xterm-*.js", (route) => route.abort());

    const card = await spawnFreshGitSession(page);
    await card.click();
    await page.getByTestId("layout-mode-switch").waitFor({ state: "visible", timeout: 30_000 });
    await robustClick(page, "layout-mode-split");
    await expect(page.getByTestId("split-editor-pane")).toBeVisible();
    await robustClick(page, "new-terminal-launch");

    // The lazy import rejects → the boundary contains it. The app must NOT blank.
    await expect(byTestId(page, "headerAppBar")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("split-editor-pane")).toBeVisible();
    await expect(page.getByRole("tab").first()).toBeVisible({ timeout: 20_000 });
  });

  test("F9 · the loading affordance fills the pane body (no collapse to ~0)", async ({ page }) => {
    // Gate the chunk without a fixed sleep: hold the route until released.
    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    await page.route("**/assets/xterm-*.js", async (route) => {
      await gate;
      await route.continue();
    });

    const card = await spawnFreshGitSession(page);
    await card.click();
    await page.getByTestId("layout-mode-switch").waitFor({ state: "visible", timeout: 30_000 });
    await robustClick(page, "layout-mode-split");
    const pane = page.getByTestId("split-editor-pane");
    await expect(pane).toBeVisible();
    const before = (await pane.boundingBox())?.height ?? 0;
    expect(before).toBeGreaterThan(100);

    await robustClick(page, "new-terminal-launch");
    // While suspended, measure the pane body: it must not collapse.
    const during = (await pane.boundingBox())?.height ?? 0;
    expect(Math.abs(during - before) / before, `before=${before} during=${during}`).toBeLessThan(0.05);

    release?.();
  });
});
