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
 *
 * SPLIT of `ensure-cli.test.ts` (third file: bad manifest, 8.32) — six serial CLI spawns in one
 * file overran the E14 20 s CI budget under runner contention (21.5-23.6 s).
 * See change: test-trust-audit (design D7).
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
