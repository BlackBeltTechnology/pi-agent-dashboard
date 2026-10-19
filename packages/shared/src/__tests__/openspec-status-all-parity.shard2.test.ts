/**
 * Parity guard, shard 2 of 3: `openspec status --all` (+ local task counting) must match
 * `status --change` and `openspec list` for the active changes whose name hashes to shard 2.
 * Body and rationale: `../test-support/openspec-status-all-parity.ts`.
 *
 * See change: use-openspec-status-all.
 */
import { describe, expect, it } from "vitest";
import { runStatusAllParityShard } from "../test-support/openspec-status-all-parity.js";

describe("status --all parity with per-change CLI + list (shard 2 of 3)", () => {
  it("artifact sets, error ⇔ failing per-change call, and task counts match", async () => {
    await runStatusAllParityShard(1, expect as never);
  }, 120_000);
});
