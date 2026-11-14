/**
 * Unit tests for `compactEventsForReplay` — test-plan scenarios E1–E9, P2, P3.
 * See change: compact-warm-replay-stream.
 */

import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import type { StoredEvent } from "../persistence/memory-event-store.js";
import { compactEventsForReplay } from "../session/replay-compaction.js";
import { largeSyntheticWindow, subagentInterleavedWindow } from "./fixtures/replay-streams.js";

/** Terse window builder: `ev("message_update", 3)` → StoredEvent at seq 3. */
function ev(eventType: string, seq: number, data: Record<string, unknown> = {}): StoredEvent {
  const event: DashboardEvent = { eventType, timestamp: 1_700_000_000_000 + seq, data };
  return { seq, event, bytes: 0 };
}
const types = (w: StoredEvent[]) => w.map((e) => e.event.eventType);
const seqs = (w: StoredEvent[]) => w.map((e) => e.seq);

const assistantUpdate = (seq: number, text: string) =>
  ev("message_update", seq, { message: { role: "assistant", content: [{ type: "text", text }] } });

describe("compactEventsForReplay — supersession + boundaries", () => {
  it("E1: a 500-update window collapses to [message_start, message_end]", () => {
    const w: StoredEvent[] = [ev("message_start", 1)];
    for (let s = 2; s <= 501; s++) w.push(assistantUpdate(s, `t${s}`));
    w.push(ev("message_end", 502));
    const out = compactEventsForReplay(w);
    expect(seqs(out)).toEqual([1, 502]);
    expect(types(out)).not.toContain("message_update");
  });

  it("E2: single-update minimum case", () => {
    const out = compactEventsForReplay([ev("message_start", 1), assistantUpdate(2, "x"), ev("message_end", 3)]);
    expect(seqs(out)).toEqual([1, 3]);
  });

  it("E3: empty window returns empty, no throw", () => {
    expect(compactEventsForReplay([])).toEqual([]);
  });

  it("E4: window with no message_end collapses its unfinished run", () => {
    const w: StoredEvent[] = [ev("message_start", 1)];
    for (let s = 2; s <= 20; s++) w.push(assistantUpdate(s, `t${s}`));
    const out = compactEventsForReplay(w);
    expect(seqs(out)).toEqual([1, 20]);
  });
});

describe("compactEventsForReplay — passthrough + shape", () => {
  it("E5: every non-message_update event survives in original relative order", () => {
    // NOTE: seq 3 is the last text update BEFORE the tool_execution_start, so
    // the flush exemption retains it — required by F2 equivalence. seq 5 (the
    // superseded snapshot after the tool start) is dropped.
    const w = [
      ev("turn_start", 1),
      ev("message_start", 2),
      assistantUpdate(3, "a"),
      ev("tool_execution_start", 4, { toolCallId: "c1" }),
      assistantUpdate(5, "ab"),
      ev("subagent_created", 6, { agentId: "s1" }),
      ev("tool_execution_end", 7, { toolCallId: "c1" }),
      ev("stats_update", 8),
      ev("session_compact", 9),
      ev("message_end", 10),
      ev("turn_end", 11),
    ];
    const out = compactEventsForReplay(w);
    expect(types(out)).toEqual([
      "turn_start",
      "message_start",
      "message_update",
      "tool_execution_start",
      "subagent_created",
      "tool_execution_end",
      "stats_update",
      "session_compact",
      "message_end",
      "turn_end",
    ]);
    expect(seqs(out)).toEqual([1, 2, 3, 4, 6, 7, 8, 9, 10, 11]);
  });

  it("E6: idempotent — compact(compact(w)) deep-equals compact(w)", () => {
    for (const w of [
      subagentInterleavedWindow(),
      [ev("message_start", 1), assistantUpdate(2, "a"), ev("message_end", 3), assistantUpdate(4, "b")],
    ]) {
      const once = compactEventsForReplay(w);
      expect(compactEventsForReplay(once)).toEqual(once);
    }
  });

  it("E8: a window opening with a bare message_end does not throw and keeps everything before it", () => {
    const w = [ev("tool_execution_end", 1, { toolCallId: "c0" }), ev("message_end", 2), ev("turn_end", 3)];
    expect(compactEventsForReplay(w)).toEqual(w);
  });
});

