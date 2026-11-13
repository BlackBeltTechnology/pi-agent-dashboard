import { writeFileSync } from "node:fs";
import { arch, availableParallelism, cpus, platform } from "node:os";
import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { createInitialState, reduceEvent, type SessionState, type ToolCallState } from "../../../client/src/lib/chat/event-reducer.js";
import type { StoredEvent } from "../persistence/memory-event-store.js";
import { compactEventsForReplay } from "../session/replay-compaction.js";
import { StreamBuilder } from "./fixtures/replay-streams.js";

// The ordinary test command checks the current pipeline. The controlled comparison
// loads pinned baseline and candidate source copies, independently of which
// optimization is present in this checkout. No production flags are needed.
// See openspec/streaming-performance-comparison.md for preparation and results.
const compare = process.env.REPLAY_PERFORMANCE_COMPARE === "1";
const historicalSizes = [0, 1000, 10000];
const workloadNames = ["text", "interleaved", "write-heavy"] as const;
type WorkloadName = typeof workloadNames[number];
type Reducer = { createInitialState: typeof createInitialState; reduceEvent: typeof reduceEvent };
type Variant = { name: string; compact: typeof compactEventsForReplay; reducer: Reducer; collapse?: boolean; cow?: boolean };
type Timings = { compact: number; serialize: number; parse: number; reduce: number; total: number };
type Counts = { copies: number; entriesEnumerated: number };

function assistant(content: Array<Record<string, unknown>>) {
  return { role: "assistant", content };
}

function textWorkload(b: StreamBuilder) {
  for (let n = 1; n <= 100; n++) {
    b.push("message_update", { message: assistant([{ type: "text", text: "x".repeat(n * 1024) }]) });
  }
  return [{ type: "text", text: `${"x".repeat(100 * 1024)}::live` }];
}

function interleavedWorkload(b: StreamBuilder) {
  b.push("message_update", { assistantMessageEvent: { type: "thinking_start" } });
  b.push("message_update", { assistantMessageEvent: { type: "thinking_delta", delta: "Inspect the file." } });
  b.push("message_update", { assistantMessageEvent: { type: "thinking_end" } });
  for (let run = 0; run < 3; run++) {
    for (let n = 1; n <= (run === 1 ? 1 : 12); n++) {
      b.push("message_update", { message: assistant([{ type: "text", text: `before-${run}-${n}` }]) });
    }
    b.push("stats_update", { inputTokens: run });
  }
  b.push("tool_execution_start", { toolCallId: "mixed-read", toolName: "read", args: { path: "file.ts" } });
  b.push("tool_execution_end", { toolCallId: "mixed-read", toolName: "read", result: "contents" });
  const call = { type: "toolCall", id: "mixed-read", name: "read", arguments: { path: "file.ts" } };
  for (let n = 1; n <= 12; n++) {
    b.push("message_update", { message: assistant([{ type: "text", text: "before-2-12" }, call, { type: "text", text: `after-${n}` }]) });
  }
  return [{ type: "text", text: "before-2-12" }, call, { type: "text", text: "after-12::live" }];
}

function writeHeavyWorkload(b: StreamBuilder) {
  const finalContent: Array<Record<string, unknown>> = [];
  for (let n = 1; n <= 500; n++) {
    const id = `fresh-${n}`;
    const args = { path: `file-${n}.ts` };
    b.push("tool_execution_start", { toolCallId: id, toolName: "read", args });
    b.push("tool_execution_end", { toolCallId: id, toolName: "read", result: `done-${n}` });
    finalContent.push({ type: "toolCall", id, name: "read", arguments: args });
  }
  finalContent.push({ type: "text", text: "all tools complete::live" });
  return finalContent;
}

function workload(name: WorkloadName) {
  const b = new StreamBuilder().push("message_start", { message: assistant([]) });
  const finalContent = name === "text" ? textWorkload(b) : name === "interleaved" ? interleavedWorkload(b) : writeHeavyWorkload(b);
  const events = b.build().slice();
  b.push("message_update", { message: assistant(finalContent) });
  b.push("message_end", { message: assistant(finalContent), entryId: "benchmark-final" });
  return { events, continuation: b.build().slice(events.length) };
}

