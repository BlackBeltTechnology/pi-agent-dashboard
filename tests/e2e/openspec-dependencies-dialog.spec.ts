import { expect, test } from "./fixtures.js";
import { BOARD_FIXTURE, card, cardEl, openBoard } from "./helpers/openspec-board.js";

/**
 * Browser E2E — the per-change dependencies editor end to end (#F10).
 *
 * Board → card → "Dependencies…" → add a blocker → Save: the declaration is
 * written to the change's `dependencies.yaml` (read back through the GET
 * endpoint), and after the poll the blocked card shows "blocked by 1" and
 * wave 2. The fixture project's graph is computed on the `status --all` path;
 * the chips render because a change now has a `dependencies.yaml`.
 *
 * See change: add-openspec-change-dependencies.
 */

const BLOCKER = card(60);
const BLOCKED = card(61);

type Declared = { blockedBy: Array<{ change: string; reason?: string }> } | null;

/** The change's own declared lists, read through the REST endpoint. */
async function declaredOf(page: import("@playwright/test").Page, change: string): Promise<Declared> {
  return page.evaluate(
    async ([cwd, name]) => {
      const res = await fetch(`/api/openspec/dependencies?cwd=${encodeURIComponent(cwd)}&change=${encodeURIComponent(name)}`);
      const body = await res.json();
      return body.success ? body.data.declared : null;
    },
    [BOARD_FIXTURE, change] as const,
  );
}

/** Reset the declaration (the file stays, with empty lists) so reruns start clean. */
async function clearDeclaration(page: import("@playwright/test").Page, change: string): Promise<void> {
  await page.evaluate(
    async ([cwd, name]) => {
      const url = `/api/openspec/dependencies?cwd=${encodeURIComponent(cwd)}&change=${encodeURIComponent(name)}`;
      const got = await (await fetch(url)).json();
      if (!got.success) return;
      await fetch("/api/openspec/dependencies", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, change: name, blockedBy: [], notBlockedBy: [], related: [], expected: got.data.file }),
      });
    },
    [BOARD_FIXTURE, change] as const,
  );
}

test("F10: adding a blocker in the dialog writes dependencies.yaml and the card shows blocked by 1, wave 2", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await openBoard(page, 62);
  try {
    const target = cardEl(page, BLOCKED);
    await target.scrollIntoViewIfNeeded();
    await target.getByTestId(`card-dependencies-${BLOCKED}`).click();

    const dialog = page.getByTestId("deps-dialog");
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.getByTestId("deps-picker").selectOption(BLOCKER);
    await dialog.getByTestId("deps-add").click();
    await expect(dialog.getByTestId(`deps-declared-${BLOCKER}`)).toBeVisible();
    await dialog.getByTestId("deps-save").click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    // The file holds the declaration…
    await expect
      .poll(async () => (await declaredOf(page, BLOCKED))?.blockedBy.map((b) => b.change), { timeout: 15_000 })
      .toEqual([BLOCKER]);

    // …and after the poll the card shows the edge and the wave.
    await expect(target.getByTestId("dep-chip-blockedBy")).toHaveText("blocked by 1", { timeout: 60_000 });
    await expect(target.getByTestId("dep-wave")).toHaveText("wave 2");
  } finally {
    await clearDeclaration(page, BLOCKED);
  }
});
