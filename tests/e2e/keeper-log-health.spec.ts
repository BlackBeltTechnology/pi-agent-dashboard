/**
 * L3 — keeper-log observability against the real harness (test-plan #F1, #F2).
 *
 * F1: `/api/health` carries the `keeperLogs` block with all seven numeric
 *     fields — the payload the dashboard polls must be well-typed even on a
 *     pristine harness.
 * F2: a runaway keeper log planted OUT-OF-BAND in the harness sessions dir
 *     reaches the API surface once the stats TTL expires — the cross-process
 *     "rotation is not working here" signal, end to end.
 *
 * The harness runs the real server; the stats cache refreshes lazily (60 s
 * TTL), so F2 polls `/api/health` until the seeded file becomes visible (its
 * own polls drive the refresh). Port + compose project come from
 * `.pi-test-harness.json` / the fixtures' baseURL — never hardcoded.
 *
 * Exemplars: `bridge-contention-health.spec.ts` (health polling shape),
 * `ended-session-endedat.spec.ts` (out-of-band `docker exec` seeding).
 *
 * See change: fix-runaway-keeper-log-growth (tasks 4.8, 4.9).
 */

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext } from "./fixtures.js";
import { REPO_ROOT } from "./lifecycle.js";

interface KeeperLogStats {
  totalBytes: number;
  fileCount: number;
  largestBytes: number;
  reclaimedBytes: number;
  runawayFiles: number;
  launchLogFiles: number;
  launchLogBytes: number;
}

interface HealthBody {
  keeperLogs?: KeeperLogStats;
}

async function health(request: APIRequestContext): Promise<HealthBody> {
  const res = await request.get("/api/health");
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as HealthBody;
}

/**
 * The harness container id, resolved from the compose project recorded in
 * `.pi-test-harness.json` (same resolution as ended-session-endedat.spec.ts).
 */
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
  ).trim().split("\n")[0];
  if (!id) throw new Error(`no running container for compose project ${state.project}`);
  containerId = id;
  return id;
}

function inContainer(script: string): string {
  // Bounded: an unbounded `docker` call would hang the single worker until the
  // Playwright timeout fires, hiding the real cause.
  return execFileSync("docker", ["exec", harnessContainer(), "sh", "-c", script], {
    encoding: "utf8",
    timeout: 60_000,
  }).trim();
}

/** The dashboard server's keeper-log sessions dir inside the harness container. */
const HARNESS_SESSIONS_DIR = "$HOME/.pi/dashboard/sessions";

test.describe("keeper-log health surface (L3)", () => {
  // F1 — the shape half; cheap and side-effect-free.
  test("F1: /api/health carries keeperLogs with all seven numeric fields", async ({ request }) => {
    const body = await health(request);
    const kl = body.keeperLogs;
    expect(kl, "keeperLogs is exposed on /api/health").toBeDefined();
    expect(kl).toEqual(
      expect.objectContaining({
        totalBytes: expect.any(Number),
        fileCount: expect.any(Number),
        largestBytes: expect.any(Number),
        reclaimedBytes: expect.any(Number),
        runawayFiles: expect.any(Number),
        launchLogFiles: expect.any(Number),
        launchLogBytes: expect.any(Number),
      }),
    );
  });

  // F2 — the signal half: seed a runaway log out-of-band, then poll past the
  // stats TTL (60 s) until the refresh surfaces it.
  test("F2: a seeded 2×-cap keeper log reaches the API as runawayFiles ≥ 1", async ({ request }) => {
    test.setTimeout(180_000);
    // The harness server runs with the default cap (128 MiB), so the runaway
    // threshold is 2× cap. `truncate -s` mints a SPARSE file — stat.size is
    // what the stats scan reads, and no real disk is consumed.
    const CAP = 134217728;
    const runawayBytes = 2 * CAP;
    const sid = crypto.randomUUID();
    const fileName = `keeper-${sid}.log`;
    inContainer(
      `mkdir -p ${HARNESS_SESSIONS_DIR} && truncate -s ${runawayBytes} ${HARNESS_SESSIONS_DIR}/${fileName} && ls -l ${HARNESS_SESSIONS_DIR}/${fileName}`,
    );

    try {
      // Poll at 5 s — each poll may trigger the lazy refresh once the TTL has
      // expired; the seeded file must surface within ~one TTL of seeding.
      const deadline = Date.now() + 150_000;
      let seen: KeeperLogStats | undefined;
      while (Date.now() < deadline) {
        const kl = (await health(request)).keeperLogs;
        if (kl && kl.runawayFiles >= 1 && kl.largestBytes >= runawayBytes) {
          seen = kl;
          break;
        }
        await new Promise((r) => setTimeout(r, 5_000));
      }
      expect(seen, "runaway signal surfaced within the TTL window").toBeDefined();
      expect(seen!.runawayFiles).toBeGreaterThanOrEqual(1);
      expect(seen!.largestBytes).toBeGreaterThanOrEqual(runawayBytes);
    } finally {
      // Leave the harness as we found it: the runaway file must not pollute
      // later specs' health views (best-effort).
      try {
        inContainer(`rm -f ${HARNESS_SESSIONS_DIR}/${fileName}`);
      } catch {
        /* harness may already be down */
      }
    }
  });
});
