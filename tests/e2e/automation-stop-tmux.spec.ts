/**
 * L3 — automation stop terminates a tmux-spawned run's real process
 * (test-plan #X19, #X20).
 *
 * The harness spawns with `PI_SPAWN_STRATEGY=tmux` (the DEFAULT strategy), so an
 * automation run's session is a tmux pi that the headless PID registry never
 * recorded. Pre-fix `abortSpawnedRun` called only the registry kill, so a
 * stopped run left a ~127 MB `pi` resident (#459). The claim is about the
 * CONTAINER's process table, read out-of-band via `docker exec`.
 *
 * Exemplar: `tests/e2e/automation-fanout.spec.ts` (create/run REST glue) and
 * `tests/e2e/tmux-session-shutdown.spec.ts` (`/proc` probes).
 *
 * The run's prompt is `[[faux:ask-select-roundtrip]]`: the agent blocks on an
 * `ask_user`, so the run stays alive until it is stopped — a deterministic
 * target (a `$noop` run would finish before the stop lands).
 *
 * See change: fix-session-reclaim-tmux (test-plan #X19, #X20).
 */
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { residentPiPids, resolveContainer, waitUntilGone } from "./helpers/container-proc.js";
import { FIXTURE_GIT } from "./helpers/index.js";

const NAME = "e2e-stop-tmux";
const NEVER_CRON = "0 0 1 1 *"; // fires only on Jan 1 — triggered manually.

const config = {
  on: { kind: "schedule", cron: NEVER_CRON },
  action: { kind: "prompt", prompt: "prompt.md" },
  model: "@fast",
  mode: "local",
  sandbox: "workspace-write",
  concurrency: "skip",
  visibility: "shown",
};

async function createAndRun(request: APIRequestContext): Promise<string> {
  const created = await request.post("/api/plugins/automation/create", {
    data: { scope: "folder", cwd: FIXTURE_GIT, name: NAME, config, promptBody: "[[faux:ask-select-roundtrip]] go" },
  });
  expect(created.ok(), `create failed: ${created.status()} ${await created.text()}`).toBe(true);
  const run = await request.post("/api/plugins/automation/run", {
    data: { scope: "folder", cwd: FIXTURE_GIT, name: NAME },
  });
  expect(run.ok(), `run failed: ${run.status()} ${await run.text()}`).toBe(true);
  const { runId } = (await run.json()) as { runId?: string };
  expect(runId, "run response missing runId").toBeTruthy();
  return runId as string;
}

async function stop(request: APIRequestContext, runId: string): Promise<void> {
  const res = await request.post("/api/plugins/automation/stop", {
    data: { scope: "folder", cwd: FIXTURE_GIT, runId },
  });
  expect(res.ok(), `stop failed: ${res.status()} ${await res.text()}`).toBe(true);
}

async function cleanup(request: APIRequestContext): Promise<void> {
  await request.delete(`/api/plugins/automation?scope=folder&cwd=${encodeURIComponent(FIXTURE_GIT)}&name=${NAME}`);
}

/** Wait for a pi process that was not resident before the run. */
async function waitForNewPi(container: string, before: Set<number>, timeoutMs: number): Promise<number[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const fresh = residentPiPids(container).filter((p) => !before.has(p));
    if (fresh.length > 0) return fresh;
    await new Promise((r) => setTimeout(r, 250));
  }
  return [];
}

/** True once the dashboard lists a session carrying a pid that is one of `pids`. */
async function registeredPids(request: APIRequestContext, pids: number[]): Promise<boolean> {
  const res = await request.get("/api/sessions");
  const body = (await res.json()) as { data?: Array<{ pid?: number }> };
  return (body.data ?? []).some((s) => s.pid !== undefined && pids.includes(s.pid));
}

test.describe("automation stop terminates a tmux run's process (L3)", () => {
  test.afterEach(async ({ page }) => {
    await cleanup(page.request);
  });

  test("X19: stopping a registered tmux run leaves no resident pi", async ({ page }) => {
    const container = resolveContainer();
    const before = new Set(residentPiPids(container));
    const runId = await createAndRun(page.request);

    const fresh = await waitForNewPi(container, before, 60_000);
    expect(fresh.length, "the run never spawned a pi in the container").toBeGreaterThan(0);

    // Let it register so the session.pid rung (not just the token rung) is exercised.
    await expect.poll(() => registeredPids(page.request, fresh), { timeout: 60_000, intervals: [500] }).toBe(true);

    await stop(page.request, runId);

    for (const pid of fresh) {
      expect(
        await waitUntilGone(container, pid, 20_000),
        `pi ${pid} outlived the automation stop — the tmux run leaked (#459)`,
      ).toBe(true);
    }
  });

  test("X20: stopping before session_register lands still reclaims the spawn by token", async ({ page }) => {
    const container = resolveContainer();
    const before = new Set(residentPiPids(container));
    const runId = await createAndRun(page.request);

    // The pi process exists but has not registered yet: no session record, no
    // session.pid, no registry entry — only the spawn token identifies it.
    const fresh = await waitForNewPi(container, before, 60_000);
    expect(fresh.length, "the run never spawned a pi in the container").toBeGreaterThan(0);

    await stop(page.request, runId);

    for (const pid of fresh) {
      expect(
        await waitUntilGone(container, pid, 20_000),
        `pi ${pid} (spawned, not yet registered) survived the stop`,
      ).toBe(true);
    }
  });
});
