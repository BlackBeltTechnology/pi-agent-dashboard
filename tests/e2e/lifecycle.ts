import { fileURLToPath } from "node:url";
import net from "node:net";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Repo root = two levels up from tests/e2e/.
export const REPO_ROOT = path.resolve(__dirname, "..", "..");
export const DOCKER_DIR = path.join(REPO_ROOT, "docker");
export const TEST_UP = path.join(DOCKER_DIR, "test-up.sh");
export const TEST_DOWN = path.join(DOCKER_DIR, "test-down.sh");

export const USE_RUNNING = process.env.PW_E2E_USE_RUNNING === "1";

/** Bind :0 on loopback to learn a free port, then release it. */
function probeFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

// Resolve the harness ports ONCE for the whole Playwright run. The main process
// (config + global-setup) probes; the chosen port is written back into
// process.env so the worker processes (which re-import this config) INHERIT it
// instead of probing a fresh, mismatching port. Keeps baseURL == container port.
//   - USE_RUNNING (attach): trust PW_E2E_PORT (default 18000) / PW_GATEWAY_PORT.
//   - Managed: probe a free port; global-setup exports it into test-up.sh so the
//     container publishes + listens on exactly what Playwright probes.
async function resolvePort(envKey: string, attachDefault: number): Promise<number> {
  const existing = process.env[envKey];
  if (existing !== undefined && existing !== "") {
    const parsed = Number(existing);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
      throw new Error(`Invalid ${envKey}: "${existing}". Expected an integer port in [1, 65535].`);
    }
    return parsed;
  }
  if (USE_RUNNING) return attachDefault;
  const port = await probeFreePort();
  process.env[envKey] = String(port); // propagate to worker processes at spawn
  return port;
}

export const DASHBOARD_PORT = await resolvePort("PW_E2E_PORT", 18000);
export const PI_GATEWAY_PORT = await resolvePort("PW_GATEWAY_PORT", 18999);

export const BASE_URL = `http://localhost:${DASHBOARD_PORT}`;
export const HEALTH_URL = `${BASE_URL}/api/health`;

// Lifecycle marker: written by global-setup when IT booted the container,
// read by global-teardown to decide whether to tear down. Survives crash/retry.
export const MARKER_PATH = path.join(REPO_ROOT, "test-results", ".e2e-managed");

/** Poll the health endpoint until 200 or timeout. Resolves true on healthy. */
export async function waitForHealth(timeoutMs: number, intervalMs = 2_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(5_000) });
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
