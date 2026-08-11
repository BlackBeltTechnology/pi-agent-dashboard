/**
 * L3 — the evidence-based `endedAt` invariant against the real harness.
 *
 * These two rows cannot be unit-tested: they need a real server boot so the
 * `session-bootstrap` restore loop actually runs over a real sessions
 * directory. The rule itself is covered at L1 in
 * `packages/server/src/__tests__/ended-session-endedat.test.ts`.
 *
 * Exemplar: `tests/e2e/session-reap.spec.ts` (drives the harness, restarts the
 * server via `POST /api/restart`). Port + compose project come from
 * `.pi-test-harness.json` — never hardcoded.
 *
 * See change: fix-ended-session-missing-endedat (test-plan #F1, #F2).
 */

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { BusClient } from "@blackbelt-technology/pi-dashboard-bus-client";
import { expect, test } from "./fixtures.js";
import { FIXTURE_GIT } from "./helpers/index.js";
import { DASHBOARD_PORT, REPO_ROOT } from "./lifecycle.js";

const DAY = 24 * 60 * 60 * 1000;
/** Transcript last written 30 days ago — the evidence the rule must find. */
const MTIME_AGE_DAYS = 30;
/** Session header 200 days ago — the WRONG anchor the pre-fix code fell back to. */
const STARTED_AGE_DAYS = 200;

/**
 * The harness container id, resolved from the compose project recorded in
 * `.pi-test-harness.json`. `docker compose exec` would need the -f file set;
 * the project label is enough to find the container directly.
 */
function harnessContainer(): string {
  const state = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, ".pi-test-harness.json"), "utf8"),
  ) as { project?: string };
  if (!state.project) throw new Error(".pi-test-harness.json carries no compose project");
  const id = execFileSync(
    "docker",
    ["ps", "-q", "--filter", `label=com.docker.compose.project=${state.project}`],
    { encoding: "utf8" },
  ).trim().split("\n")[0];
  if (!id) throw new Error(`no running container for compose project ${state.project}`);
  return id;
}

function inContainer(script: string): string {
  return execFileSync("docker", ["exec", harnessContainer(), "sh", "-c", script], {
    encoding: "utf8",
  }).trim();
}

const CONFIG_JS =
  'const fs=require("fs");const p=process.env.HOME+"/.pi/dashboard/config.json";' +
  'const c=JSON.parse(fs.readFileSync(p,"utf8"));';
const CONFIG_READ = `node -e '${CONFIG_JS}process.stdout.write(String(c.completedFirst===true))'`;

