import { test, expect } from "./fixtures.js";
import { cleanupCommit, dirtyMarkdown, FIXTURE_GIT, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

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

  // File viewer (the surface the storm was measured on): idle soak with 0 removal
  // waves (P1), then zoom state survives an application-wide re-render (F2/F3,
  // driven by a streaming reply in the same session).
  test("file viewer: 0 removal waves idle; zoom + node identity survive session churn", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    const sessionId = await card.getAttribute("data-session-id");
    await dirtyMarkdown(page, FIXTURE_GIT, "notes.md", "```mermaid\ngraph TD; A-->B; B-->C\n```");
    try {
      await page.goto(`/session/${sessionId}/editor?file=notes.md`);
      const diagram = page.locator(".mermaid-diagram").first();
      await expect(diagram.locator("svg")).toBeVisible({ timeout: 30_000 });

      await page.evaluate(() => {
        const w = window as unknown as { __rem: number };
        w.__rem = 0;
        document.querySelectorAll(".mermaid-diagram").forEach((n) => ((n as unknown as { __s: number }).__s = 1));
        new MutationObserver((list) => {
          for (const m of list)
            for (const r of m.removedNodes)
              if (r instanceof Element && (r.matches(".mermaid-diagram") || r.querySelector(".mermaid-diagram"))) w.__rem++;
        }).observe(document.body, { childList: true, subtree: true });
      });
      await page.waitForTimeout(30_000);
      expect(await page.evaluate(() => (window as unknown as { __rem: number }).__rem)).toBe(0);
      expect(await page.evaluate(() => !!(document.querySelector(".mermaid-diagram") as unknown as { __s?: number })?.__s)).toBe(true);

      // Focus + zoom, then churn the whole app.
      await diagram.locator("> div").first().click();
      const zoomIn = page.getByTitle("Zoom in").first();
      await zoomIn.click();
      await zoomIn.click();
      const inner = diagram.locator(".mermaid-diagram-inner");
      const zoomed = await inner.evaluate((e) => (e as HTMLElement).style.transform);
      // Sending a prompt clicks the composer, which deliberately un-focuses the
      // diagram (click-outside) — so assert the persisted zoom + node identity,
      // not the controls' visibility.
      await sendPrompt(page, "[[faux:slow-stream]] go");
      await expect(page.getByText("slow-chunk-39").first()).toBeVisible({ timeout: 30_000 });
      expect(await page.evaluate(() => !!(document.querySelector(".mermaid-diagram") as unknown as { __s?: number })?.__s)).toBe(true);
      expect(await inner.evaluate((e) => (e as HTMLElement).style.transform)).toBe(zoomed);
    } finally {
      await cleanupCommit(page, FIXTURE_GIT);
    }
  });

  // Many diagrams + prose with inline code (the docs/architecture.md shape), a
  // concurrent streaming reply from a SECOND page (no click on this page, so
  // focus is not dropped), then: 0 removal waves, same node instances, focus +
  // controls + zoom + pan intact. Covers P1/P3/F2/F3.
  test("many diagrams under concurrent session activity: no waves; focus, zoom and pan survive", async ({ page, context }) => {
    const card = await spawnFreshGitSession(page);
    const sessionId = await card.getAttribute("data-session-id");
    const fence = (n: number) => `Paragraph ${n} with \`inline\` code and **bold**.\n\n- item \`x${n}\`\n\n\`\`\`mermaid\ngraph TD; N${n}a-->N${n}b; N${n}b-->N${n}c\n\`\`\`\n`;
    await dirtyMarkdown(page, FIXTURE_GIT, "notes.md", Array.from({ length: 12 }, (_, i) => fence(i)).join("\n"));
    try {
      await page.goto(`/session/${sessionId}/editor?file=notes.md`);
      await expect(page.locator(".mermaid-diagram svg").nth(11)).toBeVisible({ timeout: 60_000 });

      await page.evaluate(() => {
        const w = window as unknown as { __rem: number };
        w.__rem = 0;
        document.querySelectorAll(".mermaid-diagram").forEach((n) => ((n as unknown as { __s: number }).__s = 1));
        new MutationObserver((list) => {
          for (const m of list)
            for (const r of m.removedNodes)
              if (r instanceof Element && (r.matches(".mermaid-diagram") || r.querySelector(".mermaid-diagram"))) w.__rem++;
        }).observe(document.body, { childList: true, subtree: true });
      });

      // Focus the first diagram, zoom and pan it.
      const first = page.locator(".mermaid-diagram").first();
      const vp = first.locator("> div").first();
      await vp.click();
      await page.getByTitle("Zoom in").first().click();
      await page.getByTitle("Zoom in").first().click();
      const box = (await vp.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 25, { steps: 5 });
      await page.mouse.up();
      const inner = first.locator(".mermaid-diagram-inner");
      const transform = await inner.evaluate((e) => (e as HTMLElement).style.transform);
      expect(transform).toMatch(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
      expect(transform).not.toContain("translate(0px, 0px)");

      // Concurrent activity: a second page on the same session streams a reply.
      const other = await context.newPage();
      await other.goto(`/session/${sessionId}`);
      await sendPrompt(other, "[[faux:slow-stream]] go");
      await page.waitForTimeout(30_000);

      expect(await page.evaluate(() => (window as unknown as { __rem: number }).__rem)).toBe(0);
      expect(
        await page.evaluate(() => [...document.querySelectorAll(".mermaid-diagram")].every((n) => (n as unknown as { __s?: number }).__s)),
      ).toBe(true);
      await expect(page.getByTitle("Zoom in").first()).toBeVisible();
      expect(await inner.evaluate((e) => (e as HTMLElement).style.transform)).toBe(transform);
      await other.close();
    } finally {
      await cleanupCommit(page, FIXTURE_GIT);
    }
  });

  // `.mmd` goes MermaidViewer → MermaidBlock with no markdown layer (F12).
  test(".mmd viewer: 0 removal waves and the diagram is fitted", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    const sessionId = await card.getAttribute("data-session-id");
    await page.goto(`/session/${sessionId}/editor?file=flow.mmd`);
    await expect(page.locator(".mermaid-diagram svg").first()).toBeVisible({ timeout: 30_000 });
    await page.evaluate(() => {
      const w = window as unknown as { __rem: number };
      w.__rem = 0;
      document.querySelectorAll(".mermaid-diagram").forEach((n) => ((n as unknown as { __s: number }).__s = 1));
      new MutationObserver((list) => {
        for (const m of list)
          for (const r of m.removedNodes)
            if (r instanceof Element && (r.matches(".mermaid-diagram") || r.querySelector(".mermaid-diagram"))) w.__rem++;
      }).observe(document.body, { childList: true, subtree: true });
    });
    await page.waitForTimeout(15_000);
    expect(await page.evaluate(() => (window as unknown as { __rem: number }).__rem)).toBe(0);
    expect(await page.evaluate(() => !!(document.querySelector(".mermaid-diagram") as unknown as { __s?: number })?.__s)).toBe(true);
  });

  // F13: a diagram type outside {flowchart, sequence, gantt} is still fitted:
  // the applied scale equals the contain scale computed from the SVG's own size.
  test("non-useMaxWidth diagram type is fitted to the viewport", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    const sessionId = await card.getAttribute("data-session-id");
    const journey = "```mermaid\njourney\n  title Day\n  section Work\n    Code: 5: Me\n    Review: 3: Me, You\n    Ship: 4: Me\n```";
    await dirtyMarkdown(page, FIXTURE_GIT, "notes.md", journey);
    try {
      await page.goto(`/session/${sessionId}/editor?file=notes.md`);
      const vp = page.locator(".mermaid-diagram > div").first();
      await expect(vp.locator("svg")).toBeVisible({ timeout: 30_000 });
      const res = await vp.evaluate((el) => {
        const svg = el.querySelector("svg")!;
        const vb = (svg.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
        const rect = el.getBoundingClientRect();
        const t = (el.querySelector(".mermaid-diagram-inner") as HTMLElement).style.transform;
        return { vb, vw: rect.width, vh: rect.height, scale: Number(/scale\(([-\d.]+)\)/.exec(t)?.[1]) };
      });
      expect(res.vb.length).toBe(4);
      const expected = Math.min(4, Math.max(0.5, Math.min(res.vw / res.vb[2], res.vh / res.vb[3])));
      expect(res.scale).toBeCloseTo(expected, 1);
    } finally {
      await cleanupCommit(page, FIXTURE_GIT);
    }
  });
});
