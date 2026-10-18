import { expect, type Page, test } from "./fixtures.js";
import { byTestId, dismissToasts, spawnFreshGitSession } from "./helpers/index.js";

// Browser E2E — markdown / AsciiDoc markup repair in the editor-pane file preview
// (change: add-md-adoc-markup-repair, test-plan F12–F13).
//
// Fixtures (docker/fixtures/sample-git, copied to the session cwd at container start):
//  - markup-broken.adoc: a bare `[mermaid]` `----` block (A1) + an unterminated listing
//    before `== Next` (A2). Real asciidoctor on the server.
//  - mermaid-eof.md: ends inside a ```mermaid fence (M1: renders instead of "Loading diagram…").
// Exemplars: tests/e2e/asciidoc-preview.spec.ts, tests/e2e/diagram-preview.spec.ts.

/** `/view @<file>` in a fresh git-fixture session → the editor pane for that file. */
async function openFile(page: Page, file: string) {
  const card = await spawnFreshGitSession(page);
  await card.click();
  const composer = page.getByPlaceholder(/message/i).first();
  await composer.waitFor({ state: "visible", timeout: 30_000 });
  await composer.fill(`/view @${file}`);
  await page.keyboard.press("Escape"); // close the slash-command dropdown
  await composer.fill(`/view @${file}`);
  await expect(async () => {
    await dismissToasts(page);
    await byTestId(page, "sendButton").click({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await expect(page).toHaveURL(new RegExp(`/session/[^/]+/editor\\?file=${file.replace(/\./g, "\\.")}`), {
    timeout: 20_000,
  });
}

test.describe("markup repair", () => {
  test("F12: AsciiDoc — bare [mermaid] + unterminated listing render repaired; view original reverts", async ({ page }) => {
    await openFile(page, "markup-broken.adoc");
    const body = page.locator(".asciidoc-body").first();
    await expect(body).toBeVisible({ timeout: 30_000 });

    // Repaired: the diagram renders and the section after the listing is a real heading.
    await expect(body.locator(".mermaid-diagram svg")).toHaveCount(1, { timeout: 30_000 });
    await expect(body.locator("h2", { hasText: "Next" })).toBeVisible();

    const banner = page.getByTestId("markup-repair-banner");
    await expect(banner).toBeVisible();
    await expect(banner.locator('[data-rule="A1"]')).toHaveCount(1);
    await expect(banner.locator('[data-rule="A2"]')).toHaveCount(1);

    // Original rendering: bare style stays a listing, `== Next` is swallowed by the open listing.
    await banner.getByTestId("markup-repair-view-original").click();
    await expect(body.locator(".mermaid-diagram svg")).toHaveCount(0, { timeout: 30_000 });
    await expect(body.locator("h2", { hasText: "Next" })).toHaveCount(0);
    await expect(banner.getByTestId("markup-repair-view-original")).toHaveAttribute("aria-pressed", "true");
  });

  test("F13: markdown — a mermaid fence left open at end of file renders, no endless loading", async ({ page }) => {
    await openFile(page, "mermaid-eof.md");
    await expect(page.locator(".mermaid-diagram svg").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Loading diagram/i)).toHaveCount(0);
    // M1 is a render gate, not a repair: nothing to report.
    await expect(page.getByTestId("markup-repair-banner")).toHaveCount(0);
  });
});
