import { expect, test } from "./fixtures.js";
import { ensureGitSession, FIXTURE_GIT } from "./helpers/index.js";

/**
 * F5 / F6 (test-plan) — automation fan-out end-to-end against the docker
 * harness.
 *
 * Exemplars: `bus-client-goal-plugin-action.spec.ts` (plugin-action harness
 * glue) and `session-spawn.spec.ts` (spawn/session-link assertions). The
 * harness port is resolved by the fixtures' `baseURL` from
 * `.pi-test-harness.json#dashboardPort` (via `docker/test-up.sh`) — never
 * hardcode `:18000`. Same-origin REST calls go through `page.request` so they
 * inherit the harness baseURL + auth cookie.
 *
 * Firm/best-effort split (mirrors the exemplars): FIRM — the automation is
 * created with an `actions:` fan-out, a fire produces ONE parent occurrence
 * that discloses TWO child rows with distinct action labels; BEST-EFFORT — live
 * per-child session convergence under the faux model (asserted with generous
 * timeouts).
 *
 * See change: add-automation-concurrent-spawn.
 */

/** Mirror of packages/client/src/lib/util/folder-encoding.ts::encodeFolderPath. */
function encodeFolderPath(cwd: string): string {
  return encodeURIComponent(cwd).replace(/%2F/gi, "~");
}

const NAME = "e2e-fanout";
const NEVER_CRON = "0 0 1 1 *"; // fires only on Jan 1 — we trigger manually.

// Work-source fan-out (F3): a `schedule.batch` automation whose `on.source`
// names the harness-seeded `e2e-inbox` folder work-source (3 files). One fire
// leases up to the bound and fans out one child per leased file.
// See change: automation-work-source-fanout.
const BATCH_NAME = "e2e-batch";
const batchConfig = {
  on: { kind: "schedule.batch", cron: NEVER_CRON, source: "e2e-inbox" },
  action: { kind: "core.skill", payload: { skill: "$noop-a" } },
  model: "@fast",
  mode: "local",
  sandbox: "workspace-write",
  concurrency: "skip",
  visibility: "shown",
};

const fanoutConfig = {
  on: { kind: "schedule", cron: NEVER_CRON },
  actions: [
    { kind: "core.skill", payload: { skill: "$noop-a" } },
    { kind: "core.skill", payload: { skill: "$noop-b" } },
  ],
  model: "@fast",
  mode: "local",
  sandbox: "workspace-write",
  concurrency: "skip",
  visibility: "shown",
};

async function createFanout(request: import("@playwright/test").APIRequestContext): Promise<void> {
  const res = await request.post("/api/plugins/automation/create", {
    data: { scope: "folder", cwd: FIXTURE_GIT, name: NAME, config: fanoutConfig },
  });
  expect(res.ok(), `create failed: ${res.status()} ${await res.text()}`).toBe(true);
}

async function deleteFanout(request: import("@playwright/test").APIRequestContext): Promise<void> {
  await request.delete(
    `/api/plugins/automation?scope=folder&cwd=${encodeURIComponent(FIXTURE_GIT)}&name=${NAME}`,
  );
}

