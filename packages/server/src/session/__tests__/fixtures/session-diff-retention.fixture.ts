/**
 * V8-level heap-retention probe for the session-diff cache (fix-session-diff-
 * heap-retention D1). Run ONLY as a child process by
 * `session-diff-retention.test.ts`: `node --expose-gc --import tsx <this>`.
 *
 * Each arm builds a large synthetic batched `git diff` inside a function scope,
 * keeps only the small per-file result the production code would cache, resets
 * the legacy RegExp last-match statics (`RegExp.input` pins the subject of the
 * last successful regex — see design.md), forces GC, and reports how much heap
 * stays retained. Prints ONE JSON line LAST: `{ e1, e2, e3, payloadMB }` (MB).
 */
import type { FileDiffEntry } from "@blackbelt-technology/pi-dashboard-shared/diff-types.js";
import { SessionDiffCache } from "../../session-diff-cache.js";
import { enrichFilesWithContext, type SessionDiffResult, sessionDiffResultSize, splitBatchedDiff } from "../../session-diff.js";

const gc = (globalThis as { gc?: () => void }).gc;
if (typeof gc !== "function") {
  console.log(JSON.stringify({ error: "gc unavailable — run with --expose-gc" }));
  process.exit(1);
}

const MB = 1024 * 1024;

function settledHeap(): number {
  /a/.exec("a"); // reset RegExp last-match statics (RegExp.input / $_)
  for (let i = 0; i < 3; i++) gc!();
  return process.memoryUsage().heapUsed;
}

/** A batched diff: one `bytes`-sized single-line big.txt chunk + a ~92-char small.txt chunk. */
function batchedDiff(bytes: number, tag: string): string {
  const half = Math.floor(bytes / 2);
  const big = `diff --git a/big.txt b/big.txt\n--- a/big.txt\n+++ b/big.txt\n@@ -1 +1 @@\n-${tag.repeat(half / tag.length)}\n+${"y".repeat(half)}`;
  const small = `diff --git a/small.txt b/small.txt\n--- a/small.txt\n+++ b/small.txt\n@@ -1 +1 @@\n-${tag}\n+new`;
  return `${big}\n${small}`;
}

function ctxFor(raw: string) {
  return { isGitRepo: true, numstatMap: new Map(), diffMap: splitBatchedDiff(raw), untracked: new Set<string>() };
}

const small: FileDiffEntry[] = [{ path: "small.txt", changes: [] }];

/** E1: the production storage path (enrichFilesWithContext). */
function e1(): FileDiffEntry {
  const raw = batchedDiff(30 * MB, "a");
  return enrichFilesWithContext("/repo", small, ctxFor(raw)).enrichedFiles[0];
}

/** E2 control: the OLD storage form (`chunk.trim()`), which must still retain. */
function e2(): string {
  const raw = batchedDiff(30 * MB, "b");
  return splitBatchedDiff(raw).get("small.txt")!.trim();
}

async function e3(): Promise<SessionDiffCache<SessionDiffResult>> {
  const cache = new SessionDiffCache<SessionDiffResult>(60_000, 100, {
    maxBytes: 64 * MB,
    sizeOf: sessionDiffResultSize,
  });
  for (let i = 0; i < 5; i++) {
    await cache.run(`k${i}`, async () => {
      const raw = batchedDiff(20 * MB, `g${i}`);
      const { enrichedFiles } = enrichFilesWithContext("/repo", small, ctxFor(raw));
      return { files: enrichedFiles, otherChanges: [], isGitRepo: true };
    });
  }
  return cache;
}

function measure<T>(build: () => T): { held: T; mb: number } {
  const before = settledHeap();
  const held = build();
  const after = settledHeap();
  return { held, mb: (after - before) / MB };
}

async function main(): Promise<void> {
  const r1 = measure(e1);
  const r2 = measure(e2);
  const before3 = settledHeap();
  const cache = await e3();
  const r3 = (settledHeap() - before3) / MB;
  // Keep every held value reachable until after its measurement.
  if (!r1.held.gitDiff || !r2.held || cache.size !== 5) {
    console.log(JSON.stringify({ error: "fixture sanity failed", e1Diff: !!r1.held.gitDiff, size: cache.size }));
    process.exit(1);
  }
  console.log(JSON.stringify({ e1: r1.mb, e2: r2.mb, e3: r3, payloadMB: 30 }));
}

void main();
