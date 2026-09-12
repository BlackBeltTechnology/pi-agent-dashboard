import { describe, it, expect } from "vitest";
import { tokenize } from "../chat/linkify-tool-output.js";

/**
 * Perf smoke test. Design budget is < 50 ms locally for ~2 MB of grep-style
 * output; the assertion carries a hard ceiling with contention headroom.
 * Measured ~69 ms isolated; a saturated 8-fork full-suite run inflated it past
 * the old 250 ms ceiling while the tokenizer was merely starved, not slow. The
 * 1000 ms ceiling is ~14x the isolated cost and still fires on a real
 * complexity regression (a superlinear scan on 2 MB lands in whole seconds).
 * See change: contention-harden-real-process-tests (poll-or-budget rule). See
 * spec `tool-output-linkification` — "Tokenizer performance and overflow cap".
 */

function buildSyntheticGrepOutput(targetBytes: number): string {
  const line = "packages/client/src/foo.ts:42:7: error TS2322: type mismatch here\n";
  const reps = Math.ceil(targetBytes / line.length);
  return line.repeat(reps);
}

describe("tokenize — perf smoke", () => {
  it("tokenises a ~2 MB grep-style input in under 1000 ms", () => {
    const input = buildSyntheticGrepOutput(2 * 1024 * 1024);
    const start = performance.now();
    const tokens = tokenize(input);
    const elapsed = performance.now() - start;

    // sanity — tokenizer actually produced links
    expect(tokens.some((t) => t.kind === "file")).toBe(true);
    expect(elapsed).toBeLessThan(1000);
  });
});
