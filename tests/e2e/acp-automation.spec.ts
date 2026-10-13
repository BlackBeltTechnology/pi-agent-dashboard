import { expect, test } from "./fixtures.js";
import { ensureGitSession, FIXTURE_GIT } from "./helpers/index.js";

/**
 * An automation that names an ACP agent runs end-to-end: it spawns the agent
 * (not pi), the run completes with the agent's reply, and a second run stopped
 * mid-turn ends its session (test-plan #F9).
 *
 * See change: add-acp-session-driver (task 7.81).
 */
const NEVER_CRON = "0 0 1 1 *"; // fires only on Jan 1 — triggered manually
const base = (agent: string) => ({
  on: { kind: "schedule", cron: NEVER_CRON },
  agent,
  mode: "local",
  sandbox: "workspace-write",
  concurrency: "skip",
  visibility: "shown",
});

type Req = import("@playwright/test").APIRequestContext;
interface RunRec { runId: string; status: string; sessionId?: string; result?: string }

async function create(request: Req, name: string, agent: string): Promise<void> {
  const res = await request.post("/api/plugins/automation/create", {
    data: { scope: "folder", cwd: FIXTURE_GIT, name, config: { ...base(agent), action: { kind: "prompt" } }, promptBody: "what does a.ts export?" },
  });
  expect(res.ok(), `create failed: ${res.status()} ${await res.text()}`).toBe(true);
}
async function runs(request: Req, name: string): Promise<RunRec[]> {
  const res = await request.get(`/api/plugins/automation/runs?scope=folder&cwd=${encodeURIComponent(FIXTURE_GIT)}&name=${name}`);
  return res.ok() ? ((await res.json()) as { runs: RunRec[] }).runs : [];
}
async function remove(request: Req, name: string): Promise<void> {
  await request.delete(`/api/plugins/automation?scope=folder&cwd=${encodeURIComponent(FIXTURE_GIT)}&name=${name}`);
}

// Quarantined in the harness (same cause as automation-fanout.spec.ts, issue #683):
// the automation plugin's engine init throws `Fastify instance is already
// listening. Cannot call "addHook"!` at boot, so its `onEvent` hook (which
// delivers the run's prompt to the spawned session) is never registered and a
// run never leaves "running". The ACP side is proven: the run binds the ACP
// session (`pluginRefs.automation`) and the agent starts. Re-enable with #683.
test.describe("automation on an ACP agent", () => {
  test.fixme(true, "https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/683");

  test.beforeEach(async ({ page }) => {
    await ensureGitSession(page);
  });

  test("a run spawns the ACP agent and completes with its reply", async ({ page }) => {
    const NAME = "e2e-acp-run";
    await create(page.request, NAME, "qmt");
    try {
      const run = await page.request.post("/api/plugins/automation/run", { data: { scope: "folder", cwd: FIXTURE_GIT, name: NAME } });
      expect(run.ok(), `run failed: ${run.status()} ${await run.text()}`).toBe(true);
      const { runId } = (await run.json()) as { runId: string };

      await expect
        .poll(async () => (await runs(page.request, NAME)).find((r) => r.runId === runId)?.status, { timeout: 90_000, intervals: [1000] })
        .not.toBe("running");
      const rec = (await runs(page.request, NAME)).find((r) => r.runId === runId)!;
      expect(rec.status).not.toBe("error");
      expect(rec.sessionId, "the run must be bound to a session").toBeTruthy();

      const sessions = (await (await page.request.get("/api/sessions")).json()) as { data?: { sessions?: Array<{ id: string; driver?: string; acpAgentId?: string }> } };
      const list = sessions.data?.sessions ?? (sessions as unknown as { sessions: never[] }).sessions ?? [];
      const s = (list as Array<{ id: string; driver?: string; acpAgentId?: string }>).find((x) => x.id === rec.sessionId);
      expect(s?.driver).toBe("acp");
      expect(s?.acpAgentId).toBe("qmt");
    } finally {
      await remove(page.request, NAME);
    }
  });

  test("a run stopped mid-turn is marked stopped and its session ends", async ({ page }) => {
    const NAME = "e2e-acp-stop";
    await create(page.request, NAME, "qmt-slow");
    try {
      const run = await page.request.post("/api/plugins/automation/run", { data: { scope: "folder", cwd: FIXTURE_GIT, name: NAME } });
      expect(run.ok()).toBe(true);
      const { runId } = (await run.json()) as { runId: string };
      await expect
        .poll(async () => (await runs(page.request, NAME)).find((r) => r.runId === runId)?.sessionId, { timeout: 60_000, intervals: [500] })
        .toBeTruthy();

      const stop = await page.request.post("/api/plugins/automation/stop", { data: { scope: "folder", cwd: FIXTURE_GIT, runId } });
      expect(stop.ok(), `stop failed: ${stop.status()} ${await stop.text()}`).toBe(true);
      await expect
        .poll(async () => (await runs(page.request, NAME)).find((r) => r.runId === runId)?.status, { timeout: 60_000, intervals: [1000] })
        .toBe("stopped");
    } finally {
      await remove(page.request, NAME);
    }
  });
});
