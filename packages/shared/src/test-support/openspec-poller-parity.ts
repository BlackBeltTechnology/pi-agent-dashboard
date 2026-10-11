/**
 * Shared body of the `openspec-poller-parity*.test.ts` shards.
 *
 * Parity guard: `deriveArtifactStatus` (local derivation, no per-change CLI spawn) must match the
 * dashboard's authoritative status pipeline `buildOpenSpecData(runOpenSpecStatus(...))`
 * artifact-for-artifact across the repo's own active changes. Parity is against the FINAL
 * dashboard status (CLI output with the design/specs promote-only overrides applied), NOT raw
 * `openspec status`: raw CLI diverges by construction on the `design` artifact.
 *
 * One CLI spawn per change costs ~0.7 s, so the suite grows with the backlog (measured 20 s on a
 * CI runner at ~85 active changes). The changes are therefore partitioned across several test
 * files by a stable hash of the change name; each shard checks its own partition, so no single
 * file serializes a worker. Every change belongs to exactly one shard.
 *
 * Skips gracefully when the `openspec` CLI is unavailable or the repo has no active changes.
 * `expect` is injected so this module needs no `vitest` dependency.
 *
 * See changes: optimize-openspec-poll-derive-artifacts-locally, test-trust-audit (design D7).
 */
import path from "node:path";
import {
  buildOpenSpecData,
  createFsProbeFactory,
  createFsSpecsProbeFactory,
  deriveArtifactStatus,
  runOpenSpecList,
  runOpenSpecStatus,
} from "../openspec-poller.js";

// repo root: packages/shared/src/test-support → ../../../..
const REPO_ROOT = path.resolve(__dirname, "../../../..");

const PARITY_SHARDS = 3;

/** Stable shard of a change name (sum of char codes; independent of list order). */
function shardOf(name: string, shards: number = PARITY_SHARDS): number {
  let sum = 0;
  for (const ch of name) sum += ch.charCodeAt(0);
  return sum % shards;
}

function sortArtifacts(arts: Array<{ id: string; status: string }>) {
  return [...arts].sort((a, b) => a.id.localeCompare(b.id)).map((a) => ({ id: a.id, status: a.status }));
}

type Expect = (actual: unknown, message?: string) => { toEqual(expected: unknown): void; toBe(expected: unknown): void };

export async function runParityShard(shard: number, expect: Expect): Promise<void> {
  const list = await runOpenSpecList(REPO_ROOT);
  const changes = list?.changes?.filter((c) => shardOf(c.name) === shard);
  if (!changes || changes.length === 0) return; // CLI absent, no active changes, or an empty partition.

  const designFactory = createFsProbeFactory(REPO_ROOT);
  const specsFactory = createFsSpecsProbeFactory(REPO_ROOT);
  const changesRoot = path.join(REPO_ROOT, "openspec", "changes");

  // One CLI spawn per change, run through a bounded pool: the spawn costs, not CPU.
  const CONCURRENCY = 8;
  const queue = [...changes];

  async function checkOne(entry: (typeof queue)[number]) {
    const changeDir = path.join(changesRoot, entry.name);
    const derived = deriveArtifactStatus(changeDir, entry, {
      design: designFactory(entry.name),
      specs: specsFactory(entry.name),
    });
    const cliRaw = await runOpenSpecStatus(REPO_ROOT, entry.name);
    const cliFinal = buildOpenSpecData({ changes: [entry] }, new Map([[entry.name, cliRaw]]), designFactory, specsFactory).changes[0];
    expect(sortArtifacts(derived.artifacts), `artifacts for ${entry.name}`).toEqual(sortArtifacts(cliFinal.artifacts));
    expect(derived.isComplete, `isComplete for ${entry.name}`).toBe(cliFinal.isComplete ?? false);
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let entry = queue.pop(); entry; entry = queue.pop()) await checkOne(entry);
    }),
  );
}
