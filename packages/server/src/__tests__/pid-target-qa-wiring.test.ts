/**
 * X86: the L2 pid-target scripts are wired into the cross-platform gateway
 * workflow — the Windows job runs the pwsh script (a non-zero exit fails the
 * step), the POSIX matrix runs the bash script, and both scripts exist.
 * See change: scope-pids-to-namespace.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");
const wf = readFileSync(join(ROOT, ".github", "workflows", "ci-gateway-platform.yml"), "utf8");

function jobBody(name: string): string {
  const start = wf.indexOf(`\n  ${name}:\n`);
  expect(start).toBeGreaterThan(-1);
  const next = wf.slice(start + 1).search(/\n {2}[a-z][\w-]*:\n/);
  return next === -1 ? wf.slice(start) : wf.slice(start, start + 1 + next);
}

describe("X86: pid-target QA scripts are wired into CI", () => {
  it("the windows job runs 54-windows-pid-target.ps1 under pwsh", () => {
    const body = jobBody("windows");
    expect(body).toMatch(/runs-on: windows-latest/);
    expect(body).toMatch(/shell: pwsh[\s\S]*?run: \.\/qa\/tests\/54-windows-pid-target\.ps1/);
  });

  it("the posix matrix runs 54-pid-target.sh", () => {
    expect(jobBody("posix")).toMatch(/run: bash qa\/tests\/54-pid-target\.sh/);
  });

  it("both scripts and the shared probe exist", () => {
    for (const f of ["54-pid-target.sh", "54-windows-pid-target.ps1", "lib/pid-target-probe.ts"]) {
      expect(existsSync(join(ROOT, "qa", "tests", f))).toBe(true);
    }
  });
});
