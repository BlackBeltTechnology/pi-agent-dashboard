import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Repo root = two levels up from tests/e2e/.
export const REPO_ROOT = path.resolve(__dirname, "..", "..");
export const DOCKER_DIR = path.join(REPO_ROOT, "docker");
export const TEST_UP = path.join(DOCKER_DIR, "test-up.sh");
export const TEST_DOWN = path.join(DOCKER_DIR, "test-down.sh");

export const USE_RUNNING = process.env.PW_E2E_USE_RUNNING === "1";

// Resolve the harness ports from env (PW_E2E_PORT / PW_GATEWAY_PORT), defaulting
// to the attach window (18000 / 18999). Managed mode no longer probes raw
// ephemeral ports: test-up.sh hash-derives the pair in disjoint windows and
// records them in the workspace state file; global-setup reads them back (via
// resolvePortsFromStateFile) and writes PW_E2E_PORT / PW_GATEWAY_PORT into
// process.env BEFORE workers spawn, so worker processes (which re-import this
// module) INHERIT the container port and baseURL stays in sync.
//   - USE_RUNNING (attach): trust PW_E2E_PORT (default 18000) / PW_GATEWAY_PORT.
//   - Managed (main process at config load): defaults are placeholders; the real
//     ports are resolved by global-setup from the state file before any worker
//     runs, so the main process baseURL is never used to drive a test.
function resolvePort(envKey: string, attachDefault: number): number {
  const existing = process.env[envKey];
  if (existing !== undefined && existing !== "") {
    const parsed = Number(existing);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
      throw new Error(`Invalid ${envKey}: "${existing}". Expected an integer port in [1, 65535].`);
    }
    return parsed;
  }
  return attachDefault;
}

export const DASHBOARD_PORT = resolvePort("PW_E2E_PORT", 18000);
export const PI_GATEWAY_PORT = resolvePort("PW_GATEWAY_PORT", 18999);

export const BASE_URL = `http://localhost:${DASHBOARD_PORT}`;
export const HEALTH_URL = `${BASE_URL}/api/health`;

// Lifecycle marker: written by global-setup when IT booted the container,
// read by global-teardown to decide whether to tear down. Survives crash/retry.
export const MARKER_PATH = path.join(REPO_ROOT, "test-results", ".e2e-managed");

/**
 * Read the dashboard + gateway host ports chosen by test-up.sh from the
 * `.pi-test-harness.json` state file written into the throwaway workspace.
 * Managed mode only. Throws if the file is absent/unparseable/malformed so the
 * caller can keep polling until test-up.sh has written it.
 */
export function resolvePortsFromStateFile(workspace: string): {
  dashboardPort: number;
  gatewayPort: number;
} {
  const stateFile = path.join(workspace, ".pi-test-harness.json");
  const parsed = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  const dashboardPort = Number(parsed.dashboardPort);
  const gatewayPort = Number(parsed.gatewayPort);
  // Same bounds as the env-port path: reject 0 / >65535 so a malformed state
  // file can't yield an unusable healthUrl.
  const inRange = (p: number) => Number.isInteger(p) && p >= 1 && p <= 65_535;
  if (!inRange(dashboardPort) || !inRange(gatewayPort)) {
    throw new Error(
      `Malformed ${stateFile}: dashboardPort/gatewayPort must be integer ports in [1, 65535]`,
    );
  }
  return { dashboardPort, gatewayPort };
}

/**
 * Compose project name test-up.sh derived for this workspace (state file
 * `project`). Undefined when the file is absent/malformed: this runs on the
 * FAILURE path, so it degrades to "nothing to inspect" instead of throwing.
 */
export function resolveHarnessProject(workspace: string): string | undefined {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(workspace, ".pi-test-harness.json"), "utf8"),
    ) as { project?: unknown };
    return typeof parsed.project === "string" && parsed.project ? parsed.project : undefined;
  } catch {
    return undefined;
  }
}

/** Where globalSetup writes its container state + log snapshot on a boot failure. */
export function harnessFailureLogPath(logPath: string): string {
  return path.join(path.dirname(logPath), "harness-failure.log");
}

/** Injectable docker invocation, so the report builders stay unit-testable. */
export interface DockerProbe {
  (args: string[]): { status: number; stdout: string; stderr: string };
}

