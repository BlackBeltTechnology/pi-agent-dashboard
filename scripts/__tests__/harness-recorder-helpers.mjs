// Shared stubs for the harness lifecycle-recorder tests (change:
// add-missing-ci-legs, #451). Not a test file (no `.test.`): imported by
// test-up-recorder / test-down-recorder / harness-audit-armed.
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..", "..");
export const TEST_UP = path.join(REPO_ROOT, "docker", "test-up.sh");
export const TEST_DOWN = path.join(REPO_ROOT, "docker", "test-down.sh");
export const AUDIT = path.join(REPO_ROOT, "docker", "harness-audit.sh");
const LIB = path.join(REPO_ROOT, "docker", "lib-ports.sh");

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function deriveProject(dir) {
  return execFileSync("bash", ["-c", `source "${LIB}"; derive_project "$1"`, "_", dir], { encoding: "utf8" }).trim();
}

/**
 * Stub `docker` on PATH; every invocation is appended (in order) to $FAKE_DOCKER_LOG.
 *   events  → FAKE_EVENTS_FAIL=1: stderr "permission denied", exit 1;
 *             else prints $FAKE_EVENTS_FILE (if set) then blocks like a live stream
 *   ps      → contents of $FAKE_PS_FILE (the project's running container ids)
 *   info    → MemTotal (large: the oversubscription guard stays quiet)
 *   compose … ps -q → $FAKE_CONTAINER_ID
 *   compose … up    → FAKE_UP_FAIL=1 → exit 1
 *   compose … down  → snapshots $FAKE_EVENTS_LOG_FILE into $FAKE_DOWN_SNAPSHOT
 */
export function makeDockerStub() {
  const bin = mkdtempSync(path.join(os.tmpdir(), "rec-bin-"));
  const stub = path.join(bin, "docker");
  writeFileSync(
    stub,
    `#!/usr/bin/env bash
[ -n "\${FAKE_DOCKER_LOG:-}" ] && printf '%s\\n' "$*" >> "$FAKE_DOCKER_LOG"
case "$1" in
  events)
    if [ "\${FAKE_EVENTS_FAIL:-}" = "1" ]; then echo "permission denied while trying to connect to the Docker daemon socket" >&2; exit 1; fi
    if [ -n "\${FAKE_EVENTS_FILE:-}" ]; then touch "$FAKE_EVENTS_FILE"; exec tail -n +1 -f "$FAKE_EVENTS_FILE"; fi
    exec sleep 600 ;;
  ps)
    [ -n "\${FAKE_PS_FILE:-}" ] && [ -f "$FAKE_PS_FILE" ] && cat "$FAKE_PS_FILE"
    exit 0 ;;
  info) printf '%s\\n' "\${FAKE_MEMTOTAL:-1099511627776}"; exit 0 ;;
  compose)
    case " $* " in
      *" ps -q"*|*" ps -aq"*) [ -n "\${FAKE_CONTAINER_ID:-}" ] && printf '%s\\n' "$FAKE_CONTAINER_ID"; exit 0 ;;
      *" up "*) [ "\${FAKE_UP_FAIL:-}" = "1" ] && exit 1; exit 0 ;;
      *" down "*)
        if [ -n "\${FAKE_DOWN_SNAPSHOT:-}" ] && [ -n "\${FAKE_EVENTS_LOG_FILE:-}" ]; then cp "$FAKE_EVENTS_LOG_FILE" "$FAKE_DOWN_SNAPSHOT" 2>/dev/null || : > "$FAKE_DOWN_SNAPSHOT"; fi
        exit 0 ;;
    esac
    exit 0 ;;
  *) exit 0 ;;
esac
`,
  );
  chmodSync(stub, 0o755);
  return bin;
}

export const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export async function waitDead(pid, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!isAlive(pid)) return true;
    await sleep(50);
  }
  return !isAlive(pid);
}

export const readState = (ws) => JSON.parse(readFileSync(path.join(ws, ".pi-test-harness.json"), "utf8"));

/** A throwaway workspace + stub + env; `cleanup()` kills any recorder it left. */
export function makeSandbox(envOverrides = {}) {
  // realpath: test-up derives the project from $PWD (physical path on macOS).
  const ws = realpathSync(mkdtempSync(path.join(os.tmpdir(), "rec-ws-")));
  const bin = makeDockerStub();
  const log = path.join(ws, "docker.log");
  writeFileSync(log, "");
  const tmpdir = mkdtempSync(path.join(os.tmpdir(), "rec-tmp-"));
  const project = deriveProject(ws);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    TEST_COPY_MODE: "1",
    FAKE_DOCKER_LOG: log,
    FAKE_CONTAINER_ID: "cid-aaa111",
    MEM_LIMIT: "",
    PI_HARNESS_ALLOW_OVERSUBSCRIBE: "",
    // Bound any recorder a test forgets about.
    PI_HARNESS_AUDIT_POLL_SECS: "1",
    PI_HARNESS_AUDIT_MAX_SECS: "20",
    TMPDIR: `${tmpdir}/`,
    ...envOverrides,
  };
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
  const pids = new Set();
  return {
    ws,
    bin,
    log,
    tmpdir,
    project,
    env,
    eventsFile: path.join(tmpdir, "pi-dash-test", `${project}.events.log`),
    trackPid: (pid) => pids.add(pid),
    dockerCalls: () => readFileSync(log, "utf8").split("\n").filter(Boolean),
    cleanup() {
      const stateFile = path.join(ws, ".pi-test-harness.json");
      if (existsSync(stateFile)) {
        try {
          const p = readState(ws).recorderPid;
          if (p) pids.add(p);
        } catch {
          /* ignore */
        }
      }
      for (const pid of pids) {
        try {
          // SIGTERM: the recorder's trap then reaps its own events pipeline.
          process.kill(pid, "SIGTERM");
        } catch {
          /* gone */
        }
      }
      rmSync(ws, { recursive: true, force: true });
      rmSync(bin, { recursive: true, force: true });
      try {
        chmodSync(tmpdir, 0o755);
      } catch {
        /* ignore */
      }
      rmSync(tmpdir, { recursive: true, force: true });
    },
  };
}

/**
 * Spawn a long-lived stand-in process (a "live recorder"); returns its pid.
 * Started via a throwaway shell so it is reparented to init (like the real
 * recorder, which test-up.sh detaches) — a child of the vitest worker would stay
 * a zombie while that worker is blocked in spawnSync, and `kill -0` would lie.
 * The command line carries `harness-audit.sh` (a trailing no-op keeps bash from
 * exec-ing sleep directly) because test-up/test-down verify a recorder PID by it.
 */
export function spawnSleeper(seconds = 60) {
  const out = execFileSync("sh", ["-c", `bash -c 'sleep ${seconds}; : harness-audit.sh' >/dev/null 2>&1 & echo $!`], { encoding: "utf8" });
  return Number(out.trim());
}