function initial(reducer: Reducer, size: number): SessionState {
  const state = reducer.createInitialState();
  for (let n = 0; n < size; n++) {
    const id = `historical-${n}`;
    state.toolCalls.set(id, { toolCallId: id, toolName: "read", status: "complete" });
  }
  return state;
}

function pipeline(variant: Variant, input: StoredEvent[], size: number) {
  const seed = initial(variant.reducer, size);
  const t0 = performance.now();
  const projected = variant.compact(input);
  const t1 = performance.now();
  const serialized = JSON.stringify(projected);
  const t2 = performance.now();
  const decoded = JSON.parse(serialized) as StoredEvent[];
  const t3 = performance.now();
  const state = decoded.reduce((s, e) => variant.reducer.reduceEvent(s, e.event), seed);
  const t4 = performance.now();
  return {
    state,
    projected,
    bytes: Buffer.byteLength(serialized),
    timings: { compact: t1 - t0, serialize: t2 - t1, parse: t3 - t2, reduce: t4 - t3, total: t4 - t0 } satisfies Timings,
  };
}

/**
 * These workloads contain ordinary read tools and no plugin allocations. On
 * these paths the input map iterator is used only by Map copy constructors.
 * Observe that exact source map without changing global Map or map identity.
 * This is a separate count pass, never part of the measured timing pass.
 */
function countCopies(variant: Variant, input: StoredEvent[], size: number): Counts {
  const counts: Counts = { copies: 0, entriesEnumerated: 0 };
  let state = initial(variant.reducer, size);
  for (const stored of variant.compact(input)) {
    const map = state.toolCalls;
    const original = Object.getOwnPropertyDescriptor(map, Symbol.iterator);
    Object.defineProperty(map, Symbol.iterator, {
      configurable: true,
      value: function* (this: Map<string, ToolCallState>) {
        counts.copies++;
        for (const pair of Map.prototype.entries.call(this)) {
          counts.entriesEnumerated++;
          yield pair;
        }
      },
    });
    try {
      state = variant.reducer.reduceEvent(state, stored.event);
    } finally {
      if (original) Object.defineProperty(map, Symbol.iterator, original);
      else Reflect.deleteProperty(map, Symbol.iterator);
    }
  }
  return counts;
}

function verifyValues(state: SessionState, name: WorkloadName, size: number) {
  expect(state.toolCalls.size).toBe(size + (name === "write-heavy" ? 500 : name === "interleaved" ? 1 : 0));
  if (name === "text") expect(state.streamingText).toBe("x".repeat(100 * 1024));
  if (name === "interleaved") {
    expect(state.toolCalls.get("mixed-read")?.status).toBe("complete");
    expect(state.messages.find(m => m.toolCallId === "mixed-read")?.result).toBe("contents");
    expect(state.messages.find(m => m.role === "thinking")?.content).toBe("Inspect the file.");
  }
  if (name === "write-heavy") {
    expect(state.toolCalls.get("fresh-500")?.status).toBe("complete");
    expect(state.messages.find(m => m.toolCallId === "fresh-500")?.result).toBe("done-500");
  }
}

