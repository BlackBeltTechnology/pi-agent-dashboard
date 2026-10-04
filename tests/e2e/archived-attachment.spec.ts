/**
 * L3 — a session attached to a change that gets ARCHIVED stays traceable
 * (resolve-archived-attached-proposal, test-plan #F8, #F11).
 *
 * Why L3: the flip is a server/client round-trip no unit test proves — the
 * openspec poll must drop the change from the active set, the client's archive
 * cache must invalidate on that signature change and refetch
 * `/api/openspec-archive`, and the card must converge WITHOUT a reload and
 * WITHOUT ever flashing `Not found`.
 *
 * Fixture change `e2e-archive-flip` is SEEDED + REMOVED per test via
 * `docker exec`, not committed under `docker/fixtures/sample-git/openspec/`:
 * the board specs read `.first()` change card and expect the 4-artifact
 * `e2e-artifact-demo`, so a permanent extra change could reorder it.
 *
 * Exemplars: `archive-fold.spec.ts` (docker-exec seeding, harness container
 * resolution) + `openspec-artifact-dialog.spec.ts` (attach flow, history/Back).
 */

import { execFileSync } from "node:child_process";
import { expect, type Page, test } from "./fixtures.js";
import { ensureGitSession, FIXTURE_GIT } from "./helpers/index.js";
import { harnessProject } from "./lifecycle.js";

const CHANGE = "e2e-archive-flip";
const CHANGES_DIR = `${FIXTURE_GIT}/openspec/changes`;

let containerId: string | undefined;
function inContainer(script: string): string {
  if (!containerId) {
    const id = execFileSync(
      "docker",
      ["ps", "-q", "--filter", `label=com.docker.compose.project=${harnessProject()}`],
      { encoding: "utf8", timeout: 30_000 },
    ).trim().split("\n")[0];
    if (!id) throw new Error("no running harness container");
    containerId = id;
  }
  return execFileSync("docker", ["exec", containerId, "sh", "-c", script], { encoding: "utf8", timeout: 60_000 }).trim();
}

/** Remove the seeded change from both the active dir and any archive dir. */
function cleanupChange(): void {
  inContainer(`rm -rf "${CHANGES_DIR}/${CHANGE}" "${CHANGES_DIR}"/archive/*-${CHANGE}`);
}

function seedActiveChange(): void {
  cleanupChange();
  inContainer(
    `mkdir -p "${CHANGES_DIR}/${CHANGE}" && ` +
      `printf '## Why\\n\\nArchive-flip e2e fixture.\\n' > "${CHANGES_DIR}/${CHANGE}/proposal.md" && ` +
      `printf '## 1. Tasks\\n\\n- [x] 1.1 done\\n' > "${CHANGES_DIR}/${CHANGE}/tasks.md"`,
  );
}

/** Attach the seeded change to the (single) fixture session via the real UI. */
async function attachSeededChange(page: Page) {
  const card = await ensureGitSession(page);
  // Click the card's top-left corner: its centre can sit on a button that moves
  // while a cold container's openspec poll re-lays the card out (opened the
  // Propose dialog once).
  await card.click({ position: { x: 6, y: 6 } });
  // Specs share one container: a previous spec may have left the session attached.
  const combo = page.getByTestId("attach-combo").first();
  if (!(await combo.isVisible({ timeout: 5_000 }).catch(() => false))) {
    await page.getByTestId("openspec-overflow-btn").first().click();
    await page.getByTestId("detach-btn").first().click();
  }
  // Cold container: the card re-lays out while the openspec poll settles, so a
  // click can land on a neighbouring control (opened the Propose dialog once).
  // Wait for the combo to be enabled with the seeded change counted, then click.
  await expect(combo).toBeEnabled({ timeout: 60_000 });
  await expect(combo).toContainText(/Attach change/, { timeout: 60_000 });
  await page.waitForTimeout(500);
  await combo.click();
  await page.getByText(CHANGE, { exact: false }).first().click();
  await page.getByTestId("attached-badge").first().waitFor({ state: "visible", timeout: 30_000 });
  return card;
}

/** `mv` the change into the archive exactly like `openspec archive` does. Returns the entry date. */
function archiveSeededChange(): string {
  const today = inContainer("date +%F");
  inContainer(`mkdir -p "${CHANGES_DIR}/archive" && mv "${CHANGES_DIR}/${CHANGE}" "${CHANGES_DIR}/archive/${today}-${CHANGE}"`);
  return today;
}

test.describe("archived attachment (resolve-archived-attached-proposal)", () => {
  // The first test on a cold container also spawns the fixture session and waits
  // for the first openspec poll — more than the 60 s per-test default.
  test.setTimeout(180_000);
  test.beforeEach(() => seedActiveChange());
  test.afterEach(async ({ page }) => {
    cleanupChange();
    // Best effort: leave the shared session unattached for later specs.
    await page.getByTestId("openspec-overflow-btn").first().click({ timeout: 3_000 }).catch(() => {});
    await page.getByTestId("detach-btn").first().click({ timeout: 3_000 }).catch(() => {});
  });

  test("F8: a running session's card flips to Archived live — no reload, never Not found", async ({ page }) => {
    await attachSeededChange(page);
    // Record any transient `Not found` badge across the flip.
    await page.evaluate(() => {
      (window as unknown as { __notFoundSeen: boolean }).__notFoundSeen = false;
      new MutationObserver(() => {
        if (document.querySelector('[data-testid="attachment-not-found-badge"]')) {
          (window as unknown as { __notFoundSeen: boolean }).__notFoundSeen = true;
        }
      }).observe(document.body, { subtree: true, childList: true });
    });

    const today = archiveSeededChange();

    const badge = page.getByTestId("attachment-archived-badge").first();
    await expect(badge).toHaveText(`Archived ${today}`, { timeout: 60_000 });
    expect(await page.evaluate(() => (window as unknown as { __notFoundSeen: boolean }).__notFoundSeen)).toBe(false);
    // Lifecycle UI is gone for an archived attachment.
    await expect(page.getByTestId("apply-btn")).toHaveCount(0);
    await expect(page.getByTestId("archive-btn")).toHaveCount(0);
  });

  test("F11: letter P opens the archived proposal; browser Back restores the session view", async ({ page }) => {
    await attachSeededChange(page);
    archiveSeededChange();
    await expect(page.getByTestId("attachment-archived-badge").first()).toBeVisible({ timeout: 60_000 });

    const sessionUrl = page.url();
    expect(sessionUrl).toMatch(/\/session\/[^/?#]+$/);

    await page.getByTestId("session-openspec-actions").first().getByTestId("artifact-letter").first().click();
    await expect(page).toHaveURL(new RegExp(`/openspec/archive/[^/]+-${CHANGE}/proposal$`));
    await expect(page.getByTestId("markdown-preview")).toBeVisible();
    await expect(page.getByText(/Archive-flip e2e fixture/)).toBeVisible({ timeout: 20_000 });

    await page.goBack();
    await expect(page).toHaveURL(sessionUrl);
    await expect(page.getByTestId("session-openspec-actions").first()).toBeVisible();
    await expect(page.getByTestId("markdown-preview")).toHaveCount(0);
  });
});