/** pi's on-disk encoding of a cwd into a sessions subdirectory name. */
function encodeCwd(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

/**
 * Plant a historical transcript that ONLY `session-bootstrap` can see.
 *
 * The filename shape is load-bearing, not incidental. `session-scanner`
 * identifies a session from the `<timestamp>_<uuid>.jsonl` filename and skips
 * anything else, while `discoverSessionsForCwd` reads the id out of the file's
 * header. A name without the underscore is therefore invisible to the scanner
 * and visible to bootstrap — which is precisely how a session reaches the
 * bootstrap restore branch (`if (!sessionManager.get(hist.id))`) on a real
 * boot, since the scanner otherwise populates the map first.
 *
 * Bootstrap sets no `lastActivityAt`, so this record has exactly one piece of
 * evidence: the transcript's mtime.
 */
function plantBootstrapOnlyTranscript(): { id: string; mtimeMs: number; startedAt: number } {
  const now = Date.now();
  const mtimeMs = now - MTIME_AGE_DAYS * DAY;
  const startedAt = now - STARTED_AGE_DAYS * DAY;
  // No `<timestamp>_` prefix — invisible to the scanner, visible to bootstrap.
  const id = plantTranscript("historical-tui.jsonl", startedAt, mtimeMs);
  return { id, mtimeMs, startedAt };
}

/**
 * Write a transcript with a chosen name, header timestamp and mtime into the
 * fixture directory's pi sessions folder. Returns the session id.
 */
function plantTranscript(filename: string, startedAt: number, mtimeMs: number): string {
  const id = crypto.randomUUID();
  const dir = `$HOME/.pi/agent/sessions/${encodeCwd(FIXTURE_GIT)}`;
  const header = JSON.stringify({
    type: "session",
    id,
    cwd: FIXTURE_GIT,
    timestamp: new Date(startedAt).toISOString(),
  });
  // `touch -d` needs a form busybox/coreutils both accept: @<epoch-seconds>.
  inContainer(
    `mkdir -p ${dir} && ` +
      `printf '%s\\n' '${header}' > ${dir}/${filename} && ` +
      `touch -d @${Math.floor(mtimeMs / 1000)} ${dir}/${filename}`,
  );
  return id;
}

/**
 * Plant a transcript the SCANNER rebuilds on every boot — it identifies a
 * session from the `<timestamp>_<uuid>.jsonl` filename, so the name must carry
 * pi's own shape. These are the records that persist into stored order.
 */
function plantScannerVisibleTranscript(ageDays: number): string {
  const startedAt = Date.now() - ageDays * DAY;
  const stamp = new Date(startedAt).toISOString().replace(/:/g, "-").replace(/\./g, "-");
  const id = crypto.randomUUID();
  const dir = `$HOME/.pi/agent/sessions/${encodeCwd(FIXTURE_GIT)}`;
  const header = JSON.stringify({
    type: "session",
    id,
    cwd: FIXTURE_GIT,
    timestamp: new Date(startedAt).toISOString(),
  });
  inContainer(
    `mkdir -p ${dir} && ` +
      `printf '%s\\n' '${header}' > ${dir}/${stamp}_${id}.jsonl && ` +
      `touch -d @${Math.floor(startedAt / 1000)} ${dir}/${stamp}_${id}.jsonl`,
  );
  return id;
}

async function restartDashboard(): Promise<void> {
  await fetch(`http://localhost:${DASHBOARD_PORT}/api/restart`, { method: "POST" }).catch(
    () => undefined, // the connection dies with the daemon; that is the point
  );
  const deadline = Date.now() + 120_000;
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

async function withBus<T>(
  fn: (client: BusClient) => Promise<T>,
  opts: { retryForMs?: number } = {},
): Promise<T> {
  const client = new BusClient({ host: "localhost", port: DASHBOARD_PORT });
  // Attaching as EARLY as the daemon allows is load-bearing for the reorder
  // assertion: `session-bootstrap` restores asynchronously just after startup,
  // so a client that waits for a settled health check can miss the very frame
  // it exists to rule out.
  const deadline = Date.now() + (opts.retryForMs ?? 0);
  for (;;) {
    try {
      await client.connect();
      break;
    } catch (err) {
      if (Date.now() >= deadline) throw err;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  try {
    return await fn(client);
  } finally {
    client.close();
  }
}

/**
 * The server's PERSISTED per-directory session order — the exact artefact D1a
 * says a `restore()` that emitted `onChange` would churn. Read from the
 * container rather than the bus because `BusClient` keeps only the sessions out
 * of `sessions_snapshot` and drops its `orders`.
 */
function readCompletedFirst(): boolean {
  return inContainer(CONFIG_READ) === "true";
}

/**
 * F2 needs `completedFirst` ON. The boot path's `moveToFront` +
 * `sessions_reordered` broadcast — the exact storm D1a forbids `restore()`
 * from triggering — are gated on this flag in `server.ts`'s `onChange`, so with
 * the default `false` the scenario cannot fail no matter what `restore()` does.
 */
function setCompletedFirst(value: boolean): void {
  inContainer(
    `node -e '${CONFIG_JS}c.completedFirst=${value};fs.writeFileSync(p,JSON.stringify(c,null,2))'`,
  );
}

function storedOrder(cwd: string): string[] {
  const raw = inContainer("cat $HOME/.pi/dashboard/preferences.json");
  const prefs = JSON.parse(raw) as { sessionOrder?: Record<string, string[]> };
  return prefs.sessionOrder?.[cwd] ?? [];
}

/** Pin the fixture directory so bootstrap's `knownDirectories()` includes it. */
async function ensurePinned(): Promise<void> {
  await withBus(async (client) => {
    client.send({ type: "pin_directory", path: FIXTURE_GIT } as never);
    await new Promise((r) => setTimeout(r, 3_000));
  });
}

test.describe("evidence-based endedAt across a real boot (L3)", () => {
  test("F1: a bootstrap-restored card is anchored at its transcript evidence", async () => {
    await ensurePinned();
    const planted = plantBootstrapOnlyTranscript();

    // Only a restart replays the boot restore loop that `session-bootstrap`
    // lives on; pinning alone drives the register→unregister path instead.
    await restartDashboard();

    const record = await withBus(async (client) => {
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        const found = client.read.sessions().find((s) => s.id === planted.id);
        if (found) return found;
        await new Promise((r) => setTimeout(r, 1_000));
      }
      throw new Error(`bootstrap never restored the planted session ${planted.id}`);
    });

    expect(record.status, "the planted historical session belongs to the ended tier").toBe("ended");
    expect(record.endedAt, "an ended record must always carry an endedAt").toBeDefined();

    // The badge anchors at `endedAt ?? lastActivityAt ?? startedAt`
    // (`session-card-time.ts`). Bootstrap supplies no `lastActivityAt`, so
    // before this change the badge fell through to `startedAt` — 200 days.
    const endedAt = record.endedAt as number;
    const ageDays = (Date.now() - endedAt) / DAY;
    expect(ageDays, `badge age was ${ageDays.toFixed(1)}d, expected ~${MTIME_AGE_DAYS}d`)
      .toBeGreaterThan(MTIME_AGE_DAYS - 2);
    expect(ageDays, `badge age was ${ageDays.toFixed(1)}d, expected ~${MTIME_AGE_DAYS}d`)
      .toBeLessThan(MTIME_AGE_DAYS + 2);
    // Explicitly NOT the startedAt age, and explicitly NOT "just now".
    expect(ageDays, "the badge fell back to startedAt").toBeLessThan(STARTED_AGE_DAYS - 10);
    expect(ageDays, "the badge reported reconstruction time").toBeGreaterThan(1);
  });

  test("F2: the boot restore loop does not churn stored ended-tier order", async () => {
    const priorCompletedFirst = readCompletedFirst();
    setCompletedFirst(true); // arm the hazard — see setCompletedFirst
    try {
      // A stored ended tier has to be EARNED: `reconcileSessionOrder` prunes
      // any id the manager cannot produce, so only sessions the SCANNER
      // rebuilds on every boot persist there. Two records, distinct ages.
      const ids = [plantScannerVisibleTranscript(90), plantScannerVisibleTranscript(45)];

      // Boot 1 seeds them into the stored per-directory order.
      await restartDashboard();
      const orderBefore = storedOrder(FIXTURE_GIT);
      expect(
        orderBefore.filter((id) => ids.includes(id)).length,
        "the two historical sessions did not reach the stored per-directory order",
      ).toBe(2);

      // Boot 2 replays the whole restore path over an ALREADY-stored order.
      const restarted = restartDashboard();

      // Two observables. The comparison is over the WHOLE stored array, not
      // just the two planted ids: a moveToFront of any restored record
      // reorders the array without disturbing their relative order.
      //
      // LIMITATION, stated rather than implied. This pair is an end-to-end
      // regression guard on the stored ended tier; it is NOT the binding proof
      // of D1a. The boot restore loop runs at `server.ts:364`, before
      // `sessionManager.onChange` is assigned at `:391` and before the WS
      // server accepts connections — so a `restore()` that emitted `onChange`
      // there is structurally unobservable from a client, and `moveToFront` is
      // idempotent for an id already at the front. D1a's actual guarantee
      // (`restore()` emits no `onChange`) is enforced and proven
      // fails-on-revert at L1: `ended-session-endedat.test.ts` → E12b.
      const sawReorder = await withBus(
        async (client) =>
          await client
            .await({ type: "sessions_reordered" }, { timeout: 20_000 })
            .then(() => true)
            .catch(() => false), // timeout == zero frames, the expected outcome
        { retryForMs: 120_000 },
      );
      await restarted;

      const orderAfter = storedOrder(FIXTURE_GIT);

      expect(orderAfter, "the boot restore loop reordered the stored order").toEqual(orderBefore);
      expect(sawReorder, "the boot path broadcast a sessions_reordered frame").toBe(false);
    } finally {
      setCompletedFirst(priorCompletedFirst); // leave the harness as found
    }
  });
});
