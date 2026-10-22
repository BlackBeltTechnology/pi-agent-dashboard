/**
 * `PI_DASHBOARD_CLI` in the exec env of executable-mode templates: an absolute, shell-quoted
 * command that runs the CLI shipped with the bridge, usable with no `pi-dashboard` on PATH.
 * See change: close-container-loopback-impersonation (D5; test-plan #E21).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const cleanup: Array<() => void> = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
  vi.resetModules();
  vi.doUnmock("../server-launcher.js");
});

/** Async on purpose: a fake server in THIS process must keep answering while the child runs. */
function bash(command: string, env: Record<string, string>): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-c", command], {
      // deliberately no `pi-dashboard` on PATH, and no repo bin dir; node is referenced by absolute path
      env: { ...env, PATH: "/usr/bin:/bin" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

describe("E21 — PI_DASHBOARD_CLI", () => {
  it("is absolute and shell-quoted: an install path with a space and a quote reaches the CLI as ONE argument each", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cli env "));
    cleanup.push(() => fs.rmSync(root, { recursive: true, force: true }));
    const serverDir = path.join(root, "it's server");
    fs.mkdirSync(path.join(serverDir, "src"), { recursive: true });
    fs.mkdirSync(path.join(serverDir, "bin"), { recursive: true });
    // A stand-in wrapper that reports exactly the argv it received.
    fs.writeFileSync(path.join(serverDir, "bin", "pi-dashboard.mjs"), "console.log(JSON.stringify(process.argv.slice(2)));\n");
    vi.doMock("../server-launcher.js", () => ({ resolveServerCliPath: () => path.join(serverDir, "src", "cli.ts") }));
    const { buildDashboardExecEnv } = await import("../command-handler.js");

    const env = buildDashboardExecEnv();
    expect(path.isAbsolute(env.PI_DASHBOARD_CLI!.split(" ")[0]!.replace(/^'/, ""))).toBe(true);
    expect(env.PI_DASHBOARD_CLI).toContain("'"); // quoting was needed and applied
    const r = await bash('eval "$PI_DASHBOARD_CLI" api GET /api/health', env);
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual(["api", "GET", "/api/health"]);
  });

  it("with the REAL CLI: `eval \"$PI_DASHBOARD_CLI\" api GET /api/health` exits 0 against a running server with no pi-dashboard on PATH", async () => {
    const seen: Array<{ url?: string; proof?: string }> = [];
    const server = http.createServer((req, res) => {
      seen.push({ url: req.url, proof: String(req.headers["x-pi-local-proof"] ?? "") });
      res.setHeader("content-type", "application/json");
      res.end('{"ok":true}');
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    cleanup.push(() => server.close());
    const port = (server.address() as AddressInfo).port;
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "cli-env-home-"));
    cleanup.push(() => fs.rmSync(home, { recursive: true, force: true }));

    const { buildDashboardExecEnv } = await import("../command-handler.js");
    const baseEnv = { ...buildDashboardExecEnv(), HOME: home, USERPROFILE: home, PI_DASHBOARD_PORT: String(port) };
    const r = await bash('eval "$PI_DASHBOARD_CLI" api GET /api/health', baseEnv);
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ ok: true });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe("/api/health");
    expect(seen[0]?.proof).toMatch(/^v1\./);
  }, 90_000);

  it("buildDashboardExecEnv still sets PI_DASHBOARD_PORT and PI_DASHBOARD_BASE", async () => {
    const { buildDashboardExecEnv } = await import("../command-handler.js");
    const env = buildDashboardExecEnv();
    expect(env.PI_DASHBOARD_BASE).toBe(`http://localhost:${env.PI_DASHBOARD_PORT}`);
    expect(env.PI_DASHBOARD_CLI).toBeTruthy();
  });
});
