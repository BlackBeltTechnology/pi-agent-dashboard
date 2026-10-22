import { expect, test } from "./fixtures.js";
import { ensureGitSession, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";
import {
  fileViewUrl,
  forceTtMode,
  installTtProbe,
  readTtProbe,
  removeFile,
  seedFile,
  TT_LAUNCH_ARGS,
} from "./helpers/trusted-types.js";
import { MERMAID_GALLERY_DIAGRAMS, MERMAID_GALLERY_MD } from "./helpers/tt-fixtures.js";

// Trusted Types `default`-policy cost (change: harden-client-sinks, test-plan #P1).
// Metric: the sum of time spent inside `default`-policy callbacks per page load
// under TT `enforce`, median of 5 runs, ≤ 20 ms — on the mermaid gallery and on
// a session chat that renders mermaid. Over budget → the phase blocks (no silent
// `htmlLabels:false`). Exemplar: tests/e2e/csp.spec.ts.

test.use({ serviceWorkers: "block", launchOptions: { args: TT_LAUNCH_ARGS } });

const GALLERY = "tt-perf-gallery.md";
const BUDGET_MS = 20;
const RUNS = 5;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

test.beforeAll(() => seedFile(GALLERY, MERMAID_GALLERY_MD));
test.afterAll(() => removeFile(GALLERY));

test.describe("Trusted Types default-policy cost (P1)", () => {
  test("mermaid gallery: median default-policy time ≤ 20 ms", async ({ page }) => {
    test.setTimeout(300_000);
    await installTtProbe(page);
    await ensureGitSession(page);
    await forceTtMode(page, "enforce");
    const samples: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      await page.goto(fileViewUrl(GALLERY));
      await expect(page.locator(".mermaid-diagram-inner")).toHaveCount(MERMAID_GALLERY_DIAGRAMS.length, { timeout: 60_000 });
      await page.waitForTimeout(500);
      samples.push((await readTtProbe(page)).defaultMs);
    }
    console.log(`[tt-perf] gallery default-policy ms: ${samples.map((s) => s.toFixed(1)).join(", ")}`);
    expect(median(samples)).toBeLessThanOrEqual(BUDGET_MS);
  });

  test("session chat with mermaid: median default-policy time ≤ 20 ms", async ({ page }) => {
    test.setTimeout(300_000);
    await installTtProbe(page);
    const card = await spawnFreshGitSession(page);
    const sid = await card.getAttribute("data-session-id");
    await card.click();
    await sendPrompt(page, "[[faux:mermaid-sanitize-types]] go");
    await expect(page.locator(".mermaid-diagram svg")).toHaveCount(4, { timeout: 45_000 });
    await forceTtMode(page, "enforce");
    const samples: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      await page.goto(`/session/${sid}`);
      await expect(page.locator(".mermaid-diagram svg")).toHaveCount(4, { timeout: 45_000 });
      await page.waitForTimeout(500);
      samples.push((await readTtProbe(page)).defaultMs);
    }
    console.log(`[tt-perf] chat default-policy ms: ${samples.map((s) => s.toFixed(1)).join(", ")}`);
    expect(median(samples)).toBeLessThanOrEqual(BUDGET_MS);
  });
});
