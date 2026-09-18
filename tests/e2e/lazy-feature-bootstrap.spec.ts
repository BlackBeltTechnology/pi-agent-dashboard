import { byTestId, gotoDashboard, spawnFreshGitSession } from "./helpers/index.js";
import { expect, test } from "./fixtures.js";
import { BASE_URL } from "./lifecycle.js";

/**
 * L3 cold-landing gate for change `add-lazy-terminal-diff-bootstrap`.
 *
 * F1 (manifest) — a cold landing whose default view has no terminal surface and
 * no diff surface must fetch neither the `@xterm/*` nor the `@git-diff-view/*`
 * chunk (JS or CSS). The static half of this property is pinned at L1 by the
 * build-output guard (`lazy-feature-preload.test.ts`); this spec proves the
 * runtime half — that the landing document neither module-preloads the chunks
 * nor fires a landing-time dynamic import that reaches them.
 *
 * WORKLOAD NOTE: the eager dependency graph is fixed when the landing document
 * parses, before any session is selected — the entry `<script>` + every
 * `<link rel="modulepreload">`. The landing route therefore measures exactly the
 * cold-landing graph F1/P1 target, without depending on the (harness-flaky)
 * spawn+chat-replay path. The chat-transcript surfaces themselves are covered by
 * the L1 keep-alive / boundary tests and the terminal-tab E2E spec.
 *
 * P1 (manifest) — root JS transfer ≥30% below the committed baseline (task 1.1).
 * "Root JS transfer" is defined in this change as the transferred bytes of the
 * landing document's eager JS graph — the entry script plus every
 * `<link rel="modulepreload">` — EXCLUDING the pre-existing, out-of-scope
 * per-feature vendor chunks `markdown-*` and `mdi-*` (both stay eager on the
 * chat path regardless of this change, and splitting them is an explicit
 * Non-Goal in design.md). Baseline on the develop build = 1_262_352 B; the 30%
 * ceiling is therefore 883_646 B.
 *
 * See change: add-lazy-terminal-diff-bootstrap (test-plan F1, P1; design D5/D6).
 */

const FEATURE_ASSET = /\/assets\/(?:xterm|diff)-/;
const BASELINE_ROOT_JS_BYTES = 1_262_352;

test.describe("lazy feature bootstrap — cold landing", () => {
  test.setTimeout(120_000);

  test("F1: the cold landing fetches no terminal/diff chunk", async ({ page }) => {
    const featureRequests: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (FEATURE_ASSET.test(url)) featureRequests.push(url);
    });

    await gotoDashboard(page);
    await expect(byTestId(page, "headerAppBar")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1_500);

    expect(
      featureRequests,
      `terminal/diff chunk(s) fetched on a cold landing:\n${featureRequests.join("\n")}`,
    ).toEqual([]);
  });

  test("P1: cold-landing root JS transfer is ≥30% below the committed baseline", async ({ page }) => {
    await gotoDashboard(page);
    await expect(byTestId(page, "headerAppBar")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1_000);

    const measured = await page.evaluate(() => {
      const excluded = /\/assets\/(?:markdown|mdi)-/;
      const eager = [
        ...Array.from(document.querySelectorAll('link[rel="modulepreload"]')).map(
          (l) => (l as HTMLLinkElement).href,
        ),
        ...Array.from(document.querySelectorAll('script[type="module"][src]')).map(
          (s) => (s as HTMLScriptElement).src,
        ),
      ];
      const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
      const selected = entries.filter((e) => eager.includes(e.name) && !excluded.test(e.name));
      return {
        total: selected.reduce((sum, e) => sum + (e.encodedBodySize || e.decodedBodySize || 0), 0),
        names: selected.map((e) => ({
          name: e.name.split("/").pop(),
          size: e.encodedBodySize || e.decodedBodySize || 0,
        })),
      };
    });

    const ceiling = Math.floor(BASELINE_ROOT_JS_BYTES * 0.7);
    const detail = measured.names.map((n) => `${n.name}=${n.size}`).join(" ");
    test
      .info()
      .annotations.push({
        type: "perf",
        description: `root JS transfer ${measured.total} B (baseline ${BASELINE_ROOT_JS_BYTES} B, ceiling ${ceiling} B); ${detail}`,
      });

    expect(
      measured.total,
      `root JS transfer ${measured.total} B is not ≥30% below baseline ${BASELINE_ROOT_JS_BYTES} B (ceiling ${ceiling} B); ${detail}`,
    ).toBeLessThanOrEqual(ceiling);
  });
});

/** The `@git-diff-view` JS chunk. Anchored on the basename so the npm `diff`
 *  chunk (`jsdiff-*.js`, deliberately eager on the chat path) does NOT match. */
const DIFF_JS = /\/assets\/diff-[^/]*\.js$/;

test.describe("lazy feature bootstrap — boundary failure containment", () => {
  test("X1: an aborted terminal chunk fetch is contained in the pane, not the app", async ({ page }) => {
    test.setTimeout(180_000);
    await page.route("**/assets/xterm-*.js", (route) => route.abort());

    const card = await spawnFreshGitSession(page);
    await card.click();
    await page.getByTestId("layout-mode-switch").waitFor({ state: "visible", timeout: 30_000 });
    await page.getByTestId("layout-mode-split").click();
    await expect(page.getByTestId("split-editor-pane")).toBeVisible();
    await page.getByTestId("new-terminal-launch").click();

    // The lazy `import()` REJECTS during render. The pane-local ErrorBoundary
    // must catch it: without one this escalates to the app-level boundary and
    // the surrounding shell goes with it.
    await expect(page.getByTestId("terminal-layer-error")).toBeVisible({ timeout: 30_000 });

    // The app is NOT blanked — shell, pane and tab strip stay mounted.
    await expect(byTestId(page, "headerAppBar")).toBeVisible();
    await expect(page.getByTestId("split-editor-pane")).toBeVisible();
    await expect(page.getByRole("tab").first()).toBeVisible({ timeout: 20_000 });
  });

  test("F13: the App diff route fetches the diff chunk lazily and mounts FileDiffView", async ({ page }) => {
    test.setTimeout(180_000);
    const diffJs: string[] = [];
    page.on("request", (req) => {
      try {
        if (DIFF_JS.test(new URL(req.url()).pathname)) diffJs.push(req.url());
      } catch {
        /* non-URL request */
      }
    });

    const card = await spawnFreshGitSession(page);
    const sessionId = await card.getAttribute("data-session-id");
    expect(sessionId, "spawned session must expose data-session-id").toBeTruthy();
    await card.click();

    // The chat surface alone must not pull diff code.
    expect(diffJs, `diff chunk fetched before any diff surface: ${diffJs.join(", ")}`).toEqual([]);

    // Reach the diff surface through the App-level route arm, which renders
    // `FileDiffView` directly — no Changes-rail dependency, so this stays
    // deterministic (the rail derives from the fixture's real working tree).
    await page.goto(`${BASE_URL}/session/${sessionId}/diff`);

    await expect(page.getByTestId("file-diff-view")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText("Loading diff…")).toHaveCount(0);
    await expect
      .poll(() => diffJs.length, { timeout: 30_000, message: "diff chunk never fetched on the diff route" })
      .toBeGreaterThan(0);
  });
});
