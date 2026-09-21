/**
 * P1/P2 — a retained remote transcript's hydration must not block the main
 * event loop.
 *
 * `readRetainedTranscript` used to do its `readFileSync` + split + parse +
 * replay synchronously on the main thread, so a cold subscribe to a session
 * whose retained transcript is at the observed maximum (44.1 MB) stalled every
 * session's HTTP and WebSocket traffic, the hydration heartbeat included. The
 * offload moves read, split, parse and replay off the loop; this measures
 * whether it actually did.
 *
 * Two modes, because the change is justified by a latency budget and a budget
 * claim needs a before:
 *
 *   offload  — the shipped path. A real `worker_threads` pool
 *              (`createSessionLoadWorkerPool`) with the production job shape,
 *              driven through the production `readRetainedTranscript`. The
 *              metric is the longest contiguous main-thread block recorded by
 *              `monitorEventLoopDelay` across the whole hydration. ASSERTED
 *              against `PERF_BUDGET_MS` (default 250).
 *
 *   baseline — the PRE-change composition, expressed directly because the
 *              pre-change function no longer exists: `readFileSync` + the
 *              store's `split("\n").filter(len>0)` + `parseSessionEntries` +
 *              `replayEntriesAsEvents`. It is one uninterrupted synchronous
 *              turn, so its wall time IS its main-thread block. RECORDED, never
 *              asserted — this is the number the revert gate compares against.
 *
 * Run it through `qa/tests/26-retained-hydration-block.sh`, which finds a
 * runtime that can load the server's TypeScript (jiti) — the repository's own
 * worktrees frequently have an incomplete `node_modules`, and a perf arm that
 * silently measures nothing is worse than one that refuses.
 *
 * Deliberately NOT a spec under `packages/server/src/**\/__tests__/`: the default
 * vitest project would then pay a 44 MB fixture on every `npm test`.
 *
 * See change: offload-retained-transcript-replay (test-plan #P1, #P2).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = path.resolve(HERE, "..", "src");
const SHARED_SRC = path.resolve(HERE, "..", "..", "shared", "src");

const TARGET_BYTES = Number(process.env.PERF_TARGET_BYTES ?? 44 * 1024 * 1024);
const BUDGET_MS = Number(process.env.PERF_BUDGET_MS ?? 250);
const MODE = process.env.PERF_MODE ?? "both";
const RESOLUTION_MS = 5;

/**
 * jiti's CJS interop exposes a TypeScript module's exports on `default`, so a
 * named import is empty. Read through `default` when it is there.
 */
async function loadModule(absPath) {
  const mod = await import(new URL(`file://${absPath}`).href);
  return mod.default ?? mod;
}

