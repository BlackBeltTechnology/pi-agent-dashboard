/**
 * L3 — an automation run that survives a dashboard restart: its stamp
 * reattaches, the board marks it orphaned, and Stop kills its real process.
 * Also: a finished run's "Open session" lands on the archived transcript.
 *
 * Why L3: orphaned-ness only exists across a REAL server restart (the engine's
 * in-memory run state dies, the pi process and its bridge do not), and the
 * claim "the pi pid is gone" is about the container's process table.
 *
 * Exemplars: `automation-stop-tmux.spec.ts` (create/run REST glue, `/proc`
 * probes via `helpers/container-proc.ts`) and `automation-identity-restart.spec.ts`
 * (`POST /api/restart` + health poll). Port comes from `.pi-test-harness.json`
 * through `lifecycle.ts` — never hardcoded.
 *
 * The run prompt is `[[faux:ask-select-roundtrip]]`: the agent blocks on an
 * `ask_user`, so the run stays alive across the restart until it is stopped.
 *
 * See change: polish-automation-board (test-plan #X10, #F1, #F2).
 */
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { residentPiPids, resolveContainer, waitUntilGone } from "./helpers/container-proc.js";
import { FIXTURE_GIT, gotoDashboard } from "./helpers/index.js";
import { DASHBOARD_PORT } from "./lifecycle.js";

const NAME = "e2e-orphan-stop";
const NEVER_CRON = "0 0 1 1 *"; // fires only on Jan 1 — triggered manually.
const Q_CWD = encodeURIComponent(FIXTURE_GIT);