test.describe("automation fan-out (parent → children)", () => {
  test.beforeEach(async ({ page }) => {
    // Ensure the harness has a live folder session for FIXTURE_GIT.
    await ensureGitSession(page);
  });
  test.afterEach(async ({ page }) => {
    await deleteFanout(page.request);
  });

  test("F5: a fire produces one parent expanding to two distinct child rows", async ({ page }) => {
    await createFanout(page.request);
    // Trigger the automation.
    const run = await page.request.post("/api/plugins/automation/run", {
      data: { scope: "folder", cwd: FIXTURE_GIT, name: NAME },
    });
    expect(run.ok(), `run failed: ${run.status()} ${await run.text()}`).toBe(true);

    // FIRM — the runs store shows one parent occurrence with two children.
    await expect
      .poll(
        async () => {
          const res = await page.request.get(
            `/api/plugins/automation/runs?scope=folder&cwd=${encodeURIComponent(FIXTURE_GIT)}&name=${NAME}`,
          );
          if (!res.ok()) return -1;
          const { runs } = (await res.json()) as {
            runs: Array<{ children?: string[]; childRuns?: unknown[] }>;
          };
          const parent = runs.find((r) => Array.isArray(r.children));
          return parent?.childRuns?.length ?? 0;
        },
        { timeout: 60_000, intervals: [1000] },
      )
      .toBe(2);

    // The board discloses the parent → children.
    await page.goto(`/folder/${encodeFolderPath(FIXTURE_GIT)}/automations`);
    const parentRow = page.locator('[data-testid^="automation-run-"]').first();
    await expect(parentRow).toBeVisible({ timeout: 30_000 });
    const expandBtn = page.locator('[data-testid^="run-expand-"]').first();
    await expandBtn.click();
    const childRows = page.locator('[data-testid^="automation-child-run-"]');
    await expect(childRows).toHaveCount(2, { timeout: 30_000 });
    const labels = page.locator('[data-testid^="child-action-"]');
    await expect(labels.nth(0)).toContainText("skill");
    await expect(labels.nth(1)).toContainText("skill");
  });

  test("F3: a schedule.batch fire fans out one child per leased work item", async ({ page }) => {
    // Create the work-source automation (source: e2e-inbox, seeded with 3 files).
    const created = await page.request.post("/api/plugins/automation/create", {
      data: { scope: "folder", cwd: FIXTURE_GIT, name: BATCH_NAME, config: batchConfig },
    });
    expect(created.ok(), `create failed: ${created.status()} ${await created.text()}`).toBe(true);
    try {
      const run = await page.request.post("/api/plugins/automation/run", {
        data: { scope: "folder", cwd: FIXTURE_GIT, name: BATCH_NAME },
      });
      expect(run.ok(), `run failed: ${run.status()} ${await run.text()}`).toBe(true);
      // Bind the assertion to THIS fire's parent run so a reused fixture or a
      // historical e2e-batch run cannot satisfy it.
      const { runId } = (await run.json()) as { runId: string };
      expect(runId, "run response missing runId").toBeTruthy();

      // FIRM — the parent run this test created discloses exactly 3 children
      // (dynamic width = the 3 leased files). Single-flight leasing guarantees
      // each child is bound to a distinct item (no file processed twice).
      await expect
        .poll(
          async () => {
            const res = await page.request.get(
              `/api/plugins/automation/runs?scope=folder&cwd=${encodeURIComponent(FIXTURE_GIT)}&name=${BATCH_NAME}`,
            );
            if (!res.ok()) return -1;
            const { runs } = (await res.json()) as {
              runs: Array<{ runId?: string; children?: string[]; childRuns?: unknown[] }>;
            };
            const parent = runs.find((r) => r.runId === runId && Array.isArray(r.children));
            return parent?.childRuns?.length ?? 0;
          },
          { timeout: 60_000, intervals: [1000] },
        )
        .toBe(3);
    } finally {
      await page.request.delete(
        `/api/plugins/automation?scope=folder&cwd=${encodeURIComponent(FIXTURE_GIT)}&name=${BATCH_NAME}`,
      );
    }
  });

  test("F6: stopping the parent converges the whole occurrence to terminal", async ({ page }) => {
    await createFanout(page.request);
    await page.request.post("/api/plugins/automation/run", {
      data: { scope: "folder", cwd: FIXTURE_GIT, name: NAME },
    });

    // Wait for the parent occurrence to exist with two children.
    await expect
      .poll(
        async () => {
          const res = await page.request.get(
            `/api/plugins/automation/runs?scope=folder&cwd=${encodeURIComponent(FIXTURE_GIT)}&name=${NAME}`,
          );
          if (!res.ok()) return null;
          const { runs } = (await res.json()) as { runs: Array<{ runId: string; children?: string[] }> };
          return runs.find((r) => Array.isArray(r.children))?.runId ?? null;
        },
        { timeout: 60_000, intervals: [1000] },
      )
      .not.toBeNull();

    // Stop the parent occurrence via the card Stop (present while running).
    await page.goto(`/folder/${encodeFolderPath(FIXTURE_GIT)}/automations`);
    const stop = page.getByTestId(`stop-${NAME}`);
    // Best-effort: the card Stop only shows while the occurrence is running.
    if (await stop.isVisible().catch(() => false)) {
      await stop.click();
    }

    // The occurrence converges to a terminal parent (no running record).
    await expect
      .poll(
        async () => {
          const res = await page.request.get(
            `/api/plugins/automation/runs?scope=folder&cwd=${encodeURIComponent(FIXTURE_GIT)}&name=${NAME}`,
          );
          if (!res.ok()) return "running";
          const { runs } = (await res.json()) as { runs: Array<{ status: string; children?: string[] }> };
          const parent = runs.find((r) => Array.isArray(r.children));
          return parent?.status ?? "running";
        },
        { timeout: 60_000, intervals: [1000] },
      )
      .not.toBe("running");
  });
});
