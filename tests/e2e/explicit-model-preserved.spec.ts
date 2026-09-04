/**
 * L3 — explicit `--model` on the launch argv is never clobbered by
 * `config.defaultModel` (issue #595).
 *
 * I1: a child pi PROCESS launched inside the harness container with an
 * explicit `--model faux/faux-2` (≠ the seeded default `faux/faux-1`) keeps
 * that model across the ~5s deferred-apply window where the bridge's
 * default-model gate historically clobbered it. `GET /api/sessions` must
 * report `faux/faux-2` in every sample across a ≥8s window.
 *
 * I2 (regression): a session spawned WITHOUT `--model` (plain REST spawn)
 * still converges to the seeded `config.defaultModel` (`faux/faux-1`).
 *
 * Launch exemplar: docker/test-entrypoint.sh PI_E2E_INDEPENDENT_SESSION block
 * (`setsid env PI_DASHBOARD_URL=ws://localhost:<gateway> tail -f /dev/null |
 * pi --mode rpc`) — a dedicated cwd keeps the card in its own sidebar group so
 * other specs' folder assertions are untouched. Ports + compose project come
 * from `.pi-test-harness.json` via lifecycle exports — never hardcoded.
 *
 * See change: fix-default-model-clobbers-explicit-model (test-plan #I1, #I2).
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "./fixtures.js";
import { BASE_URL, PI_GATEWAY_PORT, REPO_ROOT } from "./lifecycle.js";

/** Dedicated cwds — one session per test, each in its own sidebar group. */
const EXPLICIT_CHILD_CWD = "/fixtures/explicit-model-child";
const DEFAULT_CHILD_CWD = "/fixtures/default-model-child";
/** Covers the ~5s deferred apply from issue #595 with margin. */
const OBSERVE_WINDOW_MS = 9_000;
const POLL_INTERVAL_MS = 1_000;

interface SessionRow {
  id: string;
  cwd: string;
  status: string;
  model?: string;
}

async function listSessions(request: import("@playwright/test").APIRequestContext) {
  const res = await request.get(`${BASE_URL}/api/sessions`);
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { data: SessionRow[] };
  return body.data;
}

/**
 * Poll until a session in `cwd` is registered, returning its samples' models.
 * `requireModel` waits for a populated `model` too — I1 must snapshot the
 * EXPLICIT model at registration before starting the observation window.
 */
async function waitForRegistration(
  request: import("@playwright/test").APIRequestContext,
  cwd: string,
  requireModel = false,
): Promise<SessionRow> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const row = (await listSessions(request)).find(
      (s) => s.cwd === cwd && (!requireModel || Boolean(s.model)),
    );
    if (row) return row;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`session in ${cwd} never registered within 60s`);
}

// ── In-container exec (exemplar: ended-session-endedat.spec.ts) ────────────
let containerId: string | undefined;
function harnessContainer(): string {
  if (containerId) return containerId;
  const state = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, ".pi-test-harness.json"), "utf8"),
  ) as { project?: string };
  if (!state.project) throw new Error(".pi-test-harness.json carries no compose project");
  const id = execFileSync(
    "docker",
    ["ps", "-q", "--filter", `label=com.docker.compose.project=${state.project}`],
    { encoding: "utf8", timeout: 30_000 },
  )
    .trim()
    .split("\n")[0];
  if (!id) throw new Error(`no running container for compose project ${state.project}`);
  containerId = id;
  return id;
}

function inContainer(script: string, timeoutMs = 60_000): string {
  // Bounded: an unbounded `docker` call would hang the single worker until the
  // Playwright timeout fires, hiding the real cause.
  return execFileSync("docker", ["exec", harnessContainer(), "sh", "-c", script], {
    encoding: "utf8",
    timeout: timeoutMs,
  }).trim();
}

test.describe("explicit --model is never clobbered by the dashboard default", () => {
  test.setTimeout(120_000);

  test("I2: session spawned WITHOUT --model converges to the configured default", async ({
    request,
  }) => {
    inContainer(`mkdir -p '${DEFAULT_CHILD_CWD}'`);
    const spawn = await request.post(`${BASE_URL}/api/session/spawn`, {
      data: { cwd: DEFAULT_CHILD_CWD },
    });
    expect(spawn.ok()).toBeTruthy();

    await waitForRegistration(request, DEFAULT_CHILD_CWD);

    // The default is applied by the bridge at/after session_start (deferred
    // ~5s when the custom provider resolves late; immediate when the registry
    // already has it — the faux provider is registered at pi startup). Wait
    // for the convergence itself; settling on the DEFAULT is the assertion.
    await expect
      .poll(
        async () => {
          const row = (await listSessions(request)).find((s) => s.cwd === DEFAULT_CHILD_CWD);
          return row?.model;
        },
        { timeout: 30_000, intervals: [POLL_INTERVAL_MS] },
      )
      .toBe("faux/faux-1");

    // Shutdown via the same REST surface so it cannot leak into other specs.
    const row = (await listSessions(request)).find((s) => s.cwd === DEFAULT_CHILD_CWD);
    if (row) await request.post(`${BASE_URL}/api/session/${row.id}/shutdown`);
  });

  test("I1: child pi process with explicit --model keeps it across the deferred-apply window", async ({
    request,
  }) => {
    // Dedicated cwd + detached process, mirroring the independent-session
    // fixture in docker/test-entrypoint.sh. The bridge connects to the RUNNING
    // gateway via PI_DASHBOARD_URL (config.json carries no piPort). setsid makes
    // the launcher a session+group leader, so killing the negative PGID in the
    // finally block takes down the whole tree (sh + tail + pi). No `ps`/`pkill`
    // in the container — the captured `$!` launcher PID is the handle.
    inContainer(`mkdir -p '${EXPLICIT_CHILD_CWD}'`);
    const log = "/tmp/explicit-model-child.log";
    const launcherPid = inContainer(
      `setsid env PI_DASHBOARD_URL="ws://localhost:${PI_GATEWAY_PORT}" ` +
        `sh -c "cd '${EXPLICIT_CHILD_CWD}' && tail -f /dev/null | pi --mode rpc --model faux/faux-2" ` +
        `>> ${log} 2>&1 & echo $!`,
    );

    // Kill the child on test exit so it neither leaks RAM nor shows up in
    // other specs' session lists (own cwd already isolates the sidebar group).
    try {
      // The session must first register with the EXPLICIT model — that is the
      // state the bug would then corrupt ~5s in. requireModel avoids asserting
      // against a not-yet-populated model field (flake guard, review F4).
      const initial = await waitForRegistration(request, EXPLICIT_CHILD_CWD, true);
      expect(initial.model, "session must register on the explicit model").toBe("faux/faux-2");

      // Sample the whole ≥8s window at 1s granularity: if the gate clobbered
      // the model to the default at ~5s, a sample would catch the flip.
      const samples: Array<string | undefined> = [];
      const windowStart = Date.now();
      while (Date.now() - windowStart < OBSERVE_WINDOW_MS) {
        const row = (await listSessions(request)).find((s) => s.cwd === EXPLICIT_CHILD_CWD);
        samples.push(row?.model);
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
      expect(
        samples.every((m) => m === "faux/faux-2"),
        `model must stay faux/faux-2 for the whole window, saw: ${samples.join(",")}`,
      ).toBe(true);
    } finally {
      inContainer(
        `kill -TERM -- -'${launcherPid}' 2>/dev/null || kill -TERM '${launcherPid}' 2>/dev/null || true`,
        30_000,
      );
    }
  });
});
