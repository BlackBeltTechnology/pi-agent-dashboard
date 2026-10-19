/**
 * L3 — `openspec status --all` convergence (use-openspec-status-all, test-plan #F8).
 *
 * Corrupting one change's `.openspec.yaml` on disk must surface an error badge
 * on THAT change's board card only, and restoring it must clear the badge —
 * both without a manual refresh. Why L3: the loop is filesystem → watcher →
 * gated re-poll (one `openspec status --all` spawn) → `openspec_update`
 * broadcast → client re-render; no unit test crosses all of it.
 *
 * Fixture changes `e2e-sa-*` are SEEDED + REMOVED per test via `docker exec`
 * (same idiom as `archived-attachment.spec.ts`): committing them under
 * `docker/fixtures/sample-git/openspec/` would reorder the cards the other
 * board specs read with `.first()`.
 */
import { execFileSync } from "node:child_process";
import { expect, type Page, test } from "./fixtures.js";
import { ensureGitSession, FIXTURE_GIT } from "./helpers/index.js";
import { harnessProject } from "./lifecycle.js";

const CHANGES = ["e2e-sa-a", "e2e-sa-b", "e2e-sa-c"] as const;
const BROKEN = "e2e-sa-b";
const CHANGES_DIR = `${FIXTURE_GIT}/openspec/changes`;
const BOARD_URL = `/folder/${Buffer.from(FIXTURE_GIT).toString("base64url")}/openspec`;

let containerId: string | undefined;
function inContainer(script: string): string {
  if (!containerId) {
    const id = execFileSync("docker", ["ps", "-q", "--filter", `label=com.docker.compose.project=${harnessProject()}`], {
      encoding: "utf8",
      timeout: 30_000,
    })
      .trim()
      .split("\n")[0];
    if (!id) throw new Error("no running harness container");
    containerId = id;
  }
  return execFileSync("docker", ["exec", containerId, "sh", "-c", script], { encoding: "utf8", timeout: 60_000 }).trim();
}

function cleanup(): void {
  inContainer(CHANGES.map((c) => `rm -rf "${CHANGES_DIR}/${c}"`).join(" && "));
}

function seed(): void {
  cleanup();
  for (const c of CHANGES) {
    inContainer(
      `mkdir -p "${CHANGES_DIR}/${c}" && ` +
        `printf '## Why\\n\\nstatus-all e2e fixture.\\n' > "${CHANGES_DIR}/${c}/proposal.md" && ` +
        `printf 'schema: spec-driven\\n' > "${CHANGES_DIR}/${c}/.openspec.yaml"`,
    );
  }
}

const card = (page: Page, name: string) => page.getByTestId(`board-card-${name}`);

test.describe("openspec status --all — per-change error convergence", () => {
  // Cold container: first test also spawns the fixture session and waits for the first poll.
  test.setTimeout(180_000);
  test.beforeEach(() => seed());
  test.afterEach(() => cleanup());

  test("F8: a corrupt .openspec.yaml shows an error badge on that card only, and clears when restored", async ({ page }) => {
    await ensureGitSession(page);
    await page.goto(BOARD_URL);
    await page.getByTestId("openspec-board").waitFor({ state: "visible", timeout: 20_000 });
    for (const c of CHANGES) await card(page, c).waitFor({ state: "visible", timeout: 60_000 });
    await expect(page.getByTestId("openspec-error-badge")).toHaveCount(0);

    // Corrupt on disk (no UI refresh) → the watcher-triggered re-poll converges.
    inContainer(`printf 'schema: [unclosed\\n' > "${CHANGES_DIR}/${BROKEN}/.openspec.yaml"`);
    const badge = card(page, BROKEN).getByTestId("openspec-error-badge");
    await expect(badge).toBeVisible({ timeout: 30_000 });
    await expect(badge).toHaveAttribute("aria-label", /.+/);
    for (const c of CHANGES.filter((x) => x !== BROKEN)) {
      await expect(card(page, c).getByTestId("openspec-error-badge")).toHaveCount(0);
    }
    await expect(page.getByTestId("openspec-error-badge")).toHaveCount(1);

    // Restore → the badge disappears, again without a manual refresh.
    inContainer(`printf 'schema: spec-driven\\n' > "${CHANGES_DIR}/${BROKEN}/.openspec.yaml"`);
    await expect(page.getByTestId("openspec-error-badge")).toHaveCount(0, { timeout: 30_000 });
  });
});
