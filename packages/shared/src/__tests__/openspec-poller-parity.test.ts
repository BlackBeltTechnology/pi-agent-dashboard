/**
 * Parity guard: `deriveArtifactStatus` (local derivation, no per-change CLI
 * spawn) must match the dashboard's authoritative status pipeline
 * `buildOpenSpecData(runOpenSpecStatus(...))` artifact-for-artifact across the
 * repo's own active changes.
 *
 * Note: parity is against the FINAL dashboard status (CLI output with the
 * design/specs promote-only overrides applied), NOT raw `openspec status`.
 * Raw CLI diverges from the dashboard by construction on the `design`
 * artifact (the dashboard promotes `ready→done` from local evidence the CLI
 * ignores), so comparing the derivation to raw CLI would be wrong.
 *
 * Skips gracefully when the `openspec` CLI is unavailable (e.g. CI without the
 * binary) or the repo has no active changes.
 *
 * See change: optimize-openspec-poll-derive-artifacts-locally.
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  buildOpenSpecData,
  deriveArtifactStatus,
  runOpenSpecList,
  runOpenSpecStatus,
  createFsProbeFactory,
  createFsSpecsProbeFactory,
} from "../openspec-poller.js";

// repo root: packages/shared/src/__tests__ → ../../../..
const REPO_ROOT = path.resolve(__dirname, "../../../..");

function sortArtifacts(arts: Array<{ id: string; status: string }>) {
  return [...arts].sort((a, b) => a.id.localeCompare(b.id)).map((a) => ({ id: a.id, status: a.status }));
}

describe("deriveArtifactStatus parity with CLI pipeline", () => {
  it(
    "matches buildOpenSpecData(runOpenSpecStatus) per change",
    async () => {
      const list = await runOpenSpecList(REPO_ROOT);
      const changes = list?.changes;
      if (!changes || changes.length === 0) {
        // openspec CLI absent or no active changes — skip gracefully.
        return;
      }

      const designFactory = createFsProbeFactory(REPO_ROOT);
      const specsFactory = createFsSpecsProbeFactory(REPO_ROOT);
      const changesRoot = path.join(REPO_ROOT, "openspec", "changes");

      // One CLI spawn per change, run through a bounded pool. Sequentially
      // this is ~0.7s x N, which crossed the 60s timeout the moment the repo
      // passed ~85 active changes — a cliff that grows with the backlog and has
      // nothing to do with the parity being checked. The pool keeps the wall
      // clock flat; the spawn itself is what costs, not CPU.
      const CONCURRENCY = 8;
      const queue = [...changes];

      async function checkOne(entry: (typeof queue)[number]) {
        const changeDir = path.join(changesRoot, entry.name);

        const derived = deriveArtifactStatus(changeDir, entry, {
          design: designFactory(entry.name),
          specs: specsFactory(entry.name),
        });

        const cliRaw = await runOpenSpecStatus(REPO_ROOT, entry.name);
        const cliFinal = buildOpenSpecData(
          { changes: [entry] },
          new Map([[entry.name, cliRaw]]),
          designFactory,
          specsFactory,
        ).changes[0];

        expect(sortArtifacts(derived.artifacts), `artifacts for ${entry.name}`).toEqual(
          sortArtifacts(cliFinal.artifacts),
        );
        expect(derived.isComplete, `isComplete for ${entry.name}`).toBe(
          cliFinal.isComplete ?? false,
        );
      }

      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
          for (let entry = queue.pop(); entry; entry = queue.pop()) await checkOne(entry);
        }),
      );
    },
    60_000,
  );
});