/** A ~`targetBytes` JSONL transcript: a session header plus linear messages. */
function buildTranscript(sessionId, targetBytes) {
  const base = Date.parse("2025-01-01T00:00:00Z");
  const lines = [
    JSON.stringify({ type: "session", id: sessionId, timestamp: new Date(base).toISOString(), cwd: "/elsewhere" }),
  ];
  let bytes = Buffer.byteLength(lines[0]) + 1;
  let i = 0;
  while (bytes < targetBytes) {
    const line = JSON.stringify({
      type: "message",
      id: `e${i}`,
      parentId: i === 0 ? null : `e${i - 1}`,
      timestamp: new Date(base + i * 1_000).toISOString(),
      message: {
        role: i % 2 === 0 ? "user" : "assistant",
        content: [{ type: "text", text: `entry ${i} ${"x".repeat(64)}` }],
      },
    });
    lines.push(line);
    bytes += Buffer.byteLength(line) + 1;
    i += 1;
  }
  return { lines, bytes };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const {
    createRemoteTranscriptStore,
  } = await loadModule(path.join(SERVER_SRC, "session", "remote-transcript-store.ts"));
  const { readRetainedTranscript } = await loadModule(path.join(SERVER_SRC, "session", "retained-transcript.ts"));
  const { createSessionLoadWorkerPool } = await loadModule(
    path.join(SERVER_SRC, "session", "session-load-worker-pool.ts"),
  );
  const { parseSessionEntries } = await loadModule(path.join(SERVER_SRC, "session", "session-file-reader.ts"));
  const { replayEntriesAsEvents } = await loadModule(path.join(SHARED_SRC, "state-replay.ts"));

  const sessionId = "perf-retained-44mb";
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "perf-retained-"));
  const store = createRemoteTranscriptStore({ homedir: home });

  const { lines, bytes } = buildTranscript(sessionId, TARGET_BYTES);
  store.append(sessionId, lines, { restarted: true, complete: true });
  const file = path.join(home, ".pi", "dashboard", "remote-transcripts", `${sessionId}.jsonl`);
  const onDisk = fs.statSync(file).size;
  process.stdout.write(`fixture bytes=${onDisk} lines=${lines.length}\n`);

  const results = {};

  if (MODE === "baseline" || MODE === "both") {
    // PRE-change path: one synchronous turn on the main thread.
    const t0 = performance.now();
    const raw = fs.readFileSync(file, "utf8");
    const entries = raw.split("\n").filter((l) => l.length > 0);
    const events = replayEntriesAsEvents(sessionId, parseSessionEntries(entries), 200_000).map((m) => m.event);
    const wallMs = performance.now() - t0;
    results.baseline = { maxBlockMs: wallMs, wallMs, events: events.length };
    process.stdout.write(
      `RETAINED_BLOCK mode=baseline maxBlockMs=${wallMs.toFixed(1)} wallMs=${wallMs.toFixed(1)} bytes=${onDisk} events=${events.length}\n`,
    );
  }

  if (MODE === "offload" || MODE === "both") {
    const pool = createSessionLoadWorkerPool({ size: 1, useWorker: true, timeoutMs: 120_000 });
    const loader = {
      loadRetainedEvents: async (id, raw, knownContextWindow) => {
        const { result } = pool.load({ sessionId: id, raw, knownContextWindow });
        const out = await result;
        return { success: out.success, events: out.events, error: out.error };
      },
    };

    const histogram = monitorEventLoopDelay({ resolution: RESOLUTION_MS });
    histogram.enable();
    histogram.reset();
    const t0 = performance.now();
    const read = await readRetainedTranscript(store, loader, sessionId, 200_000);
    const wallMs = performance.now() - t0;
    // The sampler records a stall on its NEXT tick, and the final
    // structured-clone deserialization of the result array happens on THIS
    // thread immediately before the `await` resolves. Reading `max` — or
    // disabling the histogram — before that tick lands would under-report the
    // very block this exists to measure, i.e. a false green on the gate. Yield
    // several resolutions first; the idle wait adds no delay of its own.
    await sleep(RESOLUTION_MS * 4);
    const maxBlockMs = histogram.max / 1e6;
    histogram.disable();

    await pool.dispose();

    if (read.cancelled) throw new Error("unexpected cancel");
    results.offload = { maxBlockMs, wallMs, events: read.events.length, state: read.state };
    process.stdout.write(
      `RETAINED_BLOCK mode=offload maxBlockMs=${maxBlockMs.toFixed(1)} wallMs=${wallMs.toFixed(1)} bytes=${onDisk} events=${read.events.length} state=${read.state}\n`,
    );

    // The offload is only worth shipping if it MOVED the number: a wall time
    // under the budget does not by itself mean the loop was free.
    if (maxBlockMs >= BUDGET_MS) {
      process.stderr.write(
        `FAIL: longest main-thread block ${maxBlockMs.toFixed(1)} ms >= budget ${BUDGET_MS} ms ` +
          `(the raw-text clone and the result clone are the main-thread residues)\n`,
      );
      process.exitCode = 1;
    } else {
      process.stdout.write(`PASS: longest main-thread block ${maxBlockMs.toFixed(1)} ms < ${BUDGET_MS} ms\n`);
    }
    if (results.baseline) {
      const ratio = results.baseline.maxBlockMs / Math.max(maxBlockMs, 0.001);
      process.stdout.write(`block reduced ${ratio.toFixed(1)}x vs the pre-change path\n`);
    }
  }

  // `histogram.disable()` does not clear pending timer callbacks in every Node
  // version; yielding once keeps the process from exiting mid-measurement.
  await sleep(10);
  fs.rmSync(home, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(results)}\n`);
}

main().catch((err) => {
  process.stderr.write(`FAIL: ${err?.stack ?? String(err)}\n`);
  process.exitCode = 1;
});
