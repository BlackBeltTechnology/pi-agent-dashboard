import { byTestId, gotoDashboard } from "./helpers/index.js";
import { expect, test } from "./fixtures.js";

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
