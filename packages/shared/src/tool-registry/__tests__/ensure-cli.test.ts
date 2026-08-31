/**
 * Process-level tests for the TS-backed `ensure` CLI
 * (`packages/shared/bin/pi-dashboard-ensure.mjs` → `ensure-cli.ts`).
 *
 * Exit-code contract: non-zero when a required tool is missing; the
 * `--json` invocation ALWAYS exits 0 with the outcome encoded. A
 * `requiresConfirm` hint on a headless host (no TTY — these spawns are
 * pipe-attached) is auto-denied.
 *
 * Folded scenarios: test-plan #X4 (8.32), #X8 (8.33).
 * L2 exemplar: qa/tests/01-install.sh (spawn + exit-code assertion).
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..", "..", "..");
const BIN = path.join(repoRoot, "packages", "shared", "bin", "pi-dashboard-ensure.mjs");
const FIXTURES = path.join(here, "fixtures", "ensure-cli");

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function run(args: string[], env: Record<string, string> = {}): RunResult {
  const res = spawnSync(process.execPath, [BIN, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, ...env },
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

describe("ensure CLI — exit codes (8.32)", () => {
  it("required missing tool → exit non-zero; --json → exit 0 with outcome", () => {
    const fixture = path.join(FIXTURES, "required-missing.package.json");
    const plain = run([fixture]);
    expect(plain.status, plain.stderr).not.toBe(0);
    expect(plain.stdout).toContain("PI_ENSURE_CLI_UNSET_VAR");

    const json = run([fixture, "--json"]);
    expect(json.status).toBe(0);
    const payload = JSON.parse(json.stdout);
    expect(payload.ok).toBe(false);
    const entry = payload.tools.find((t: { name: string }) => t.name === "PI_ENSURE_CLI_UNSET_VAR");
    expect(entry.action).toBe("blocked");
  }, 90_000);

  it("all required present → exit 0; --json ok:true", () => {
    const fixture = path.join(FIXTURES, "all-present.package.json");
    // The fixture's env-var tool is present via the spawn env — no host
    // dependency (a PATH tool can collide with isAppImageSelfHit).
    const env = { PI_ENSURE_CLI_SET_VAR: "1" };
    expect(run([fixture], env).status).toBe(0);
    const json = run([fixture, "--json"], env);
    expect(json.status).toBe(0);
    expect(JSON.parse(json.stdout).ok).toBe(true);
  }, 90_000);

  it("a bad manifest is a reported doc bug, never a host mutation", () => {
    const fixture = path.join(FIXTURES, "bad-manifest.package.json");
    const plain = run([fixture]);
    expect(plain.status).not.toBe(0);
    expect(plain.stderr).toContain("provide");
    const json = run([fixture, "--json"]);
    expect(json.status).toBe(0);
    expect(JSON.parse(json.stdout).ok).toBe(false);
  }, 90_000);
});

describe("ensure CLI — requiresConfirm auto-deny on a headless host (8.33)", () => {
  const NO_PW_CACHE = { PLAYWRIGHT_BROWSERS_PATH: "/nonexistent-pw-cache" };

  it("required chromium + --install (no TTY) → auto-deny, blocked, exit non-zero", () => {
    const fixture = path.join(FIXTURES, "confirm-required.package.json");
    const res = run(["--install", fixture], NO_PW_CACHE);
    expect(res.status).not.toBe(0);
    expect(res.stdout).toContain("blocked");
    // --json of the same situation still exits 0, outcome encoded.
    const json = run(["--install", fixture, "--json"], NO_PW_CACHE);
    expect(json.status).toBe(0);
    const payload = JSON.parse(json.stdout);
    const chromium = payload.tools.find((t: { name: string }) => t.name === "chromium");
    expect(chromium.action).toBe("blocked");
  }, 120_000);

  it("optional chromium + --install (no TTY) → degraded, exit 0", () => {
    const fixture = path.join(FIXTURES, "confirm-optional.package.json");
    const res = run(["--install", fixture, "--json"], NO_PW_CACHE);
    expect(res.status).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.ok).toBe(true);
    const chromium = payload.tools.find((t: { name: string }) => t.name === "chromium");
    expect(chromium.action).toBe("degraded");
    expect(chromium.optional).toBe(true);
  }, 120_000);
});
