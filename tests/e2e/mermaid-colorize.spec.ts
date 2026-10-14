import { test, expect } from "./fixtures.js";
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

// Sanitizer scenarios (change: sanitize-untrusted-rendered-content, F2–F4).
// mermaid.render() needs real layout, so these run in the browser, not jsdom.
test.describe("faux round-trip — mermaid SVG sanitization", () => {
  test("F2: every diagram type keeps its <style>, markers and labels; <br> breaks lines", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await sendPrompt(page, "[[faux:mermaid-sanitize-types]] go");

    const svgs = page.locator(".mermaid-diagram svg");
    await expect(svgs).toHaveCount(4, { timeout: 45_000 });

    for (let i = 0; i < 4; i++) {
      const svg = svgs.nth(i);
      await expect(svg.locator("style").first()).toBeAttached();
    }
    // Flowchart (arrow) + sequence (arrow) + class (inheritance) + ER (relation) all use markers.
    for (const i of [0, 1, 2]) await expect(svgs.nth(i).locator("marker").first()).toBeAttached();
    await expect(svgs.nth(1)).toContainText("Alice");
    await expect(svgs.nth(2)).toContainText("Animal");
    await expect(svgs.nth(3)).toContainText("CUSTOMER");

    // The `<br>` label renders `one` and `two` on different line boxes.
    const lines = await svgs.nth(0).locator(".nodeLabel").first().evaluate((label) => {
      const tops: number[] = [];
      const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const r = document.createRange();
        r.selectNodeContents(n);
        tops.push(r.getBoundingClientRect().top);
      }
      return tops;
    });
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines[1]).toBeGreaterThan(lines[0]);
  });

  test("F3: an %%{init}%% themeCSS/fontFamily payload cannot restyle the page or fetch remotely", async ({ page }) => {
    let evilRequests = 0;
    await page.route(/evil\.example/, (route) => {
      evilRequests++;
      return route.abort();
    });
    const card = await spawnFreshGitSession(page);
    await card.click();
    await sendPrompt(page, "[[faux:mermaid-theme-css]] go");

    const svg = page.locator(".mermaid-diagram svg").first();
    await expect(svg).toBeVisible({ timeout: 30_000 });
    const css = await svg.locator("style").allTextContents();
    const all = css.join("\n");
    expect(all).not.toContain("@import");
    expect(all).not.toMatch(/display:\s*none/);
    await expect(page.getByPlaceholder(/message/i).first()).toBeVisible();
    expect(evilRequests).toBe(0);
  });

  test("F4: an un-styled multi-line label node is still accent-tinted", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await sendPrompt(page, "[[faux:mermaid-br-label]] go");

    const node = page.locator('.mermaid-diagram svg g.node[id*="-A-"]').first();
    await expect(node).toBeVisible({ timeout: 30_000 });
    const style = await node.locator("rect").first().getAttribute("style");
    expect(style ?? "").toMatch(WASH);
    await expect(node).toContainText("one");
    await expect(node).toContainText("two");
  });
});