/** Mirror of packages/client/src/lib/util/folder-encoding.ts::encodeFolderPath (base64url). */
function encodeFolderPath(cwd: string): string {
  const bytes = new TextEncoder().encode(cwd);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return Buffer.from(binary, "binary").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function config(prompt: "block" | "finish") {
  return {
    on: { kind: "schedule", cron: NEVER_CRON },
    action: prompt === "block" ? { kind: "prompt", prompt: "prompt.md" } : { kind: "core.skill", payload: { skill: "$noop-a" } },
    model: "@fast",
    mode: "local",
    sandbox: "workspace-write",
    concurrency: "skip",
    visibility: "shown",
  };
}

interface RunRow {
  runId: string;
  status: string;
  sessionId?: string;
  orphaned?: boolean;
  sessionConnected?: boolean;
  children?: string[];
  childRuns?: RunRow[];
}

async function createAndRun(request: APIRequestContext, kind: "block" | "finish"): Promise<string> {
  const created = await request.post("/api/plugins/automation/create", {
    data: {
      scope: "folder",
      cwd: FIXTURE_GIT,
      name: NAME,
      config: config(kind),
      ...(kind === "block" ? { promptBody: "[[faux:ask-select-roundtrip]] go" } : {}),
    },
  });
  expect(created.ok(), `create failed: ${created.status()} ${await created.text()}`).toBe(true);
  const run = await request.post("/api/plugins/automation/run", { data: { scope: "folder", cwd: FIXTURE_GIT, name: NAME } });
  expect(run.ok(), `run failed: ${run.status()} ${await run.text()}`).toBe(true);
  const { runId } = (await run.json()) as { runId?: string };
  expect(runId, "run response missing runId").toBeTruthy();
  return runId as string;
}

/** The single child of this run's parent occurrence (one action → one child). */
async function child(request: APIRequestContext, parentRunId: string): Promise<RunRow | undefined> {
  const res = await request.get(`/api/plugins/automation/runs?scope=folder&cwd=${Q_CWD}&name=${NAME}`);
  if (!res.ok()) return undefined;
  const { runs } = (await res.json()) as { runs: RunRow[] };
  return runs.find((r) => r.runId === parentRunId)?.childRuns?.[0];
}

async function sessionStamp(request: APIRequestContext, id: string): Promise<{ runId?: string; scope?: string } | undefined> {
  const res = await request.get(`/api/sessions?id=${encodeURIComponent(id)}`);
  if (!res.ok()) return undefined;
  const body = (await res.json()) as { data?: Array<{ id: string; automationRun?: { runId?: string; scope?: string } }> };
  return body.data?.find((s) => s.id === id)?.automationRun;
}

async function cleanup(request: APIRequestContext): Promise<void> {
  await request.delete(`/api/plugins/automation?scope=folder&cwd=${Q_CWD}&name=${NAME}`).catch(() => undefined);
}

async function restartDashboard(): Promise<void> {
  await fetch(`http://localhost:${DASHBOARD_PORT}/api/restart`, { method: "POST" }).catch(
    () => undefined, // the connection dies with the daemon; that is the point
  );
  const deadline = Date.now() + 150_000;
  await new Promise((r) => setTimeout(r, 2_000));
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${DASHBOARD_PORT}/api/health`);
      if (res.ok) return;
    } catch {
      // still down
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error("dashboard did not come back after POST /api/restart");
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

test.describe("orphaned automation run after a restart (polish-automation-board)", () => {
  test.setTimeout(300_000);
  test.beforeEach(async ({ page }) => cleanup(page.request));
  test.afterEach(async ({ page }) => cleanup(page.request));

  test("X10 + F1: the stamp survives reattach; the board marks the run orphaned and Stop kills its pi", async ({ page }) => {
    const container = resolveContainer();
    const before = new Set(residentPiPids(container));
    const parentRunId = await createAndRun(page.request, "block");
    const fresh = await waitForNewPi(container, before, 60_000);
    expect(fresh.length, "the run never spawned a pi in the container").toBeGreaterThan(0);

    // Registered: the child carries its sessionId; the session carries the stamp.
    await expect.poll(async () => (await child(page.request, parentRunId))?.sessionId ?? "", { timeout: 60_000 }).not.toBe("");
    const kid = (await child(page.request, parentRunId))!;
    const sid = kid.sessionId!;
    const stampBefore = await sessionStamp(page.request, sid);
    expect(stampBefore).toMatchObject({ runId: kid.runId, scope: "folder" });

    await restartDashboard();

    // X10 — the bridge reattaches with the stamp intact.
    await expect
      .poll(async () => JSON.stringify(await sessionStamp(page.request, sid)), { timeout: 90_000, intervals: [1_000] })
      .toBe(JSON.stringify(stampBefore));
    // The listing now reports the run orphaned and its session connected.
    await expect
      .poll(async () => {
        const c = await child(page.request, parentRunId);
        return `${c?.orphaned}/${c?.sessionConnected}`;
      }, { timeout: 90_000, intervals: [1_000] })
      .toBe("true/true");

    // F1 — the board names it and Stop (after confirm) kills the real process.
    // gotoDashboard arms the first-launch modal auto-dismiss before navigating.
    await gotoDashboard(page, `/folder/${encodeFolderPath(FIXTURE_GIT)}/automations`);
    await expect(page.getByTestId(`automation-enabled-${NAME}`)).toHaveText("orphaned", { timeout: 30_000 });
    await expect(page.getByTestId(`automation-orphan-notice-${NAME}`)).toContainText("still connected");
    await page.getByTestId(`stop-${NAME}`).click();
    await page.getByTestId(`stop-confirm-yes-${NAME}`).click();
    // Honest outcome surfaced on the card: a verified kill reads "process is gone".
    await expect(page.getByTestId(`automation-stop-notice-${NAME}`)).toContainText("process is gone", { timeout: 60_000 });
    // THIS run's child is finalized stopped, and THIS run's pi is gone. (Asserted
    // per-run, not at card level: the shared harness may hold other occurrences.)
    await expect.poll(async () => (await child(page.request, parentRunId))?.status, { timeout: 30_000 }).toBe("stopped");
    for (const pid of fresh) {
      expect(await waitUntilGone(container, pid, 30_000), `pi ${pid} outlived the orphan Stop`).toBe(true);
    }
  });

  test("F2: Open session on a terminal run lands on the archived transcript", async ({ page }) => {
    // No real model runs in the harness (`@fast` is a fake-seeded credential),
    // so a run never reaches `done` on its own. Stop drives it to a terminal
    // `stopped` record that still carries its sessionId — the shape F2 needs.
    const parentRunId = await createAndRun(page.request, "block");
    await expect.poll(async () => (await child(page.request, parentRunId))?.sessionId ?? "", { timeout: 90_000 }).not.toBe("");
    const sid = (await child(page.request, parentRunId))!.sessionId!;
    const stopped = await page.request.post("/api/plugins/automation/stop", {
      data: { scope: "folder", cwd: FIXTURE_GIT, runId: (await child(page.request, parentRunId))!.runId },
    });
    expect(stopped.ok(), `stop failed: ${stopped.status()} ${await stopped.text()}`).toBe(true);
    // A live tracked stop may finalize `stopped` or `error` (killing the pid
    // closes the bridge, racing onSessionDeath); F2 only needs a TERMINAL run
    // that still carries its sessionId for the Open-session nav.
    await expect.poll(async () => (await child(page.request, parentRunId))?.status, { timeout: 30_000 }).not.toBe("running");

    await gotoDashboard(page, `/folder/${encodeFolderPath(FIXTURE_GIT)}/automations`);
    await page.getByTestId(`last-run-session-${NAME}`).click();
    await expect(page).toHaveURL(new RegExp(`/session/${sid}\\?archived=1$`), { timeout: 30_000 });
    await expect(page.getByTestId("session-not-found")).toHaveCount(0);
  });
});
