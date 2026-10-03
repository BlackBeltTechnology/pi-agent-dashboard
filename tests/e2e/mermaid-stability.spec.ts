import { test, expect } from "./fixtures.js";
import { spawnFreshGitSession, sendPrompt } from "./helpers/index.js";

// Rendered mermaid diagrams must not remount while idle (no blink), and the
// fixed-height viewport must not change when the user zooms.
// Covers test-plan P2 (30s idle node survival) and F11 (viewport height stable
// under zoom) using the `mermaid-colorize` faux scenario.
// See change: fix-markdown-remount-storm.

test.describe("mermaid diagram stability", () => {
  test("diagram nodes survive a 30s idle window with 0 removal waves", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await sendPrompt(page, "[[faux:mermaid-colorize]] go");
    await expect(page.locator(".mermaid-diagram svg").first()).toBeVisible({ timeout: 30_000 });

    await page.evaluate(() => {
      const w = window as unknown as { __rem: number; __stamped: number };
      w.__rem = 0;
      document.querySelectorAll(".mermaid-diagram").forEach((n) => ((n as unknown as { __s: number }).__s = 1));
      w.__stamped = document.querySelectorAll(".mermaid-diagram").length;
      new MutationObserver((list) => {
        for (const m of list)
          for (const r of m.removedNodes)
            if (r instanceof Element && (r.matches(".mermaid-diagram") || r.querySelector(".mermaid-diagram"))) w.__rem++;
      }).observe(document.body, { childList: true, subtree: true });
    });
    await page.waitForTimeout(30_000);
    const res = await page.evaluate(() => ({
      rem: (window as unknown as { __rem: number }).__rem,
      stamped: (window as unknown as { __stamped: number }).__stamped,
      survivors: [...document.querySelectorAll(".mermaid-diagram")].filter((n) => (n as unknown as { __s?: number }).__s).length,
    }));
    expect(res.stamped).toBeGreaterThan(0);
    expect(res.rem).toBe(0);
    expect(res.survivors).toBe(res.stamped);
  });

  test("viewport height is unchanged by zooming", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await sendPrompt(page, "[[faux:mermaid-colorize]] go");
    const vp = page.locator(".mermaid-diagram > div").first();
    await expect(vp).toBeVisible({ timeout: 30_000 });
    await vp.click(); // focus → controls appear
    const before = (await vp.boundingBox())?.height ?? 0;
    expect(before).toBeGreaterThanOrEqual(240);
    expect(before).toBeLessThanOrEqual(640);
    const zoomIn = page.getByTitle("Zoom in").first();
    await zoomIn.click();
    await zoomIn.click();
    await zoomIn.click();
    const after = (await vp.boundingBox())?.height ?? -1;
    expect(after).toBe(before);
  });
});
