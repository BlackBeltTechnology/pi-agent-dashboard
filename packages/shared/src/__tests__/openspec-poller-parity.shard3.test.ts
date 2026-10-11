/**
 * Parity guard, shard 3 of 3: `deriveArtifactStatus` must match the dashboard's status pipeline
 * for the active changes whose name hashes to shard 3. Body and rationale:
 * `../test-support/openspec-poller-parity.ts`.
 *
 * See changes: optimize-openspec-poll-derive-artifacts-locally, test-trust-audit.
 */
import { describe, expect, it } from "vitest";
import { runParityShard } from "../test-support/openspec-poller-parity.js";

describe("deriveArtifactStatus parity with CLI pipeline (shard 3 of 3)", () => {
  it("matches buildOpenSpecData(runOpenSpecStatus) per change", async () => {
    await runParityShard(2, expect as never);
  }, 60_000);
});
