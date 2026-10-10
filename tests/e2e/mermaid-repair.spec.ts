import { expect, type Locator, type Page, test } from "./fixtures.js";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

// Every MermaidBlock surface applies rule-based auto-repair: a diagram that
// fails as written renders from repaired source with an auto-fixed badge
// naming the applied rules, and no error block. Surfaces: chat markdown,
// markdown file preview, AsciiDoc `[source,mermaid]` hydration, `.mmd` viewer.
// Fixtures: faux scenario `mermaid-repair` (R2, `participant end` inside an
// `alt … end` block), docker/fixtures/sample-git/repair.{md,adoc,mmd}
// (R5, `A[call (x)]-->B`) — committed, read-only: specs share one fixture repo. Exemplars: mermaid-stability.spec.ts (file viewer),
// asciidoc-preview.spec.ts. Covers test-plan F9.
// See change: add-mermaid-auto-repair.

/** The repaired diagram: a badge listing `rules`, the rendered SVG right after it, and no error block on the page. */
async function expectRepaired(page: Page, scope: Locator, rules: string[]): Promise<void> {
  const badge = scope.getByTestId("mermaid-repair-badge").first();
  await expect(badge).toBeVisible({ timeout: 30_000 });
  await expect(badge.getByTestId("mermaid-repair-rule")).toHaveText(rules);
  // The badge row renders as the sibling immediately before its `.mermaid-diagram`.
  const diagram = badge.locator("xpath=following-sibling::div[contains(@class,'mermaid-diagram')][1]");
  await expect(diagram.locator(".mermaid-diagram-inner > svg")).toBeVisible();
  await expect(page.getByText(/Failed to render Mermaid diagram/i)).toHaveCount(0);
}

test.describe("mermaid auto-repair on every surface", () => {
  test("chat message: keyword alias inside an alt block (R2)", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await sendPrompt(page, "[[faux:mermaid-repair]] go");
    await expect(page.getByText("Repair probe").first()).toBeVisible({ timeout: 30_000 });
    await expectRepaired(page, page.locator("body"), ["R2"]);
  });

  test("markdown file preview (R5)", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    const sessionId = await card.getAttribute("data-session-id");
    await page.goto(`/session/${sessionId}/editor?file=repair.md`);
    await expectRepaired(page, page.locator("body"), ["R5"]);
  });

  test("AsciiDoc [source,mermaid] preview (R5)", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    const sessionId = await card.getAttribute("data-session-id");
    await page.goto(`/session/${sessionId}/editor?file=repair.adoc`);
    const body = page.locator(".asciidoc-body").first();
    await expect(body).toBeVisible({ timeout: 30_000 });
    await expectRepaired(page, body, ["R5"]);
  });

  test(".mmd viewer (R5)", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    const sessionId = await card.getAttribute("data-session-id");
    await page.goto(`/session/${sessionId}/editor?file=repair.mmd`);
    await expectRepaired(page, page.locator("body"), ["R5"]);
  });
});
