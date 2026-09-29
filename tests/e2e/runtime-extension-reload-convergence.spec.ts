import { execFileSync } from "node:child_process";
import { expect, test } from "./fixtures.js";
import { harnessProject } from "./lifecycle.js";

/**
 * F5 (change: electron-runtime-overlay-updates, D8): late-reconnect reload
 * convergence. Simulates what Electron does on a runtime switch — re-point
 * `settings.json#packages[]` at the new runtime's extension and respawn the
 * server with `PI_DASHBOARD_EXTENSION_DIR` / `PI_DASHBOARD_RUNTIME_ID` —
 * against two INDEPENDENT pi sessions (not dashboard-spawned, so they survive
 * the server restart and re-register, like a user's TUI sessions).
 *
 * Session B's pi is SIGSTOPped across the switch and resumed only after A has
 * converged, so its bridge reconnects past the first reload. Both must
 * eventually report the active extension identity, each after exactly one
 * `/reload` for the runtime id. Observed via the server's
 * `[runtime-overlay]` log lines (the server-side record of D8).
 *
 * Mutates harness-global state (settings.json, the server env); the finally
 * block restores the default server + extension and removes the sessions.
 */

const EXT_A = "/app/packages/extension";
const EXT_B = "/app/packages/extension-b";
const LOG = "/home/pi/.pi/dashboard/server.log";

function containerId(): string {
  const id = execFileSync("docker", ["ps", "-q", "--filter", `label=com.docker.compose.project=${harnessProject()}`], {
    encoding: "utf8",
  }).trim();
  if (!id) throw new Error("harness container not found");
  return id.split("\n")[0] as string;
}

function sh(cid: string, script: string, timeoutMs = 120_000): string {
  return execFileSync("docker", ["exec", cid, "bash", "-c", script], { encoding: "utf8", timeout: timeoutMs });
}

/** Restart the dashboard daemon, optionally with the Electron runtime env. */
function restartServer(cid: string, env: string): void {
  sh(
    cid,
    `pi-dashboard stop >/dev/null 2>&1 || true
     ${env} pi-dashboard start --port "$DASHBOARD_PORT" --pi-port "$PI_GATEWAY_PORT" --no-tunnel >/dev/null 2>&1 || true
     for i in $(seq 1 60); do curl -sf -o /dev/null --max-time 2 "http://localhost:$DASHBOARD_PORT/api/health" && exit 0; sleep 1; done; exit 1`,
    180_000,
  );
}

/** Launch an independent pi in its own process group; the pid file holds the group id. */
function launchIndependent(cid: string, name: string): { pidFile: string; cwd: string } {
  const cwd = `/fixtures/rt-${name}`;
  const pidFile = `/tmp/rt-${name}.pid`;
  sh(
    cid,
    `mkdir -p ${cwd}
     setsid env PI_DASHBOARD_URL="ws://localhost:$PI_GATEWAY_PORT" sh -c 'echo $$ > ${pidFile}; cd ${cwd} && tail -f /dev/null | pi --mode rpc' >> /tmp/rt-${name}.log 2>&1 &
     for i in $(seq 1 20); do [ -s ${pidFile} ] && exit 0; sleep 0.5; done; exit 1`,
  );
  return { pidFile, cwd };
}

/** `[runtime-overlay]` lines appended since `fromLine`. */
function logSince(cid: string, fromLine: number): string[] {
  return sh(cid, `tail -n +${fromLine + 1} ${LOG} | grep '\\[runtime-overlay\\]' || true`).split("\n").filter(Boolean);
}

test.describe("runtime switch — convergent bridge reload (F5)", () => {
  test.setTimeout(300_000);

  test("a late-reconnecting bridge converges; each session gets exactly one /reload", async ({ request }) => {
    const cid = containerId();
    const runtimeId = `e2e-f5-${Date.now()}`;
    const launched: Array<{ pidFile: string; cwd: string }> = [];
    let switched = false;
    try {
      const a = launchIndependent(cid, "f5a");
      launched.push(a);
      const b = launchIndependent(cid, "f5b");
      launched.push(b);

      // Both bridges registered before the switch.
      const idsByCwd = async () => {
        const body = await (await request.get("/api/sessions")).json();
        const list = (body.data ?? body) as Array<{ id: string; cwd: string; status?: string }>;
        const pick = (cwd: string) => list.find((s) => s.cwd === cwd && s.status !== "ended")?.id;
        return { a: pick(a.cwd), b: pick(b.cwd) };
      };
      await expect.poll(async () => Object.values(await idsByCwd()).every(Boolean), { timeout: 90_000 }).toBe(true);
      const ids = (await idsByCwd()) as { a: string; b: string };

      // Electron's switch: re-point the extension, delay B, respawn the server
      // with the runtime env (owner token = the Electron marker).
      sh(cid, `rm -rf ${EXT_B} && cp -a ${EXT_A} ${EXT_B} && kill -STOP -- "-$(cat ${b.pidFile})"`);
      const mark = Number(sh(cid, `wc -l < ${LOG}`).trim());
      switched = true;
      restartServer(
        cid,
        `PI_DASHBOARD_ELECTRON_INSTANCE=e2e PI_DASHBOARD_EXTENSION_DIR=${EXT_B} PI_DASHBOARD_RUNTIME_ID=${runtimeId}`,
      );
      expect(sh(cid, `jq -r '.packages[]' ~/.pi/agent/settings.json`)).toContain(EXT_B);

      const converged = (sid: string) =>
        logSince(cid, mark).some((l) => l.includes(`session=${sid} extension=${EXT_B} outcome=match`));
      await expect.poll(() => converged(ids.a), { timeout: 90_000, intervals: [2_000] }).toBe(true);
      expect(converged(ids.b)).toBe(false);

      // B reconnects only now — past A's reload — and still converges.
      sh(cid, `kill -CONT -- "-$(cat ${b.pidFile})"`);
      await expect.poll(() => converged(ids.b), { timeout: 90_000, intervals: [2_000] }).toBe(true);

      const reloads = (sid: string) =>
        logSince(cid, mark).filter((l) => l.includes(`/reload session=${sid} runtime=${runtimeId}`)).length;
      expect(reloads(ids.a)).toBe(1);
      expect(reloads(ids.b)).toBe(1);
      expect(logSince(cid, mark).filter((l) => l.includes("extension_mismatch"))).toEqual([]);
    } finally {
      // Independent best-effort steps: one failure must not skip the others.
      const step = (label: string, fn: () => void) => {
        try {
          fn();
        } catch (err) {
          console.warn(`[F5 cleanup] ${label}: ${String(err)}`);
        }
      };
      for (const l of launched) {
        step(`stop ${l.cwd}`, () =>
          sh(
            cid,
            `g=$(cat ${l.pidFile} 2>/dev/null); if [ -n "$g" ]; then kill -CONT -- -$g; kill -- -$g
             for i in $(seq 1 20); do kill -0 -- -$g 2>/dev/null || break; sleep 0.5; done; kill -KILL -- -$g; fi 2>/dev/null; rm -f ${l.pidFile}; true`,
          ),
        );
      }
      // Default server self-registers ${EXT_A} again (same-identity entry replaced).
      if (switched) step("restore server", () => restartServer(cid, ""));
      step("remove extension copy", () => sh(cid, `rm -rf ${EXT_B}`));
    }
  });
});
