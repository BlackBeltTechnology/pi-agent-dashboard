#!/usr/bin/env node
/**
 * Measure the replay-compaction win (change: compact-warm-replay-stream, #399).
 *
 * Reports, for a warm (in-memory) replay window: event count, wire bytes, batch
 * count and wall time, BEFORE (no compaction, REPLAY_BATCH_SIZE=50) vs AFTER
 * (compaction, REPLAY_BATCH_SIZE=200).
 *
 * Usage:
 *   node scripts/measure-replay-compaction.mjs                # synthetic 20k window
 *   node scripts/measure-replay-compaction.mjs <session.jsonl> # real cold-load file
 *
 * The synthetic window models the #399 shape (per-token `message_update`
 * snapshots). A real `.jsonl` is the COLD shape and is reported for reference —
 * it is what the warm path should converge on.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const jiti = require("jiti")(import.meta.filename, { interopDefault: true, esmResolve: true });

const root = path.resolve(import.meta.dirname, "..");
const { compactEventsForReplay } = jiti(
  path.join(root, "packages/server/src/session/replay-compaction.ts"),
);
const { largeSyntheticWindow } = jiti(
  path.join(root, "packages/server/src/__tests__/fixtures/replay-streams.ts"),
);
const { replayEntriesAsEvents } = jiti(path.join(root, "packages/shared/src/state-replay.ts"));

const BEFORE_BATCH = 50;
const AFTER_BATCH = 200;

const wireBytes = (events) =>
  Buffer.byteLength(JSON.stringify(events.map((e) => ({ seq: e.seq, event: e.event }))), "utf8");
const batches = (n, size) => Math.ceil(n / size);
const fmtBytes = (b) => `${(b / 1_048_576).toFixed(2)} MB`;
const pct = (before, after) => `${(((before - after) / before) * 100).toFixed(1)}%`;

function measure(label, window) {
  const t0 = performance.now();
  const compacted = compactEventsForReplay(window);
  const compactMs = performance.now() - t0;

  const beforeBytes = wireBytes(window);
  const afterBytes = wireBytes(compacted);

  console.log(`\n── ${label} ────────────────────────────────────────`);
  console.table({
    "events": { before: window.length, after: compacted.length, delta: pct(window.length, compacted.length) },
    "wire bytes": { before: fmtBytes(beforeBytes), after: fmtBytes(afterBytes), delta: pct(beforeBytes, afterBytes) },
    "batches": {
      before: batches(window.length, BEFORE_BATCH),
      after: batches(compacted.length, AFTER_BATCH),
      delta: pct(batches(window.length, BEFORE_BATCH), batches(compacted.length, AFTER_BATCH)),
    },
  });
  console.log(`compaction wall time: ${compactMs.toFixed(1)} ms (single O(n) pass)`);
  return { before: window.length, after: compacted.length, beforeBytes, afterBytes, compactMs };
}

measure("synthetic #399-shaped window (140 messages x ~150 snapshot updates)", largeSyntheticWindow());

const file = process.argv[2];
if (file) {
  // A real persisted session is the COLD shape — exactly what the warm path
  // should converge on. Two things are worth knowing about it:
  //   1. how many events the cold path synthesizes (the convergence target), and
  //   2. that compaction is a near no-op on it (the design's open question:
  //      is it safe to apply the pass uniformly to both replay paths?).
  const entries = fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
  const cold = replayEntriesAsEvents("measure", entries).map((m, i) => ({
    seq: i + 1,
    event: { eventType: m.eventType, timestamp: m.timestamp ?? 0, data: m.data ?? {} },
  }));
  const coldCompacted = compactEventsForReplay(cold);
  console.log(`\n── real session: ${path.basename(file)} ──────────────────`);
  console.table({
    "persisted entries": entries.length,
    "cold-load events (convergence target)": cold.length,
    "cold-load events after compaction": coldCompacted.length,
    "cold wire bytes": fmtBytes(wireBytes(cold)),
  });
  // Equal LENGTH alone would not prove a no-op — a compactor could reorder or
  // rewrite events without changing the count. Compare the full projection.
  const identical =
    coldCompacted.length === cold.length &&
    JSON.stringify(coldCompacted.map((e) => [e.seq, e.event.eventType])) ===
      JSON.stringify(cold.map((e) => [e.seq, e.event.eventType])) &&
    coldCompacted.every((e, i) => e.event === cold[i].event);
  console.log(
    identical
      ? "compaction is a NO-OP on the cold path (same events, same order, same refs) → safe to apply uniformly"
      : `compaction CHANGED the cold path: ${cold.length} → ${coldCompacted.length} events`,
  );
}
