import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import {
  HEALTH_URL,
  MARKER_PATH,
  resolvePortsFromStateFile,
  TEST_UP,
  USE_RUNNING,
  waitForHealth,
} from "./lifecycle.js";

const CHANGE = "change add-playwright-e2e";

// Fail fast (sub-second) if the host Chromium binary is absent, BEFORE the
// container boot (≤180s). Resolves the executable via the @playwright/test
// module (not the node_modules/.bin/playwright shim), so a missing bin symlink
// does not block the suite. executablePath() returns a path even when the
// binary is not downloaded; existsSync is the real gate. try/catch backstops
// versions that throw instead. See change self-heal-host-playwright-browser.
function assertBrowserInstalled(): void {
  // System-browser mode (PW_CHANNEL=chrome/msedge/...) does not use the bundled
  // Chromium; Playwright launches the host browser by channel and errors
  // clearly itself if it is missing. Skip the bundled-binary gate then.
  // See change: adopt-pi-071-072-073-features (PW_CHANNEL system-browser opt-in).
  if (process.env.PW_CHANNEL) return;
  let execPath: string | undefined;
  try {
    execPath = chromium.executablePath();
  } catch {
    execPath = undefined;
  }
  if (!execPath || !fs.existsSync(execPath)) {
    throw new Error(
      "[change self-heal-host-playwright-browser] Chromium for Playwright is not installed. " +
        "Install it first: npx playwright install chromium",
    );
  }
}

/**
 * Poll the workspace state file + health endpoint until a derived dashboard port
 * is healthy. Re-reads .pi-test-harness.json EACH iteration so a bind-collision
 * retry that rewrites the ports (change fix-parallel-e2e-docker-collisions D2) is
 * followed instead of pinning a stale, abandoned port. First run builds the
 * image (slow); warm runs are seconds. Throws on timeout.
 */
async function bootHealthyPorts(
  workspace: string,
  logPath: string,
  timeoutMs: number,
): Promise<{ dashboardPort: number; gatewayPort: number }> {
  const deadline = Date.now() + timeoutMs;
  let ports: { dashboardPort: number; gatewayPort: number } | undefined;
  while (Date.now() < deadline) {
    try {
      ports = resolvePortsFromStateFile(workspace);
    } catch {
      // state file not written yet (or mid-rewrite) — keep waiting
      await new Promise((r) => setTimeout(r, 1_000));
      continue;
    }
    try {
      const res = await fetch(`http://localhost:${ports.dashboardPort}/api/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok) return ports;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  const where = ports
    ? `${ports.dashboardPort}/${ports.gatewayPort}`
    : "none (state file never written)";
  throw new Error(
    `[${CHANGE}] container never became healthy within ${timeoutMs / 1_000}s ` +
      `(last ports: ${where}). Check ${logPath} and docker/test-up.sh.`,
  );
}

export default async function globalSetup(): Promise<void> {
  // Preflight FIRST: never pay the container boot only to die at browser launch.
  assertBrowserInstalled();

  fs.mkdirSync(path.dirname(MARKER_PATH), { recursive: true });

  if (USE_RUNNING) {
    // Fast path: caller owns a container already up. Only verify health.
    const healthy = await waitForHealth(30_000);
    if (!healthy) {
      throw new Error(
        `[${CHANGE}] PW_E2E_USE_RUNNING=1 but ${HEALTH_URL} is not healthy. ` +
          `Start the harness first: docker/test-up.sh`,
      );
    }
    // Not managed by us — ensure no stale marker triggers a teardown.
    if (fs.existsSync(MARKER_PATH)) fs.rmSync(MARKER_PATH);
    return;
  }

  // Managed lifecycle: boot the container detached from a throwaway workspace
  // dir so test-up's HOST_CWD overlay never lands on the repo.
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "pi-e2e-ws-"));
  const logPath = path.join(path.dirname(MARKER_PATH), "test-up.log");
  const logFd = fs.openSync(logPath, "a");
  // PI_E2E_SEED=1 tells test-entrypoint.sh to seed a fake provider credential
  // (clears the LandingPage onboarding gate) and open the network guard (lets
  // the in-container browser reach guarded endpoints like directory listing).
  // Without it, scenario specs cannot pin a folder or spawn a session. Blank
  // any host provider keys so they never leak into the disposable container.
  // Ports are NOT pre-pinned: test-up.sh hash-derives them in-window from the
  // unique workspace path (change fix-parallel-e2e-docker-collisions D1); we
  // read the chosen pair back from the state file below.
  const env = {
    ...process.env,
    PI_E2E_SEED: "1",
    ANTHROPIC_API_KEY: "",
    OPENAI_API_KEY: "",
    GEMINI_API_KEY: "",
  };
  // Strip any inherited port pins so test-up.sh always derives in-window. A
  // caller-exported DASHBOARD_PORT/PI_GATEWAY_PORT (the pair test-up.sh reads)
  // would be honoured verbatim (PORTS_PINNED), skip derivation, and reintroduce
  // cross-worktree collisions. PW_E2E_PORT/PW_GATEWAY_PORT are Playwright-host
  // vars test-up.sh ignores, but strip them too for defense-in-depth.
  delete env.DASHBOARD_PORT;
  delete env.PI_GATEWAY_PORT;
  delete env.PW_E2E_PORT;
  delete env.PW_GATEWAY_PORT;
  let child;
  try {
    // --build is MANDATORY for the managed path: the dashboard server+client run
    // from BAKED image source under a per-worktree tag (D3). Without it a run
    // silently tests whichever worktree built the tag first. BuildKit caches
    // all but the COPY packages layer, so the rebuild stays cheap.
    child = spawn("bash", [TEST_UP, "-d", "--build"], {
      cwd: workspace,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env,
    });
  } finally {
    fs.closeSync(logFd);
  }
  child.unref();

  // Mark managed BEFORE the wait so a crash mid-boot still gets torn down.
  fs.writeFileSync(MARKER_PATH, JSON.stringify({ workspace, pid: child.pid, logPath }));

  const ports = await bootHealthyPorts(workspace, logPath, 180_000);
  // Lock in the healthy ports so worker processes (spawned after this) inherit
  // the container port → baseURL in sync.
  process.env.PW_E2E_PORT = String(ports.dashboardPort);
  process.env.PW_GATEWAY_PORT = String(ports.gatewayPort);
}
