import { test, expect } from "@playwright/test";
import { spawnFreshGitSession } from "./helpers/index.js";

/**
 * E2E for change `add-session-tags` (task 7.2 — the manual browser check,
 * automated here against the Docker harness).
 *
 * Drives the full user-facing round-trip through the REAL server + `.meta.json`
 * persistence + WS broadcast (no faux fixture needed — tags are dashboard-owned
 * state, independent of any model call):
 *   1. add a user tag via the detail-header editor (autocomplete popover);
 *   2. the colorized removable chip appears in the header;
 *   3. the tag survives a full page reload (server persisted + rebroadcast);
 *   4. the sidebar "Your tags" filter chip appears and selects (aria-pressed),
 *      keeping the tagged session visible; clearing resets it;
 *   5. removing the tag via the chip ✕ drops it.
 *
 * Selection uses the components' semantic aria-labels ("Add tag", "Tag name",
 * "Remove tag <t>", "Filter by tag <t>") — stable, accessibility-required
 * handles, not CSS/DOM structure. The header editable strip is the ONLY surface
 * with a "Remove tag" control (the card strip is read-only), so that label
 * uniquely identifies the header chip.
 */
test.describe("session tags", () => {
  test("add → persist across reload → filter → remove", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    const sid = await card.getAttribute("data-session-id");
    expect(sid).toBeTruthy();

    // Select the session so the desktop detail header (with the editor) mounts.
    await card.click();
    const addTag = page.getByRole("button", { name: "Add tag" });
    await expect(addTag).toBeVisible({ timeout: 30_000 });

    // Unique, already-normalized tag (lowercase, hyphen) so it never collides
    // with tags left by sibling specs sharing the container.
    const tag = `e2e-${Date.now().toString(36)}`;

    // 1. Add via the header editor popover.
    await addTag.click();
    const input = page.getByRole("textbox", { name: "Tag name" });
    await input.fill(tag);
    await input.press("Enter");

    // 2. The colorized removable chip appears in the header (editable strip →
    // unique "Remove tag" control).
    const removeBtn = page.getByRole("button", { name: `Remove tag ${tag}` });
    await expect(removeBtn).toBeVisible();

    // 3. Persist across a full reload: the server persisted the tag and
    // rebroadcasts it on reconnect, so the header re-renders it.
    await page.reload();
    await expect(page.getByRole("button", { name: `Remove tag ${tag}` })).toBeVisible({
      timeout: 30_000,
    });

    // 4. The sidebar tag area is now DEFAULT-COLLAPSED (change:
    // sidebar-tag-collapse-and-delete) — expand it before the filter chip is
    // reachable, then select (aria-pressed) and keep the tagged session visible.
    await page.getByTestId("tag-area-toggle").click();
    const filterChip = page.getByRole("button", { name: `Filter by tag ${tag}` });
    await expect(filterChip).toBeVisible();
    await filterChip.click();
    await expect(filterChip).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.locator(`[data-testid="session-card-desktop"][data-session-id="${sid}"]`),
    ).toBeVisible();

    // Clearing the tag filter resets the axis.
    await page.getByTestId("clear-tag-filters").click();
    await expect(page.getByTestId("clear-tag-filters")).toHaveCount(0);

    // 5. Remove the tag via the header editable-strip ✕ (exact: the sidebar
    // filter chip's ✕ is "Remove tag <t> from all sessions", a superstring).
    await page.getByRole("button", { name: `Remove tag ${tag}`, exact: true }).click();
    await expect(page.getByRole("button", { name: `Remove tag ${tag}`, exact: true })).toHaveCount(0);
  });
});

/**
 * E2E for change `sidebar-tag-collapse-and-delete`: the sidebar tag-area master
 * collapse (default-collapsed + persisted), the guarded destructive global
 * delete (✕ → confirm → server fan-out), cross-context convergence, and the
 * collapsed active-filter indicator. Drives the real server + `.meta.json`
 * persistence + WS broadcast against the docker harness.
 *
 * Overflow-cap + remove-control render scenarios (E1/E2/F2/F4/X2) are covered
 * deterministically as component tests in
 * `packages/client/src/components/tags/__tests__/tags-components.test.tsx`.
 */
