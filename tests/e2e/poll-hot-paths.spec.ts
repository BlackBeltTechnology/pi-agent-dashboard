/**
 * L3 — rendered-UI latency of the poll hot paths, change:
 * optimize-polling-hot-paths (test-plan #F1–#F6). The bridge no longer polls
 * git every 30 s on pi's loop; these specs pin that the UI still converges
 * within the new bounds:
 *
 *   #F1 terminal `git checkout -b` → branch label ≤ 6 s (HEAD watcher, fast lane)
 *   #F2 agent file write → uncommitted indicator ≤ 15 s (mutating tool end)
 *   #F3 external edit → indicator ≤ 35 s (the 30 s tick's slow-lane probe)
 *   #F4 backgrounded process → process summary ≤ 10 s (adaptive fast scan)
 *   #F5 new `.pi/skills/<n>` → listed in Folder Settings ≤ 60 s (watch invalidation)
 *   #F6 model switch → composer label ≤ 1 s (model_select / set_model push)
 *
 * Git state is mutated INSIDE the harness container (`docker exec`) — the
 * "terminal" and "external editor" of the plan. The dashboard port comes from
 * `.pi-test-harness.json` via the fixtures' baseURL, never hardcoded.
 */
import { expect, test } from "./fixtures.js";
import {
  byTestId,
  cleanupCommit,
  ensureGitSession,
  FIXTURE_GIT,
  readGitStatus,
  sendPrompt,
  spawnFreshGitSession,
} from "./helpers/index.js";
import { inContainer } from "./helpers/folder-collapse.js";

const ENCODED_CWD = Buffer.from(FIXTURE_GIT).toString("base64url");
const git = (args: string) => inContainer(`cd ${FIXTURE_GIT} && git ${args}`).trim();

test.describe("poll hot paths — UI latency", () => {
  test.afterEach(async ({ page }) => {
    // Shared container + fixture repo: return everything to the baseline.
    const branch = git("branch --show-current");
    if (branch === "e2e-branch") {
      try { git("checkout -q -"); git("branch -D e2e-branch"); } catch { /* best-effort */ }
    }
    await cleanupCommit(page, FIXTURE_GIT).catch(() => {});
    inContainer(`rm -rf ${FIXTURE_GIT}/.pi/skills/e2e-skill`);
  });

  test("F1: a terminal `git checkout -b` updates the branch label within 6 s", async ({ page }) => {
    await ensureGitSession(page);
    // The branch NAME is a sibling of the icon-only button, so read the row.
    const label = byTestId(page, "gitBranchBtn").first().locator("xpath=..");
    await expect(label).toBeVisible({ timeout: 30_000 });
    git("checkout -q -b e2e-branch");
    await expect(label).toContainText("e2e-branch", { timeout: 6_000 });
  });

  test("F2: an agent file write shows the uncommitted indicator within 15 s", async ({ page }) => {
    await cleanupCommit(page, FIXTURE_GIT).catch(() => {});
    await spawnFreshGitSession(page);
    await expect.poll(async () => (await readGitStatus(page, FIXTURE_GIT))?.dirtyCount ?? 0).toBe(0);
    await sendPrompt(page, "[[faux:tool-write]] go");
    await expect(byTestId(page, "gitDirtyCount").first()).toBeVisible({ timeout: 15_000 });
  });

  test("F3: an external edit shows the indicator within 35 s (tick fallback)", async ({ page }) => {
    await cleanupCommit(page, FIXTURE_GIT).catch(() => {});
    await ensureGitSession(page);
    await expect(byTestId(page, "gitBranchBtn").first()).toBeVisible({ timeout: 30_000 });
    inContainer(`echo "e2e F3 external edit" >> ${FIXTURE_GIT}/README.md`);
    await expect(byTestId(page, "gitDirtyCount").first()).toBeVisible({ timeout: 35_000 });
  });

  test("F4: a backgrounded process reaches the process summary within 10 s", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await sendPrompt(page, "[[faux:tool-bash-background]] go");
    // The scan lists a process once it is ≥ 5 s old; the post-bash scan and the
    // fast cadence must surface it without waiting for the 30 s idle tick.
    await expect(card.getByTestId("process-summary-line")).toContainText("sleep 120", { timeout: 10_000 });
    inContainer("pkill -f 'sleep 120' || true");
  });

  test("F5: a new skill appears in Folder Settings within 60 s", async ({ page }) => {
    await page.goto(`/folder/${ENCODED_CWD}/settings/skills`);
    await expect(page.getByTestId("resource-grid-panel")).toBeVisible();
    inContainer(
      `mkdir -p ${FIXTURE_GIT}/.pi/skills/e2e-skill && printf -- '---\\nname: e2e-skill\\ndescription: poll hot paths probe\\n---\\n# e2e\\n' > ${FIXTURE_GIT}/.pi/skills/e2e-skill/SKILL.md`,
    );
    // Stale-while-revalidate: the first view after the watch event serves the
    // old list and rescans in the background, so re-read until it lands.
    await expect
      .poll(
        async () => {
          await page.reload();
          await page.getByTestId("resource-grid-panel").waitFor({ state: "visible" });
          return page.getByTestId("resource-grid-panel").getByText("e2e-skill").count();
        },
        { timeout: 60_000, intervals: [3_000] },
      )
      .toBeGreaterThan(0);
  });

  test("F6: switching model updates the composer label within 1 s", async ({ page }) => {
    await spawnFreshGitSession(page);
    const selector = page.getByTestId("composer-root").getByTestId("model-selector-button").first();
    await expect(selector).toBeVisible({ timeout: 30_000 });
    const before = (await selector.innerText()).trim();
    await selector.click();
    const rows = page.getByTestId("model-row");
    const count = await rows.count();
    test.skip(count < 2, "harness catalogue exposes a single model — nothing to switch to");
    for (let i = 0; i < count; i++) {
      const text = (await rows.nth(i).innerText()).trim();
      if (!before.includes(text.split("\n")[0] ?? text)) {
        await rows.nth(i).click();
        // Deviation (recorded): the dashboard set-model path, not a pi-TUI
        // `model_select`; both converge through `sendModelUpdateIfChanged`.
        await expect(selector).not.toHaveText(before, { timeout: 1_000 });
        return;
      }
    }
  });
});