const defaultDockerProbe: DockerProbe = (args) => {
  const res = spawnSync("docker", args, { encoding: "utf8", timeout: 20_000 });
  return { status: res.status ?? 1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
};

/** Names of the containers in a harness compose project (empty when none). */
function harnessContainerNames(project: string, probe: DockerProbe): string[] {
  return probe([
    "ps",
    "-a",
    "--filter",
    `label=com.docker.compose.project=${project}`,
    "--format",
    "{{.Names}}",
  ])
    .stdout.split("\n")
    .map((n) => n.trim())
    .filter(Boolean);
}

/**
 * Docker restart count of the harness container, or undefined before it exists.
 *
 * compose.test.yml sets `restart: unless-stopped` (so `/api/restart` works), so
 * an entrypoint that FAILS after `Container ... Started` looks exactly like a
 * slow boot — except for this count, which increments on every respawn.
 */
export function harnessRestartCount(
  workspace: string,
  probe: DockerProbe = defaultDockerProbe,
): number | undefined {
  const project = resolveHarnessProject(workspace);
  if (!project) return undefined;
  const name = harnessContainerNames(project, probe)[0];
  if (!name) return undefined;
  const raw = probe(["inspect", "-f", "{{.RestartCount}}", name]).stdout.trim();
  // `Number("") === 0`: an inspect that FAILED with empty stdout must read as
  // "unknown", not "zero restarts", or a busy daemon hides a crash-loop.
  if (raw === "") return undefined;
  const n = Number(raw);
  return Number.isInteger(n) ? n : undefined;
}

/** Change name for triage brackets in harness-lifecycle error messages. */
const LIFECYCLE_CHANGE = "change stabilize-browser-e2e";

/**
 * Docker restart count that proves a crash-loop. Two separate restarts can
 * never be a healthy boot: PID 1 only exits on a failed entrypoint.
 */
const CRASH_LOOP_RESTARTS = 2;

/**
 * Throw when the harness container is crash-looping.
 *
 * compose.test.yml sets `restart: unless-stopped` (so `/api/restart` works), so
 * an entrypoint that FAILS after `Container ... Started` looks exactly like a
 * slow boot in the health poll. This is the only signal that separates them.
 * Reporting it in ~2min beats burning a 20-min CI budget on a poll that cannot
 * win. `probe` is injectable so the policy is unit-testable without a daemon.
 */
export function throwIfCrashLooping(
  workspace: string,
  logPath: string,
  probe: DockerProbe = defaultDockerProbe,
): void {
  const restarts = harnessRestartCount(workspace, probe);
  if (restarts === undefined || restarts < CRASH_LOOP_RESTARTS) return;
  const dump = captureHarnessFailure(workspace, logPath, probe);
  throw new Error(
    `[${LIFECYCLE_CHANGE}] harness container is crash-looping (restarts=${restarts}): ` +
      `the entrypoint failed after "Container ... Started". ` +
      `${dump ? `Container state + logs: ${dump}. ` : ""}See ${logPath}.`,
  );
}

/**
 * Compose project for the CURRENT run — what spec code needs to reach the
 * harness container.
 *
 * globalSetup boots the managed harness from a THROWAWAY workspace, so the
 * state file lands THERE, not at the repo root; it exports the project to
 * workers as `PW_E2E_PROJECT` (same mechanism as `PW_E2E_PORT`). The repo-root
 * file is only the manual fallback (`docker/test-up.sh` run from the repo).
 * Reading the repo-root file directly made 11 specs die with
 * `ENOENT .../pi-agent-dashboard/.pi-test-harness.json` on every CI shard.
 */
export function harnessProject(repoRoot: string = REPO_ROOT): string {
  const fromEnv = process.env.PW_E2E_PROJECT;
  if (fromEnv) return fromEnv;
  const project = resolveHarnessProject(repoRoot);
  if (!project) {
    throw new Error(
      `no harness compose project: PW_E2E_PROJECT is unset and ` +
        `${path.join(repoRoot, ".pi-test-harness.json")} carries none`,
    );
  }
  return project;
}

/**
 * Snapshot a container that booted but never answered `/api/health`.
 *
 * test-up.sh's output ends at `Container ... Started` (compose returns as soon
 * as the container is up), so an entrypoint that then crash-loops leaves NO
 * trace anywhere — how the first CI dispatches failed with no diagnosable
 * cause. Collect the container's state + a tail of its logs into a bundle the
 * workflow uploads. Never throws: a diagnostic must not mask the real failure.
 *
 * Returns the bundle path, or undefined when no project/container was found.
 */
export function captureHarnessFailure(
  workspace: string,
  logPath: string,
  probe: DockerProbe = defaultDockerProbe,
): string | undefined {
  const project = resolveHarnessProject(workspace);
  if (!project) return undefined;
  const names = harnessContainerNames(project, probe);
  if (names.length === 0) return undefined;

  const parts = [`harness project: ${project}`, `containers: ${names.join(", ")}`];
  for (const name of names) {
    const state = probe([
      "inspect",
      "-f",
      "status={{.State.Status}} restarts={{.RestartCount}} exit={{.State.ExitCode}}",
      name,
    ]);
    parts.push(`--- ${name} state ---\n${(state.stdout || state.stderr).trim()}`);
    const logs = probe(["logs", "--tail", "200", name]);
    parts.push(`--- ${name} logs (tail 200) ---\n${(logs.stdout + logs.stderr).trim()}`);
  }

  const out = harnessFailureLogPath(logPath);
  try {
    // The real caller (globalSetup) already created this dir, but the helper is
    // best-effort: it must not throw on a path that is not there yet.
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${parts.join("\n\n")}\n`);
  } catch {
    return undefined;
  }
  return out;
}

/** Poll the health endpoint until 200 or timeout. Resolves true on healthy. */
export async function waitForHealth(
  timeoutMs: number,
  intervalMs = 2_000,
  healthUrl: string = HEALTH_URL,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(5_000) });
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
