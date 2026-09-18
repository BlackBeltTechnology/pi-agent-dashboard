import { expect, test } from "./fixtures.js";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

// Faux round-trip — tool-output file-link behaviour (change: selectable-tool-output-links).
//
// `[[faux:text-difflinks]]` streams an assistant message whose body is a unified-
// diff header: `diff --git a/src/ghost.ts b/src/ghost.ts`. ChatView renders it
// through MarkdownContent, which linkifies the `a/`/`b/` paths into FileLinks.
//
// This proves the tokenizer strips the synthetic `a/` diff prefix from the
// RESOLVED path: clicking `a/src/ghost.ts` resolves `src/ghost.ts` (not
// `a/src/ghost.ts`), and since ghost.ts does not exist in the fixture the link
// flips to the not-found affordance, whose tooltip names the STRIPPED path.
//
// Superseded surface: before change server-side-file-mention-resolution the
// click opened the FilePreviewOverlay and the overlay rendered a "no longer
// exists" message from a /api/file 404. FileLink now resolves the mention
// server-side FIRST (D5/G1) and makes NO open call when the path is absent, so
// the not-found affordance IS the stale-link surface. See change:
// stabilize-browser-e2e (baseline triage drift).
test.describe("faux round-trip — tool-output file links", () => {
  test("git-diff a/ prefix is stripped and a stale link shows the no-longer-exists message", async ({
    page,
  }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:text-difflinks]] go");

    // The diff header rendered: the a/-prefixed path is a clickable FileLink.
    const link = page.getByText("a/src/ghost.ts", { exact: true }).first();
    await expect(link).toBeVisible({ timeout: 30_000 });
    await link.click();

    // ghost.ts does not exist → the server-resolved mention is null → the link
    // flips to the not-found affordance and makes NO open call.
    await expect(link).toHaveAttribute("data-not-found", "true", { timeout: 15_000 });
    // "Not found: …src/ghost.ts" (NOT "a/src/ghost.ts") proves the diff prefix
    // was dropped from the resolved path.
    await expect(link).toHaveAttribute("title", /Not found: .*src\/ghost\.ts/);
  });
});
