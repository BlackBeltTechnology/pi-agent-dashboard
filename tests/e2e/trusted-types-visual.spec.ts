import { expect, type Page, test } from "./fixtures.js";
import { ensureGitSession } from "./helpers/index.js";
import {
  fileViewUrl,
  forceTtMode,
  installTtProbe,
  pixelDiff,
  readTtProbe,
  removeFile,
  seedFile,
  TT_LAUNCH_ARGS,
  type TtMode,
} from "./helpers/trusted-types.js";
import { MERMAID_GALLERY_DIAGRAMS, MERMAID_GALLERY_MD, TT_ADOC } from "./helpers/tt-fixtures.js";

// Trusted Types visual parity (change: harden-client-sinks, design D9).
//   F1 (test-plan #F1): every gallery diagram renders under TT `enforce` within
//       the run-to-run variance of two TT-`off` loads; flowchart default nodes
//       keep their accent tint.
//   F2 (test-plan #F2): AsciiDoc (headings, table, stem → KaTeX, mermaid) and
//       EML render identically off vs enforce, with 0 TT violations and the
//       EML frame still `sandbox=""`.
// The mode is forced per load by rewriting the document response (helpers/
// trusted-types.ts), so one harness boot covers off and enforce.
// Exemplars: tests/e2e/mermaid-colorize.spec.ts, tests/e2e/asciidoc-preview.spec.ts.

test.use({ serviceWorkers: "block", launchOptions: { args: TT_LAUNCH_ARGS } });

const GALLERY = "tt-mermaid-gallery.md";
const ADOC = "tt-preview.adoc";
const WASH = /rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0?\.08\s*\)/;

test.beforeAll(() => {
  seedFile(GALLERY, MERMAID_GALLERY_MD);
  seedFile(ADOC, TT_ADOC);
});
test.afterAll(() => {
  removeFile(GALLERY);
  removeFile(ADOC);
});

async function loadIn(page: Page, mode: TtMode, rel: string): Promise<void> {
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await forceTtMode(page, mode);
  await page.goto(fileViewUrl(rel));
  await expect(page.getByTestId("preview-overlay")).toBeVisible({ timeout: 30_000 });
}

async function galleryShots(page: Page, mode: TtMode): Promise<Buffer[]> {
  await loadIn(page, mode, GALLERY);
  const diagrams = page.locator(".mermaid-diagram-inner");
  await expect(diagrams).toHaveCount(MERMAID_GALLERY_DIAGRAMS.length, { timeout: 60_000 });
  await page.waitForTimeout(1_000); // fonts / layout settle
  const shots: Buffer[] = [];
  for (let i = 0; i < MERMAID_GALLERY_DIAGRAMS.length; i++) shots.push(await diagrams.nth(i).screenshot());
  return shots;
}

test.describe("Trusted Types visual parity", () => {
  test("F1: every diagram under enforce stays within off-vs-off variance; accent tint survives", async ({ page }) => {
    test.setTimeout(240_000);
    await installTtProbe(page);
    await ensureGitSession(page);
    const off1 = await galleryShots(page, "off");
    const off2 = await galleryShots(page, "off");
    const enforced = await galleryShots(page, "enforce");
    const probe = await readTtProbe(page);
    expect(probe.violations, JSON.stringify(probe.violations)).toEqual([]);
    expect(probe.defaultHits, "library sinks went through the default policy").toBeGreaterThan(0);
    // The last load really ran under enforcement: meta says so and a raw HTML sink
    // is sanitized by the enforce-mode default policy (report mode passes it through).
    expect(await page.locator('meta[name="pi-trusted-types"]').getAttribute("content")).toBe("enforce");
    expect(
      await page.evaluate(() => {
        const d = document.createElement("div");
        d.innerHTML = "<img src=x onerror=f()>";
        return d.innerHTML;
      }),
    ).not.toContain("onerror");

    // Default (un-authored) flowchart node keeps the accent wash under enforcement.
    const style = await page.locator(".mermaid-diagram-inner").first().locator("g.node rect").first().getAttribute("style");
    expect(style ?? "").toMatch(WASH);

    for (let i = 0; i < enforced.length; i++) {
      // Run-to-run variance = the two `off` loads' difference; the enforce load
      // is compared with the CLOSER baseline (gitGraph alternates ±8 px widths).
      const noise = await pixelDiff(page, off1[i], off2[i]);
      const delta = Math.min(await pixelDiff(page, off1[i], enforced[i]), await pixelDiff(page, off2[i], enforced[i]));
      expect(delta, `diagram #${i} enforce-vs-off ${delta} > off-vs-off ${noise}`).toBeLessThanOrEqual(noise);
    }
  });

  test("F2: AsciiDoc + KaTeX + mermaid and EML render identically; 0 violations; EML frame sandboxed", async ({ page }) => {
    test.setTimeout(180_000);
    await installTtProbe(page);
    await ensureGitSession(page);
    const shotAdoc = async (mode: TtMode) => {
      await loadIn(page, mode, ADOC);
      const body = page.locator(".asciidoc-body").first();
      await expect(body.locator(".katex").first()).toBeVisible({ timeout: 30_000 });
      await expect(body.locator(".mermaid-diagram-inner svg").first()).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(500);
      return body.screenshot();
    };
    const a1 = await shotAdoc("off");
    const a2 = await shotAdoc("off");
    const ae = await shotAdoc("enforce");
    expect(Math.min(await pixelDiff(page, a1, ae), await pixelDiff(page, a2, ae))).toBeLessThanOrEqual(await pixelDiff(page, a1, a2));
    expect((await readTtProbe(page)).violations).toEqual([]);

    const shotEml = async (mode: TtMode) => {
      await loadIn(page, mode, "rich.eml");
      const frame = page.getByTestId("eml-body-frame");
      await expect(frame).toBeVisible({ timeout: 30_000 });
      expect(await frame.getAttribute("sandbox")).toBe("");
      await expect(page.frameLocator('[data-testid="eml-body-frame"]').locator("body")).not.toBeEmpty({ timeout: 15_000 });
      await page.waitForTimeout(500);
      return frame.screenshot();
    };
    const e1 = await shotEml("off");
    const e2 = await shotEml("off");
    const ee = await shotEml("enforce");
    expect(Math.min(await pixelDiff(page, e1, ee), await pixelDiff(page, e2, ee))).toBeLessThanOrEqual(await pixelDiff(page, e1, e2));
    expect((await readTtProbe(page)).violations).toEqual([]);
  });
});
