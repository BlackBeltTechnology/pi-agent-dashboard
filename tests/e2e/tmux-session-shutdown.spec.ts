/**
 * L3 — the scenario this whole change exists for (test-plan #T2).
 *
 * The harness spawns with `PI_SPAWN_STRATEGY=tmux` (`docker/compose.yml`,
 * `test-entrypoint.sh` default), so every session here is a tmux-spawned pi —
 * exactly the case `handleShutdown` used to miss. Pre-fix, an instant-in-time
 * sample mid-run read 21 tmux panes = 21 resident `pi` = 0 session records: the
 * UI reported clean shutdowns while ~127 MB of `pi` survived each time.
 *
 * The claim under test is about the CONTAINER's process table, not about the
 * dashboard's own bookkeeping — a session record disappearing is precisely what
 * the bug already did. So the assertions read `/proc` and `tmux list-panes`
 * inside the container via `docker exec`, out-of-band, the same way
 * `scripts/probe-harness-memory.mjs` does.
 *
 * Exemplar: `tests/e2e/session-reap.spec.ts` (headless `BusClient` against the
 * harness, no browser page; port from `.pi-test-harness.json` via
 * `DASHBOARD_PORT`, never hardcoded).
 *
 * See change: fix-tmux-session-shutdown-leak (test-plan #T2, tasks 5.1, 5.2).
 */

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { BusClient } from "@blackbelt-technology/pi-dashboard-bus-client";
import type { SpawnResultBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { expect, test } from "./fixtures.js";
import { FIXTURE_GIT } from "./helpers/index.js";
import { DASHBOARD_PORT } from "./lifecycle.js";
import { isLiveSession } from "./reap-core.js";

/**
 * Resolve the harness container by the dashboard port it publishes.
 *
 * Port-derived rather than name-derived because `test-up.sh` hash-derives a
 * per-worktree compose project, so the container name is not knowable here —
 * but the port already is (`DASHBOARD_PORT`).
 */
function resolveContainer(): string {
  const out = execFileSync(
    "docker",
    ["ps", "--filter", `publish=${DASHBOARD_PORT}`, "--format", "{{.Names}}"],
    { encoding: "utf8" },
  ).trim();
  const name = out.split("\n").filter(Boolean)[0];
  if (!name) throw new Error(`no running container publishes port ${DASHBOARD_PORT}`);
  return name;
}

function inContainer(container: string, script: string): string {
  return execFileSync("docker", ["exec", container, "sh", "-c", script], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  }).trim();
}

/** True while that PID is resident IN THE CONTAINER. */
function isResident(container: string, pid: number): boolean {
  return inContainer(container, `[ -d /proc/${pid} ] && echo yes || echo no`) === "yes";
}

/** Number of tmux panes in the dashboard's session — a pane per spawned pi. */
function paneCount(container: string): number {
  const out = inContainer(
    container,
    "tmux list-panes -a 2>/dev/null | wc -l || echo 0",
  );
  return Number.parseInt(out, 10) || 0;
}

/** Resident `pi` processes, read from /proc (the image has no `ps`). */
function residentPiCount(container: string): number {
  const out = inContainer(
    container,
    `c=0; for d in /proc/[0-9]*; do [ -r "$d/status" ] || continue; ` +
      `n=$(awk '/^Name:/{print $2; exit}' "$d/status" 2>/dev/null); ` +
      `[ "$n" = "pi" ] && c=$((c+1)); done; echo $c`,
  );
  return Number.parseInt(out, 10) || 0;
}

async function withBus<T>(fn: (client: BusClient) => Promise<T>): Promise<T> {
  const client = new BusClient({ host: "localhost", port: DASHBOARD_PORT });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    client.close();
  }
}

/** Spawn a session and resolve its id — same approach as `session-reap.spec.ts`. */
async function spawnSession(client: BusClient, cwd: string): Promise<string> {
  const before = new Set(client.read.sessions().map((s) => s.id));
  const requestId = crypto.randomUUID();
  const result = client.await<SpawnResultBrowserMessage>(
    { type: "spawn_result" },
    { timeout: 45_000 },
  );
  client.send({ type: "spawn_session", cwd, requestId });
  const res = await result;
  expect(res.success, res.message).toBe(true);

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const fresh = client.read.sessions().find((s) => !before.has(s.id));
    if (fresh) return fresh.id;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("no new session appeared after spawn_result success");
}

/**
 * The PID the SERVER recorded for the session, read from its own REST view.
 *
 * Deliberately not `client.read.sessions()`: the browser-facing snapshot is a
 * trimmed projection that carries no `pid`, while `/api/sessions` returns
 * `sessionManager.listAll()` — the very record `handleShutdown` keys on.
 */
async function serverRecordedPid(sessionId: string): Promise<number | undefined> {
  const res = await fetch(`http://localhost:${DASHBOARD_PORT}/api/sessions`);
  const body = (await res.json()) as { data?: Array<{ id: string; pid?: number }> };
  return body.data?.find((s) => s.id === sessionId)?.pid;
}

/** Wait until the server no longer reports the session as live. */
async function waitUntilNotLive(client: BusClient, sessionId: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const rec = client.read.sessions().find((s) => s.id === sessionId);
    if (!rec || !isLiveSession({ id: rec.id, live: rec.live, status: rec.status })) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`session ${sessionId} never left the live set after shutdown`);
}

test.describe("tmux session shutdown (L3)", () => {
  test("T2: a tmux-spawned session's process and pane are both gone after shutdown", async () => {
    const container = resolveContainer();
    const panesBefore = paneCount(container);
    const piBefore = residentPiCount(container);

    const pid = await withBus(async (client) => {
      const sessionId = await spawnSession(client, FIXTURE_GIT);
      const sessionPid = await serverRecordedPid(sessionId);
      expect(
        typeof sessionPid,
        "the server recorded no PID for the session — termination keys on it",
      ).toBe("number");

      // Precondition: the process this test is about really is running, and it
      // really did open a pane. Without this the post-assertions are vacuous.
      expect(isResident(container, sessionPid as number)).toBe(true);
      expect(paneCount(container)).toBeGreaterThan(panesBefore);

      client.send({ type: "shutdown", sessionId });
      await waitUntilNotLive(client, sessionId);
      return sessionPid as number;
    });

    // The ladder is bounded (1.5 s grace + 2 s SIGTERM window); allow slack for
    // a loaded container without turning this into an unbounded wait.
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && isResident(container, pid)) {
      await new Promise((r) => setTimeout(r, 500));
    }

    expect(
      isResident(container, pid),
      `pi ${pid} outlived shutdown — the dashboard reported the session removed while a ~127 MB pi kept running (#452)`,
    ).toBe(false);

    // The pane is downstream of the process: the pane runs `cd <cwd> && pi`, so
    // it closes when pi exits (`remain-on-exit` is off). Panes returning to
    // baseline is therefore the second half of the same claim (design D6).
    const panesAfterDeadline = Date.now() + 10_000;
    while (Date.now() < panesAfterDeadline && paneCount(container) > panesBefore) {
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(
      paneCount(container),
      "the tmux pane outlived its pi process — panes are not collapsing on exit",
    ).toBeLessThanOrEqual(panesBefore);

    // 5.2 — the evidence capture that diagnosed the bug, re-read: panes,
    // resident pi and session records must AGREE, instead of 21 / 21 / 0.
    expect(
      residentPiCount(container),
      "resident pi count did not return to baseline after shutdown",
    ).toBeLessThanOrEqual(piBefore);
  });
});
