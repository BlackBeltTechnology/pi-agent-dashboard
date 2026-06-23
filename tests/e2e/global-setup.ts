import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DASHBOARD_PORT,
  HEALTH_URL,
  MARKER_PATH,
  PI_GATEWAY_PORT,
  TEST_UP,
  USE_RUNNING,
  waitForHealth,
} from "./lifecycle.js";

const CHANGE = "change add-playwright-e2e";

export default async function globalSetup(): Promise<void> {
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
  // Override-as-a-pair: the container binds + listens on exactly the port
  // Playwright probes (D1 override path), keeping baseURL in sync.
  const env = {
    ...process.env,
    PI_E2E_SEED: "1",
    ANTHROPIC_API_KEY: "",
    OPENAI_API_KEY: "",
    GEMINI_API_KEY: "",
    DASHBOARD_PORT: String(DASHBOARD_PORT),
    PI_GATEWAY_PORT: String(PI_GATEWAY_PORT),
  };
  let child;
  try {
    child = spawn("bash", [TEST_UP, "-d"], {
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

  // First run builds the image (slow); warm runs are seconds.
  const healthy = await waitForHealth(180_000);
  if (!healthy) {
    throw new Error(
      `[${CHANGE}] container never became healthy at ${HEALTH_URL} within 180s. ` +
        `Check ${logPath} and docker/test-up.sh.`,
    );
  }
}