describe("compactEventsForReplay — seq contract", () => {
  it("E7: output seqs are exactly [1,2,99,100] and no surviving seq is mutated", () => {
    const w: StoredEvent[] = [ev("turn_start", 1), ev("message_start", 2)];
    for (let s = 3; s <= 98; s++) w.push(assistantUpdate(s, `t${s}`));
    w.push(ev("message_end", 99), ev("turn_end", 100));
    const out = compactEventsForReplay(w);
    expect(seqs(out)).toEqual([1, 2, 99, 100]);
    // Surviving entries are the SAME objects/values as the input, seq untouched.
    for (const e of out) {
      expect(w.find((x) => x.seq === e.seq)!.event).toBe(e.event);
    }
  });
});

describe("compactEventsForReplay — streaming tail", () => {
  it("E9: finalized M1 updates drop while the still-streaming M2 retains its final snapshot", () => {
    const w: StoredEvent[] = [ev("message_start", 1)];
    for (let s = 2; s <= 9; s++) w.push(assistantUpdate(s, `m1-${s}`));
    w.push(ev("message_end", 10));
    w.push(ev("message_start", 11));
    for (let s = 12; s <= 23; s++) w.push(assistantUpdate(s, `m2-${s}`));
    const out = compactEventsForReplay(w);
    expect(seqs(out)).toEqual([1, 10, 11, 23]);
    expect(out.filter((e) => e.event.eventType === "message_update")).toHaveLength(1);
  });
});

describe("compactEventsForReplay — budget", () => {
  it("P2: compacted count ≤ 2× the cold-load (state-replay) count for the same messages", () => {
    const messages = 140;
    const w = largeSyntheticWindow(messages, 150);
    const out = compactEventsForReplay(w);
    // state-replay.ts emits per turn: user message_start + assistant
    // message_update + assistant message_end = 3 events.
    const coldLoadCount = messages * 3;
    expect(w.length).toBeGreaterThan(19_000);
    expect(out.length).toBeLessThanOrEqual(coldLoadCount * 2);
  });

  it("P3: p95 under 50 ms on a 20k-event window, single output array", () => {
    const w = largeSyntheticWindow(140, 150);
    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t = performance.now();
      compactEventsForReplay(w);
      samples.push(performance.now() - t);
    }
    samples.sort((a, b) => a - b);
    expect(samples[Math.floor(samples.length * 0.95) - 1]).toBeLessThan(50);
  });

  it("returns a NEW array and never mutates the input window", () => {
    const w = [ev("message_start", 1), assistantUpdate(2, "a"), ev("message_end", 3)];
    const snapshot = [...w];
    const out = compactEventsForReplay(w);
    expect(out).not.toBe(w);
    expect(w).toEqual(snapshot);
  });
});

/**
 * The caller-supplied supersession boundary — test-plan E23, E24, E25.
 * See change: lazy-load-session-history (D7).
 */
describe("compactEventsForReplay — external supersession boundary", () => {
  it("E23: omitting the boundary reproduces the pre-change behaviour exactly", () => {
    const w: StoredEvent[] = [
      ev("message_start", 1),
      assistantUpdate(2, "a"),
      assistantUpdate(3, "ab"),
      ev("message_end", 4),
      assistantUpdate(5, "tail"),
    ];
    // Same array, boundary derived internally vs passed as today's derived
    // value: the two MUST be indistinguishable, or every existing caller moved.
    expect(compactEventsForReplay(w)).toEqual(compactEventsForReplay(w, 3));
    expect(seqs(compactEventsForReplay(w))).toEqual([1, 4, 5]);
  });

  it("E24: an external boundary supersedes a slice that holds no message_end of its own", () => {
    // A GAP SLICE: its own trailing `message_end` lives outside it, in the
    // already-delivered tail. Derived naively, the boundary would be -1 and
    // every stale cumulative snapshot would survive to render over a closed
    // message. Passing `slice.length` supersedes the whole slice.
    const slice: StoredEvent[] = [
      assistantUpdate(100, "a"),
      assistantUpdate(101, "ab"),
      assistantUpdate(102, "abc"),
    ];
    expect(seqs(compactEventsForReplay(slice))).toEqual([102]);
    expect(compactEventsForReplay(slice, slice.length)).toEqual([]);
  });

  it("E25: BOTH documented exemptions still hold under an external boundary", () => {
    const slice: StoredEvent[] = [
      ev("message_update", 200, { assistantMessageEvent: { type: "thinking_delta" } }),
      assistantUpdate(201, "dropped"),
      assistantUpdate(202, "seeds the flushed row"),
      ev("tool_execution_start", 203),
      assistantUpdate(204, "also dropped"),
    ];
    const out = compactEventsForReplay(slice, slice.length);
    // The thinking update (client builds `role:"thinking"` rows from these) and
    // the LAST text-bearing update before the tool start (which seeds
    // `streamingText` for the `flush-<toolCallId>` row) both survive.
    expect(seqs(out)).toEqual([200, 202, 203]);
  });
});


