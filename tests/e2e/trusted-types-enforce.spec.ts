import { expect, type Page, test } from "./fixtures.js";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";
import {
  forceTtMode,
  installTtProbe,
  readTtProbe,
  removeFile,
  seedFile,
  TT_LAUNCH_ARGS,
} from "./helpers/trusted-types.js";
import { TT_SAMPLE_TS } from "./helpers/tt-fixtures.js";

// Trusted Types `enforce` run over library eval / worker paths
// (change: harden-client-sinks, test-plan #X6): the Monaco editor (a `.ts`
// file), the PDF viewer, a chat and plugin settings pages raise no page error
// with the `default` policy refusing script text and non-allowlisted script
// URLs. Results are recorded in docs/research/trusted-types-enforce-results.md.
// Exemplar: tests/e2e/csp.spec.ts.

test.use({ serviceWorkers: "block", launchOptions: { args: TT_LAUNCH_ARGS } });

const TS = "tt-enforce-sample.ts";
test.beforeAll(() => seedFile(TS, TT_SAMPLE_TS));
test.afterAll(() => removeFile(TS));

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

/** Walk the X6 routes in `mode`; return the page errors and the probe after each step. */
async function walk(page: Page, sid: string, mode: "off" | "enforce") {
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await forceTtMode(page, mode);
  const errors = collectErrors(page);
  const steps: Record<string, Awaited<ReturnType<typeof readTtProbe>>> = {};

  // Monaco: open a .ts file in the editor pane; the text must render.
  await page.goto(`/session/${sid}/editor?file=${encodeURIComponent(TS)}`);
  await expect(page.locator(".monaco-editor .view-lines")).toContainText("answer", { timeout: 45_000 });
  steps.editor = await readTtProbe(page);

  // PDF (pdf.js worker): page 1 renders in the editor pane.
  await page.goto(`/session/${sid}/editor?file=doc.pdf`);
  await expect(page.locator("canvas").first()).toBeAttached({ timeout: 45_000 });
  steps.pdf = await readTtProbe(page);

  // Chat with mermaid.
  await page.goto(`/session/${sid}`);
  await expect(page.locator(".mermaid-diagram svg").first()).toBeVisible({ timeout: 45_000 });
  steps.chat = await readTtProbe(page);

  // Plugin settings pages (a representative set; the budget spec covers all).
  for (const id of ["kb", "flows", "roles", "quota", "web-access"]) {
    await page.goto(`/settings/plugins/${id}`);
    await page.waitForTimeout(3_000);
  }
  steps.settings = await readTtProbe(page);
  page.removeAllListeners("pageerror");
  return { errors, steps };
}

test.describe("Trusted Types enforce (X6)", () => {
  test("Monaco, PDF, chat and plugin settings: no page error beyond the TT-off baseline", async ({ page }) => {
    test.setTimeout(420_000);
    await installTtProbe(page);
    const card = await spawnFreshGitSession(page);
    const sid = String(await card.getAttribute("data-session-id"));
    await card.click();
    await sendPrompt(page, "[[faux:mermaid-sanitize-types]] go");
    await expect(page.locator(".mermaid-diagram svg").first()).toBeVisible({ timeout: 45_000 });

    const off = await walk(page, sid, "off");
    const enf = await walk(page, sid, "enforce");
    for (const [step, p] of Object.entries(enf.steps)) {
      console.log(`[tt-enforce] ${step}: violations=${p.violations.length} defaultHits=${p.defaultHits}`);
      for (const v of p.violations) console.log(`[tt-enforce] violation ${JSON.stringify(v)}`);
    }
    const baseline = new Set(off.errors.map((e) => e.split("\n")[0]));
    console.log(`[tt-enforce] page errors off=${JSON.stringify([...baseline])}`);
    const fresh = enf.errors.filter((e) => !baseline.has(e.split("\n")[0]));
    expect(fresh, fresh.join("\n")).toEqual([]);
  });
});
