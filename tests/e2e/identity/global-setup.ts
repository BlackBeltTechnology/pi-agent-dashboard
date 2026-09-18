import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolvePortsFromStateFile, TEST_UP, USE_RUNNING } from "../lifecycle.js";
import { IDENTITY_ISSUER_PORT, IDENTITY_MARKER_PATH } from "./identity-lifecycle.js";

const CHANGE = "change add-multi-user-identity-plane";

/**
 * Boot an IDENTITY-ACTIVE all-in-one harness for the §11.2 two-user isolation
 * specs. Separate from the shared harness (tests/e2e/global-setup.ts) because an
 * active resolver refuses ordinary browser sockets (§9.2) — these specs drive
 * raw HTTP + `ws` with minted bearers, no page.
 *
 * Layers `compose.test.identity.yml` (TEST_EXTRA_COMPOSE) so test-entrypoint.sh
 * boots the fake OIDC issuer, seeds the resolver at it, and seeds one Anna-owned
 * + one Béla-owned session. Publishes the issuer port on loopback so the host
 * mints via POST /mint.
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
      await new Promise((r) => setTimeout(r, 1_000));
      continue;
    }
    try {
      const res = await fetch(`http://localhost:${ports.dashboardPort}/api/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok) return ports;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(
    `[${CHANGE}] identity harness never became healthy within ${timeoutMs / 1_000}s. ` +
      `Check ${logPath} and docker/test-up.sh.`,
  );
}

export default async function identityGlobalSetup(): Promise<void> {
  fs.mkdirSync(path.dirname(IDENTITY_MARKER_PATH), { recursive: true });

  if (USE_RUNNING) {
    // Attach: caller booted `TEST_EXTRA_COMPOSE=compose.test.identity.yml
    // docker/test-up.sh`; trust PW_E2E_PORT.
    if (fs.existsSync(IDENTITY_MARKER_PATH)) fs.rmSync(IDENTITY_MARKER_PATH);
    return;
  }

  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "pi-identity-e2e-ws-"));
  const logPath = path.join(path.dirname(IDENTITY_MARKER_PATH), "identity-test-up.log");
  const logFd = fs.openSync(logPath, "a");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PI_E2E_SEED: "1",
    // Activate the identity plane (overlay sets PI_E2E_IDENTITY + publishes the
    // issuer port); no shared-harness peers/OAuth noise needed here.
    TEST_EXTRA_COMPOSE: "compose.test.identity.yml",
    PI_E2E_IDENTITY_PORT: String(IDENTITY_ISSUER_PORT),
    // No flow peers: identity specs drive HTTP/WS directly. Empty (not "no",
    // which the entrypoint flags invalid) ⇒ the peer-wiring path is skipped.
    PI_TEST_PEERS: "",
    PI_E2E_OAUTH: "",
    PI_E2E_INDEPENDENT_SESSION: "0",
    ANTHROPIC_API_KEY: "",
    OPENAI_API_KEY: "",
    GEMINI_API_KEY: "",
  };
  delete env.DASHBOARD_PORT;
  delete env.PI_GATEWAY_PORT;
  delete env.PW_E2E_PORT;
  delete env.PW_GATEWAY_PORT;

  let child;
  try {
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

  fs.writeFileSync(IDENTITY_MARKER_PATH, JSON.stringify({ workspace, pid: child.pid, logPath }));

  // Cold builds rebuild the pnpm layer (packages/ change busts the COPY cache);
  // allow generously so a from-scratch image build + boot fits.
  const ports = await bootHealthyPorts(workspace, logPath, 600_000);
  process.env.PW_E2E_PORT = String(ports.dashboardPort);
  process.env.PW_GATEWAY_PORT = String(ports.gatewayPort);
}