describe("adjacent unfinished snapshots", () => {
  it("E1: retains the final object for zero, one and two updates", () => {
    for (const n of [0, 1, 2]) {
      const w = Array.from({ length: n }, (_, i) => assistantUpdate(i + 1, `${i}`));
      const out = compactEventsForReplay(w);
      expect(out.length).toBe(Math.min(n, 1));
      if (n) expect(out[0]).toBe(w[n - 1]);
    }
  });
  it("E2 E3 X1: recognizes only complete text snapshots and supported metadata", () => {
    const good = [
      { message: { role: "assistant", content: "" } },
      { message: { role: "assistant", content: [] } },
      { message: { role: "assistant", content: [{ type: "text", text: "x" }] } },
      ...["text_start", "text_delta", "text_end"].map(type => ({ message: { role: "assistant", content: "x" }, assistantMessageEvent: { type } })),
    ];
    const bad = [
      { message: { role: "user", content: "x" } }, {},
      ...[[null], [{ type: "thinking", thinking: "x" }], [{ type: "text" }], [{ type: "image" }], [{ type: "toolCall" }]].map(content => ({ message: { role: "assistant", content } })),
      ...[null, "text_delta", { type: 4 }, { type: "thinking_start" }, { type: "other" }].map(assistantMessageEvent => ({ message: { role: "assistant", content: "x" }, assistantMessageEvent })),
    ];
    for (const [eligible, cases] of [[true, good], [false, bad]] as const) {
      for (const data of cases) {
        const w = [assistantUpdate(1, "a"), ev("message_update", 2, data), assistantUpdate(3, "b")];
        expect(compactEventsForReplay(w)).toEqual(eligible ? [w[2]] : w);
      }
    }
  });
  it("E4: separators preserve original adjacency", () => {
    for (const type of ["tool_execution_start", "tool_execution_end", "message_start", "message_end", "subagent_created", "stats_update", "session_compact"]) {
      const w = [assistantUpdate(1, "a"), ev(type, 2), assistantUpdate(3, "b")];
      expect(compactEventsForReplay(w, 0)).toEqual(w);
    }
  });
  it("E5 E6: preserves prefix exemptions and uses original boundary positions", () => {
    const think = ev("message_update", 3, { assistantMessageEvent: { type: "thinking_start" } });
    const w = [assistantUpdate(1, "a"), assistantUpdate(2, "ab"), think, assistantUpdate(4, "b"), assistantUpdate(5, "bc")];
    for (const [boundary, expected] of [[undefined, [2,3,5]], [0, [2,3,5]], [2, [3,5]], [5, [3]]] as const)
      expect(seqs(compactEventsForReplay(w, boundary))).toEqual(expected);
    const prefix = [ev("message_start", 1), assistantUpdate(2, "drop"), think, assistantUpdate(4, "seed"), ev("tool_execution_start", 5), ev("message_end", 6), ...Array.from({length: 12}, (_, i) => assistantUpdate(i + 7, `${i}`))];
    expect(seqs(compactEventsForReplay(prefix))).toEqual([1,3,4,5,6,18]);
  });
  it("E7 E8: frozen inputs retain references and derived compaction is idempotent", () => {
    for (const w of [[assistantUpdate(1,"a"), assistantUpdate(2,"ab")], [assistantUpdate(1,"a"), ev("stats_update",2), assistantUpdate(3,"b"), assistantUpdate(4,"bc")], [assistantUpdate(1,"a"), ev("message_end",2), assistantUpdate(3,"b"), assistantUpdate(4,"bc")]]) {
      const before = JSON.stringify(w); w.forEach(e => { Object.freeze(e.event.data); Object.freeze(e.event); Object.freeze(e); }); Object.freeze(w);
      const once = compactEventsForReplay(w); const twice = compactEventsForReplay(once);
      expect(JSON.stringify(w)).toBe(before);
      expect(twice).toEqual(once); twice.forEach((e, i) => expect(e).toBe(once[i]));
    }
  });
});

