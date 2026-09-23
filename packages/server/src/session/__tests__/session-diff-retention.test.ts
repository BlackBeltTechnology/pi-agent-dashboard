/**
 * Heap-retention regression guard for issue #719 (fix-session-diff-heap-
 * retention D1). A cached per-file `gitDiff` must not pin the whole batched
 * `git diff` output. Measured in a CHILD `node --expose-gc` process (no V8 flag
 * leaks into the vitest worker); a missing `gc` fails rather than skips.
 * Fixture: `fixtures/session-diff-retention.fixture.ts` (prints JSON last).
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../../../..");
const fixture = path.join(__dirname, "fixtures", "session-diff-retention.fixture.ts");

interface Probe {
  e1: number;
  e2: number;
  e3: number;
  payloadMB: number;
  error?: string;
}

let probe: Probe;

beforeAll(() => {
  const out = execFileSync(process.execPath, ["--expose-gc", "--import", "tsx", fixture], {
    cwd: repoRoot,
    timeout: 60_000,
    encoding: "utf8",
  });
  const lines = out.trim().split("\n");
  probe = JSON.parse(lines[lines.length - 1]) as Probe;
  expect(probe.error).toBeUndefined();
}, 90_000);

describe("session-diff heap retention (V8, --expose-gc child)", () => {
  it("E1: a small cached gitDiff does not retain the 30 MB batched diff", () => {
    expect(probe.e1).toBeLessThan(5);
  });

  it("E2 control: the old `chunk.trim()` storage form still retains the batched diff", () => {
    // Anti-vacuous arm: if V8 stops slicing, E1 would pass for the wrong reason.
    if (!(probe.e2 > 0.8 * probe.payloadMB)) {
      throw new Error(`control no longer retains — revisit D1 (retained ${probe.e2.toFixed(1)} MB)`);
    }
  });

  it("E3: five cached generations of 20 MB diffs do not multiply retention", () => {
    expect(probe.e3).toBeLessThan(10);
  });
});
