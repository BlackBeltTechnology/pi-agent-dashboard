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