function median(values: number[]) {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function loadSourcePair(version: "baseline" | "candidate") {
  // Variable imports keep all temporary copies out of normal discovery.
  const compactPath = new URL(`../session/replay-compaction.${version}.ts`, import.meta.url).pathname;
  const reducerPath = new URL(`../../../client/src/lib/chat/event-reducer.${version}.ts`, import.meta.url).pathname;
  const compactor = await import(/* @vite-ignore */ compactPath) as { compactEventsForReplay: typeof compactEventsForReplay };
  const reducer = await import(/* @vite-ignore */ reducerPath) as Reducer;
  return { compact: compactor.compactEventsForReplay, reducer };
}

async function loadVariants(): Promise<Variant[]> {
  if (!compare) return [{ name: "current", compact: compactEventsForReplay, reducer: { createInitialState, reduceEvent } }];
  const baseline = await loadSourcePair("baseline");
  const candidate = await loadSourcePair("candidate");
  return [
    { name: "baseline", ...baseline, collapse: false, cow: false },
    { name: "collapse-only", compact: candidate.compact, reducer: baseline.reducer, collapse: true, cow: false },
    { name: "copy-on-write-only", compact: baseline.compact, reducer: candidate.reducer, collapse: false, cow: true },
    { name: "both", ...candidate, collapse: true, cow: true },
  ];
}

function sampleVariants(variants: Variant[], events: StoredEvent[], size: number, warmups: number, repetitions: number): Timings[][] {
  const samples = variants.map(() => [] as Timings[]);
  // Rotate first position to avoid giving one variant every cold sample.
  for (let repetition = -warmups; repetition < repetitions; repetition++) {
    for (let offset = 0; offset < variants.length; offset++) {
      const index = (repetition + warmups + offset) % variants.length;
      const result = pipeline(variants[index], events, size);
      if (repetition >= 0) samples[index].push(result.timings);
    }
  }
  return samples;
}

function checkAndReportCell(variant: Variant, index: number, results: ReturnType<typeof pipeline>[], reference: SessionState, completedReference: SessionState, continuation: StoredEvent[], events: StoredEvent[], name: WorkloadName, size: number, samples: Timings[][], cells: Array<Record<string, unknown>>) {
  const result = results[index];
  verifyValues(result.state, name, size);
  expect(result.state).toEqual(reference);
  const completed = continuation.reduce((s, e) => variant.reducer.reduceEvent(s, e.event), result.state);
  expect(completed).toEqual(completedReference);
  expect(completed.messages.find(m => m.entryId === "benchmark-final")?.content).toContain("::live");
  const counts = countCopies(variant, events, size);
  if (compare && name === "text") {
    expect(result.projected).toHaveLength(variant.collapse ? 2 : 101);
    expect(counts.copies).toBe(variant.cow ? 0 : result.projected.length);
    expect(counts.entriesEnumerated).toBe(variant.cow ? 0 : result.projected.length * size);
  }
  const timings = Object.fromEntries((Object.keys(result.timings) as Array<keyof Timings>).map(key => [key, median(samples[index].map(sample => sample[key]))]));
  cells.push({ variant: variant.name, workload: name, historicalTools: size, initialRows: 0, eligibleRunLengths: name === "text" ? [100] : name === "interleaved" ? [12, 1, 12] : [], eligibleSnapshots: name === "text" ? 100 : name === "interleaved" ? 25 : 0, rawEvents: events.length, rawBytes: Buffer.byteLength(JSON.stringify(events)), retainedEvents: result.projected.length, serializedBytes: result.bytes, ...counts, samplesMs: samples[index], medianMs: timings });
}

function writeComparison(cells: Array<Record<string, unknown>>, warmups: number, repetitions: number) {
  const output = process.env.REPLAY_PERFORMANCE_OUTPUT;
  if (!output) throw new Error("Set REPLAY_PERFORMANCE_OUTPUT to an owned disposable report path");
  const report = { runtime: process.version, environment: { platform: platform(), arch: arch(), cpu: cpus()[0]?.model, availableParallelism: availableParallelism() }, warmups, repetitions, ordering: "rotate first variant per repetition", plugins: "registered; no plugin-owned events or Agent tools in these workloads", workloads: { text: "100 adjacent snapshots, 1..100 KiB", interleaved: "runs 12/1/12 separated by stats; thinking and tool lifecycle; 12 mixed snapshots", "write-heavy": "500 read starts/ends, no eligible text runs" }, cells };
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
}

describe("replay performance: shared P2", () => {
  it("preserves fixture values and reports the controlled source variants", async () => {
    const variants = await loadVariants();
    const warmups = compare ? 2 : 0;
    const repetitions = compare ? 7 : 1;
    const cells: Array<Record<string, unknown>> = [];
    for (const size of historicalSizes) {
      for (const name of workloadNames) {
        const { events, continuation } = workload(name);
        const results = variants.map(variant => pipeline(variant, events, size));
        const reference = results[0].state;
        const completedReference = continuation.reduce((s, e) => variants[0].reducer.reduceEvent(s, e.event), reference);
        const samples = sampleVariants(variants, events, size, warmups, repetitions);
        for (const [index, variant] of variants.entries()) {
          checkAndReportCell(variant, index, results, reference, completedReference, continuation, events, name, size, samples, cells);
        }
      }
    }
    if (compare) writeComparison(cells, warmups, repetitions);
  }, 180_000);
});
