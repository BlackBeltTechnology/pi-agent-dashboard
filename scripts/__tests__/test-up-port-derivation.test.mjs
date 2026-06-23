/**
 * Unit tests for the parallel-worktree test-harness port/project derivation.
 *
 * Covers (test-plan parallelize-test-harness):
 *   - 6.1 is_free / find_free_in_window pick a free port, skip a held one;
 *         same HOST_CWD → same hash (determinism); distinct HOST_CWD →
 *         distinct compose-legal project names.
 *   - 6.2 state-file shape: test-up.sh writes a parseable .pi-test-harness.json
 *         with project + numeric ports inside the expected windows.
 *   - 6.3 compose interpolation: rendered config publishes == listens, and the
 *         container env DASHBOARD_PORT tracks the exported port (skip w/o docker).
 *   - 6.4 no-docker guard: docker-dependent legs skip-with-message.
 *
 * See change: parallelize-test-harness.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DOCKER_DIR = path.join(REPO_ROOT, "docker");
const LIB = path.join(DOCKER_DIR, "lib-ports.sh");
const TEST_UP = path.join(DOCKER_DIR, "test-up.sh");

/** Run a snippet with lib-ports.sh sourced; return trimmed stdout. */
function lib(script) {
  return execFileSync("bash", ["-c", `source "${LIB}"; ${script}`], {
    encoding: "utf8",
  }).trim();
}

function hasDocker() {
  try {
    execFileSync("docker", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Bind a loopback port and keep it held for the duration of `fn`. */
async function withHeldPort(fn) {
  const srv = net.createServer();
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;
  try {
    return await fn(port);
  } finally {
    await new Promise((r) => srv.close(r));
  }
}

describe("lib-ports derivation", () => {
  it("derive_hash is deterministic + numeric for the same HOST_CWD", () => {
    const a = lib(`derive_hash "/wt/a"`);
    const b = lib(`derive_hash "/wt/a"`);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9]+$/);
  });

  it("derive_project is compose-legal + distinct for distinct HOST_CWD", () => {
    const a = lib(`derive_project "/wt/a"`);
    const b = lib(`derive_project "/wt/b"`);
    expect(a).toMatch(/^pi-dash-test-[0-9]+$/);
    expect(b).toMatch(/^pi-dash-test-[0-9]+$/);
    expect(a).not.toBe(b);
  });

  it("base offsets land inside the disjoint windows", () => {
    const baseDash = Number(lib(`h=$(derive_hash "/some/wt"); echo $(( 18000 + h % 1000 ))`));
    const baseGw = Number(lib(`h=$(derive_hash "/some/wt"); echo $(( 19000 + h % 1000 ))`));
    expect(baseDash).toBeGreaterThanOrEqual(18000);
    expect(baseDash).toBeLessThanOrEqual(18999);
    expect(baseGw).toBeGreaterThanOrEqual(19000);
    expect(baseGw).toBeLessThanOrEqual(19999);
  });

  it("is_free reports an unused high port free", () => {
    expect(lib(`if is_free 65432; then echo free; else echo busy; fi`)).toBe("free");
  });

  it("find_free_in_window skips a held port", async () => {
    await withHeldPort((held) => {
      const out = Number(lib(`find_free_in_window ${held} ${held} ${held + 3}`));
      expect(out).toBeGreaterThan(held);
      expect(out).toBeLessThanOrEqual(held + 3);
    });
  });

  it("find_free_in_window fails when the window is exhausted", async () => {
    await withHeldPort((held) => {
      let failed = false;
      let stderr = "";
      try {
        execFileSync("bash", ["-c", `source "${LIB}"; find_free_in_window ${held} ${held} ${held}`], {
          encoding: "utf8",
        });
      } catch (e) {
        failed = true;
        stderr = String(e.stderr ?? "");
      }
      expect(failed).toBe(true);
      expect(stderr).toMatch(/no free port|exhausted/);
    });
  });
});

describe("test-up.sh state file", () => {
  // Stub `docker` so the final `exec docker compose ... up` is a no-op; the
  // state file is written before exec, so no real Docker is needed here.
  function runTestUp(workspace) {
    const fakeBin = mkdtempSync(path.join(os.tmpdir(), "pi-fakebin-"));
    const dockerStub = path.join(fakeBin, "docker");
    writeFileSync(dockerStub, "#!/usr/bin/env bash\nexit 0\n");
    chmodSync(dockerStub, 0o755);
    try {
      execFileSync("bash", [TEST_UP, "-d"], {
        cwd: workspace,
        env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}`, TEST_COPY_MODE: "1" },
        encoding: "utf8",
      });
    } finally {
      rmSync(fakeBin, { recursive: true, force: true });
    }
    return JSON.parse(readFileSync(path.join(workspace, ".pi-test-harness.json"), "utf8"));
  }

  it("writes parseable state with ports in the expected windows", () => {
    const ws = mkdtempSync(path.join(os.tmpdir(), "pi-harness-"));
    try {
      const state = runTestUp(ws);
      expect(state.project).toMatch(/^pi-dash-test-[0-9]+$/);
      expect(state.dashboardPort).toBeGreaterThanOrEqual(18000);
      expect(state.dashboardPort).toBeLessThanOrEqual(18999);
      expect(state.gatewayPort).toBeGreaterThanOrEqual(19000);
      expect(state.gatewayPort).toBeLessThanOrEqual(19999);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it("derives the same port for the same worktree across runs", () => {
    const ws = mkdtempSync(path.join(os.tmpdir(), "pi-harness-"));
    try {
      const first = runTestUp(ws);
      const second = runTestUp(ws);
      expect(second.dashboardPort).toBe(first.dashboardPort);
      expect(second.gatewayPort).toBe(first.gatewayPort);
      expect(second.project).toBe(first.project);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!hasDocker())("compose interpolation (requires docker)", () => {
  it("published port tracks listen port + container env", () => {
    const out = execFileSync(
      "docker",
      [
        "compose",
        "-f",
        path.join(DOCKER_DIR, "compose.yml"),
        "-f",
        path.join(DOCKER_DIR, "compose.test.yml"),
        "config",
      ],
      {
        cwd: DOCKER_DIR,
        env: { ...process.env, DASHBOARD_PORT: "18042", PI_GATEWAY_PORT: "19042", HOST_CWD: "/tmp" },
        encoding: "utf8",
      },
    );
    // Published host port == in-container listen port (no drift), dashboard.
    expect(out).toMatch(/published:\s*"?18042"?/);
    expect(out).toMatch(/target:\s*18042/);
    // Container env DASHBOARD_PORT tracks the exported value.
    expect(out).toMatch(/DASHBOARD_PORT:\s*"?18042"?/);
    // Same for the gateway port — guards against the gateway env re-hardcoding.
    expect(out).toMatch(/published:\s*"?19042"?/);
    expect(out).toMatch(/target:\s*19042/);
    expect(out).toMatch(/PI_GATEWAY_PORT:\s*"?19042"?/);
  });
});

if (!hasDocker()) {
  // eslint-disable-next-line no-console
  console.log("[parallelize-test-harness] docker absent — compose-interpolation leg skipped");
}
