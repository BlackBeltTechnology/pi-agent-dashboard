import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Repo root = two levels up from tests/e2e/.
export const REPO_ROOT = path.resolve(__dirname, "..", "..");
export const DOCKER_DIR = path.join(REPO_ROOT, "docker");
export const TEST_UP = path.join(DOCKER_DIR, "test-up.sh");
export const TEST_DOWN = path.join(DOCKER_DIR, "test-down.sh");

export const HEALTH_URL = "http://localhost:18000/api/health";

// Lifecycle marker: written by global-setup when IT booted the container,
// read by global-teardown to decide whether to tear down. Survives crash/retry.
export const MARKER_PATH = path.join(REPO_ROOT, "test-results", ".e2e-managed");

export const USE_RUNNING = process.env.PW_E2E_USE_RUNNING === "1";

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