test.describe("sidebar tag collapse + global delete", () => {
  // Add a user tag to the currently-selected session via the header editor.
  async function addHeaderTag(page: import("@playwright/test").Page, tag: string) {
    await page.getByRole("button", { name: "Add tag" }).click();
    const input = page.getByRole("textbox", { name: "Tag name" });
    await input.fill(tag);
    await input.press("Enter");
    await expect(page.getByRole("button", { name: `Remove tag ${tag}` })).toBeVisible();
  }

  // E7 + E8: default-collapsed with a count, and fold state persists reload.
  test("E7/E8 — default collapsed with count, persists across reload", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await expect(page.getByRole("button", { name: "Add tag" })).toBeVisible({ timeout: 30_000 });
    const tag = `e2e-${Date.now().toString(36)}`;
    await addHeaderTag(page, tag);

    // E7: the master header is collapsed by default — chip hidden, aria-expanded
    // false, count present.
    const toggle = page.getByTestId("tag-area-toggle");
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("tag-area-count")).toBeVisible();
    await expect(page.getByRole("button", { name: `Filter by tag ${tag}` })).toHaveCount(0);

    // E8: expand → reload → still expanded.
    await toggle.click();
    await expect(page.getByRole("button", { name: `Filter by tag ${tag}` })).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("tag-area-toggle")).toHaveAttribute("aria-expanded", "true", { timeout: 30_000 });
    await expect(page.getByRole("button", { name: `Filter by tag ${tag}` })).toBeVisible();
    // …then collapse → reload → collapsed.
    await page.getByTestId("tag-area-toggle").click();
    await page.reload();
    await expect(page.getByTestId("tag-area-toggle")).toHaveAttribute("aria-expanded", "false", { timeout: 30_000 });
  });

  // F3: a selected filter is signaled on the collapsed header, with a clear
  // control reachable without unfolding.
  test("F3 — collapsed header signals an active filter and clears it", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await expect(page.getByRole("button", { name: "Add tag" })).toBeVisible({ timeout: 30_000 });
    const tag = `e2e-${Date.now().toString(36)}`;
    await addHeaderTag(page, tag);

    // Expand, select the filter, then collapse.
    await page.getByTestId("tag-area-toggle").click();
    const chip = page.getByRole("button", { name: `Filter by tag ${tag}` });
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("tag-area-toggle").click(); // collapse

    // Collapsed: an active-selection indicator distinct from the count + a clear.
    await expect(page.getByTestId("tag-area-active-indicator")).toBeVisible();
    await page.getByTestId("clear-tag-filters-collapsed").click();
    await expect(page.getByTestId("tag-area-active-indicator")).toHaveCount(0);
  });

  // X1 (cancel) then the delete round-trip (confirm → server strips the tag).
  test("X1 — cancel keeps the tag; confirm strips it globally", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await expect(page.getByRole("button", { name: "Add tag" })).toBeVisible({ timeout: 30_000 });
    const tag = `e2e-${Date.now().toString(36)}`;
    await addHeaderTag(page, tag);

    await page.getByTestId("tag-area-toggle").click();
    const removeChip = page.getByRole("button", { name: `Remove tag ${tag} from all sessions` });
    await expect(removeChip).toBeVisible();

    // X1: open the confirm and Cancel → nothing sent, tag remains.
    await removeChip.click();
    await expect(page.getByTestId("tag-delete-confirm")).toBeVisible();
    await page.getByTestId("tag-delete-cancel").click();
    await expect(page.getByTestId("tag-delete-confirm")).toHaveCount(0);
    await expect(page.getByRole("button", { name: `Filter by tag ${tag}` })).toBeVisible();
    // header chip intact (exact: distinct from the filter chip's "… from all sessions").
    await expect(page.getByRole("button", { name: `Remove tag ${tag}`, exact: true })).toBeVisible();

    // Confirm → server strips the tag from every carrier; the chip vanishes.
    await removeChip.click();
    await page.getByTestId("tag-delete-confirm-btn").click();
    await expect(page.getByRole("button", { name: `Filter by tag ${tag}` })).toHaveCount(0, { timeout: 15_000 });
    // The per-session header chip also drops (server rebroadcast).
    await expect(page.getByRole("button", { name: `Remove tag ${tag}`, exact: true })).toHaveCount(0);
  });

  // F1: a confirmed delete in one context converges in another via session_updated.
  test("F1 — delete converges across browser contexts without reload", async ({ page, context }) => {
    const card = await spawnFreshGitSession(page);
    const sid = await card.getAttribute("data-session-id");
    await card.click();
    await expect(page.getByRole("button", { name: "Add tag" })).toBeVisible({ timeout: 30_000 });
    const tag = `e2e-${Date.now().toString(36)}`;
    await addHeaderTag(page, tag);

    // Context B observes the same tag chip (its own WS connection).
    const pageB = await context.newPage();
    await pageB.goto(page.url().replace(/\/session\/.*/, "/"));
    await pageB.getByTestId("tag-area-toggle").click();
    await expect(pageB.getByRole("button", { name: `Filter by tag ${tag}` })).toBeVisible({ timeout: 30_000 });

    // Context A confirms the delete.
    await page.getByTestId("tag-area-toggle").click();
    await page.getByRole("button", { name: `Remove tag ${tag} from all sessions` }).click();
    await page.getByTestId("tag-delete-confirm-btn").click();

    // Context B converges to the tag absent via session_updated — no reload.
    await expect(pageB.getByRole("button", { name: `Filter by tag ${tag}` })).toHaveCount(0, { timeout: 15_000 });
    await pageB.close();
    expect(sid).toBeTruthy();
  });
});
