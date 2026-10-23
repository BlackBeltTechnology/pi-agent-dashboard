/**
 * An unknown subcommand word exits 2 with a usage line and binds nothing; a flag-only invocation
 * still means "run in the foreground"; `--port N api …` reaches `api`.
 * Real wrapper process. See change: close-container-loopback-impersonation (D4; test-plan #E18).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const WRAPPER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../bin/pi-dashboard.mjs");
const cleanup: Array<() => void> = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

function cli(args: string[]) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cli-unknown-"));
  cleanup.push(() => fs.rmSync(home, { recursive: true, force: true }));
  const r = spawnSync(process.execPath, [WRAPPER, ...args], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    encoding: "utf-8",
    timeout: 60_000,
  });
  return { ...r, home };
}

describe("E18 — unknown subcommand word (real wrapper)", () => {
  it("`frobnicate` exits 2 with a usage line, starts no server and writes no config", () => {
    const r = cli(["frobnicate"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("unknown subcommand 'frobnicate'");
    expect(r.stderr).toContain("usage: pi-dashboard");
    expect(r.stdout).not.toMatch(/Dashboard server running/);
    // Refused before ensureConfig(): nothing was created under the HOME.
    expect(fs.existsSync(path.join(r.home, ".pi", "dashboard", "config.json"))).toBe(false);
  }, 70_000);

  it("`--port 9000 api GET /api/health` reaches `api`: exit 2 'server not running' (nothing listens), not the foreground server", () => {
    const r = cli(["--port", "9000", "api", "GET", "/api/health"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/not running/);
    expect(r.stdout).not.toMatch(/Dashboard server running/);
  }, 70_000);
});
