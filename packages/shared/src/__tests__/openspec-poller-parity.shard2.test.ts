/**
 * Parity guard, shard 2 of 3: `deriveArtifactStatus` must match the dashboard's status pipeline
 * for the active changes whose name hashes to shard 2. Body and rationale:
 * `../test-support/openspec-poller-parity.ts`.
 *
 * See changes: optimize-openspec-poll-derive-artifacts-locally, test-trust-audit.
 */
import { describe, expect, it } from "vitest";
import { runParityShard } from "../test-support/openspec-poller-parity.js";

describe("deriveArtifactStatus parity with CLI pipeline (shard 2 of 3)", () => {
  it("matches buildOpenSpecData(runOpenSpecStatus) per change", async () => {
    await runParityShard(1, expect as never);
  }, 60_000);
});
