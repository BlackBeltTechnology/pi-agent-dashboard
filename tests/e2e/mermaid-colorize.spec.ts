import { test, expect } from "@playwright/test";
import { spawnFreshGitSession, sendPrompt } from "./helpers/index.js";

// Faux round-trip — mermaid default-node colorization.
//
// The `mermaid-colorize` faux scenario (qa/fixtures/faux-scenarios.ts) streams a
// fenced ```mermaid block with three flowchart nodes: A/C are default
// (un-authored) and B carries `style B fill:#ff0000`. This drives the real
// pipeline → bridge → /ws → ChatView → MarkdownContent → MermaidBlock, where
// mermaid.render() runs in the browser and colorizeDefaultNodes() post-processes
// the SVG. We assert the rendered DOM directly:
//   - default nodes receive a low-opacity accent wash fill (rgba(…, 0.08))
//   - the authored node keeps its #ff0000 fill and gets NO wash
// See change: colorize-mermaid-default-nodes.

const WASH = /rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0?\.08\s*\)/;

test.describe("faux round-trip — mermaid default-node colorization", () => {
  test("default nodes get an accent wash; authored node keeps its color", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:mermaid-colorize]] go");

    // Wait for the rendered diagram SVG to mount.
    const svg = page.locator(".mermaid-diagram svg").first();
    await expect(svg).toBeVisible({ timeout: 30_000 });

    // Default node A → soft accent wash fill.
    const aStyle = await page
      .locator('.mermaid-diagram svg g.node[id*="-A-"] rect')
      .first()
      .getAttribute("style");
    expect(aStyle ?? "").toMatch(WASH);

    // Default node C → soft accent wash fill too.
    const cStyle = await page
      .locator('.mermaid-diagram svg g.node[id*="-C-"] rect')
      .first()
      .getAttribute("style");
    expect(cStyle ?? "").toMatch(WASH);

    // Authored node B (style B fill:#ff0000) → author color preserved, no wash.
    const bStyle = await page
      .locator('.mermaid-diagram svg g.node[id*="-B-"] rect')
      .first()
      .getAttribute("style");
    expect((bStyle ?? "").toLowerCase()).toMatch(/#ff0000|255,\s*0,\s*0/);
    expect(bStyle ?? "").not.toMatch(WASH);
  });
});