function generatedPayload(kind: number, i: number): Record<string, unknown> {
  const assistant = (content: unknown) => ({ role: "assistant", content });
  switch (kind) {
    case 0: return { message: assistant("") };
    case 1: return { message: assistant([]) };
    case 2: return { message: assistant([{ type: "text", text: `${i}` }]) };
    case 3: case 4: case 5: return { message: assistant(`${i}`), assistantMessageEvent: { type: ["text_start", "text_delta", "text_end"][kind - 3] } };
    case 6: return { message: assistant(`${i}`) };
    case 7: return { message: { role: "user", content: "x" } };
    case 8: return { message: assistant([{ type: "image" }]) };
    case 9: return { message: assistant("x"), assistantMessageEvent: null };
    case 10: return { message: assistant("x"), assistantMessageEvent: { type: "unsupported" } };
    case 11: return { assistantMessageEvent: { type: "thinking_start" } };
    case 12: return { message: assistant("x"), assistantMessageEvent: "text_delta" };
    case 13: return { message: assistant("x"), assistantMessageEvent: { type: 1 } };
    default: return {};
  }
}

function generatedStructuralCase(seed: number, counts: Set<string>) {
  const w: StoredEvent[] = []; const eligible: boolean[] = [];
  const runSize = seed % 4;
  for (let i = 0; i < runSize; i++) {
    w.push(assistantUpdate(2 * w.length + 1, `prefix-${i}`)); eligible.push(true);
  }
  const separators = ["tool_execution_start", "tool_execution_end", "message_start", "message_end", "subagent_created", "stats_update", "session_compact"];
  for (let i = 0; i < seed % 29; i++) {
    const kind = (seed * 13 + i * 7) % 22; counts.add(`${kind}`);
    w.push(ev(kind >= 15 ? separators[kind - 15] : "message_update", 2 * w.length + 1, generatedPayload(kind, i)));
    eligible.push(kind < 7);
  }
  const boundary = seed % 3 === 0 ? 0 : seed % 3 === 1 ? w.length : Math.min(1, w.length);
  return { w, eligible, boundary, runSize };
}

function assertStructuralCase(seed: number, w: StoredEvent[], eligible: boolean[], boundary: number) {
  const original = JSON.stringify(w);
  w.forEach(e => { Object.freeze(e.event.data); Object.freeze(e.event); Object.freeze(e); }); Object.freeze(w);
  try {
    const result = compactEventsForReplay(w, boundary);
    const expectedTail = w.filter((_, i) => i >= boundary && !(eligible[i] && eligible[i + 1]));
    expect(result.filter(e => w.indexOf(e) >= boundary), `seed ${seed}: ${original}`).toEqual(expectedTail);
    let last = -1; for (const e of result) { const index = w.indexOf(e); expect(index).toBeGreaterThan(last); last = index; }
    expect(JSON.stringify(w)).toBe(original);
    const once = compactEventsForReplay(w); const twice = compactEventsForReplay(once);
    expect(twice).toEqual(once); twice.forEach((e, i) => expect(e).toBe(once[i]));
  } catch (error) {
    throw new Error(`E9 seed ${seed}, boundary ${boundary}, input ${original}`, { cause: error });
  }
}

it("E9: generated annotated runs preserve tail boundaries, identity and idempotence", () => {
  const counts = new Set<string>(); const boundaries = new Set<string>(); const runSizes = new Set<number>();
  const generatedInputs: Array<{ seed: number; boundary: number; input: StoredEvent[] }> = [];
  let insideRun = 0;
  for (let seed = 0; seed < 240; seed++) {
    const { w, eligible, boundary, runSize } = generatedStructuralCase(seed, counts);
    runSizes.add(runSize); generatedInputs.push({ seed, boundary, input: w });
    if (boundary > 0 && eligible[boundary - 1] && eligible[boundary]) insideRun++;
    boundaries.add(boundary === 0 ? "zero" : boundary === w.length ? "end" : "inside");
    assertStructuralCase(seed, w, eligible, boundary);
  }
  const coverageContext = `E9 generated inputs ${JSON.stringify(generatedInputs)}`;
  expect(counts.size, coverageContext).toBe(22);
  expect([...runSizes].sort(), coverageContext).toEqual([0, 1, 2, 3]);
  expect(insideRun, coverageContext).toBeGreaterThan(0);
  expect([...boundaries].sort(), coverageContext).toEqual(["end", "inside", "zero"]);
});
