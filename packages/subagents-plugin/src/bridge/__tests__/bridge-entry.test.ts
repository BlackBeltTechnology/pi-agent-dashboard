/**
 * subagents-plugin bridge entry declares the step + delta streams (test-plan #E26).
 * See change: add-plugin-bridge-contributions.
 *
 * Stop answers + registry snapshot (test-plan #E1–#E8, #X1, #X5).
 * See change: fix-background-subagent-ghost-rows.
 */

import {
  BRIDGE_READY_CHANNEL,
  REGISTER_EVENT_FORWARD_CHANNEL,
  RESERVED_EVENT_TYPES,
} from "@blackbelt-technology/pi-dashboard-shared/event-forward-declaration.js";
import { describe, expect, it } from "vitest";
import activate, {
  REGISTRY_QUERY_CHANNEL,
  REGISTRY_SNAPSHOT_CHANNEL,
  STOP_CHANNEL,
  STOP_RESULT_CHANNEL,
  SUBAGENTS_FORWARD_DECLARATION,
} from "../index.js";

type Handler = (d: unknown) => void;

/** A synchronous EventEmitter-shaped bus, like pi's (listeners in registration order). */
function fakePi() {
  const emitted: Array<{ channel: string; data: unknown }> = [];
  const handlers = new Map<string, Handler[]>();
  return {
    emitted,
    handlers,
    events: {
      emit: (channel: string, data: unknown) => {
        emitted.push({ channel, data });
        for (const h of handlers.get(channel) ?? []) h(data);
      },
      on: (channel: string, h: Handler) => {
        handlers.set(channel, [...(handlers.get(channel) ?? []), h]);
        return () => handlers.set(channel, (handlers.get(channel) ?? []).filter((x) => x !== h));
      },
    },
  };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));
const ofChannel = (pi: ReturnType<typeof fakePi>, channel: string) =>
  pi.emitted.filter((e) => e.channel === channel).map((e) => e.data as Record<string, unknown>);

/** A producer stub listener pushing one verdict synchronously. */
const verdictStub = (verdict: Record<string, unknown>) => (d: unknown) => {
  const data = d as { verdicts?: unknown[] };
  (data.verdicts ??= []).push(verdict);
};

const EXPECTED_DECLARATION = {
  pluginId: "subagents",
  channels: {
    "subagents:entry": { as: "subagent_entry", delivery: "stream", key: "agentId" },
    "subagents:delta": { as: "subagent_delta", delivery: "stream", key: "agentId" },
    "subagents:stop_result": { as: "subagent_stop_result", delivery: "latest", key: "agentId" },
    "subagents:registry_snapshot": { as: "subagent_registry_snapshot", delivery: "latest", key: "scope" },
  },
};

describe("subagents-plugin bridge entry", () => {
  it("declares entry + delta streams on activate and on every bridge-ready", () => {
    const pi = fakePi();
    activate(pi);
    pi.events.emit(BRIDGE_READY_CHANNEL, {});
    pi.events.emit(BRIDGE_READY_CHANNEL, {});
    const decls = pi.emitted.filter((e) => e.channel === REGISTER_EVENT_FORWARD_CHANNEL);
    expect(decls).toHaveLength(3);
    for (const d of decls) {
      expect(d.data).toEqual(EXPECTED_DECLARATION);
    }
    expect(SUBAGENTS_FORWARD_DECLARATION.pluginId).toBe("subagents");
  });

  it("accepts ctx wrapped as { pi } and is a no-op without an event bus", () => {
    const pi = fakePi();
    activate({ pi });
    expect(pi.emitted.some((e) => e.channel === REGISTER_EVENT_FORWARD_CHANNEL)).toBe(true);
    expect(() => activate({})).not.toThrow();
  });
});

describe("stop answer (#E1–#E3, #E8, #X1)", () => {
  async function answerFor(verdicts: Array<Record<string, unknown>>) {
    const pi = fakePi();
    activate(pi);
    for (const v of verdicts) pi.events.on(STOP_CHANNEL, verdictStub(v));
    pi.events.emit(STOP_CHANNEL, { agentId: "A" });
    await flush();
    return ofChannel(pi, STOP_RESULT_CHANNEL);
  }

  it.each([
    [[{ phase: "unknown" }], { phase: "unknown", outcome: "ignored", status: undefined }],
    [[{ phase: "terminal", status: "completed" }], { phase: "terminal", outcome: "ignored", status: "completed" }],
    [[{ phase: "terminal" }], { phase: "terminal", outcome: "ignored", status: undefined }],
    [[{ phase: "unknown" }, { phase: "running" }], { phase: "running", outcome: "stopped", status: undefined }],
    [[{ phase: "terminal", status: "stopped" }, { phase: "queued" }], { phase: "queued", outcome: "stopped", status: undefined }],
    [[{ phase: "unknown" }, { phase: "terminal", status: "failed" }], { phase: "terminal", outcome: "ignored", status: "failed" }],
  ])("verdicts %j → one combined answer %j (#E1)", async (verdicts, want) => {
    const answers = await answerFor(verdicts);
    expect(answers).toHaveLength(1);
    const [a] = answers;
    expect(a.agentId).toBe("A");
    expect(a.phase).toBe(want.phase);
    expect(a.outcome).toBe(want.outcome);
    expect(a.status).toBe(want.status);
    expect(typeof a.answeredAt).toBe("number");
  });

  it("sends no answer when no producer pushed a verdict (#E1 [], #X1 bridge half)", async () => {
    expect(await answerFor([])).toHaveLength(0);
  });

  it("is listener-order independent (#E2)", async () => {
    for (const before of [true, false]) {
      const pi = fakePi();
      if (before) pi.events.on(STOP_CHANNEL, verdictStub({ phase: "running" }));
      activate(pi);
      if (!before) pi.events.on(STOP_CHANNEL, verdictStub({ phase: "running" }));
      pi.events.emit(STOP_CHANNEL, { agentId: "A" });
      await flush();
      const answers = ofChannel(pi, STOP_RESULT_CHANNEL);
      expect(answers, `producer registered ${before ? "before" : "after"}`).toHaveLength(1);
      expect(answers[0].phase).toBe("running");
    }
  });

  it("does not count an asynchronous verdict (#E3)", async () => {
    const pi = fakePi();
    activate(pi);
    pi.events.on(STOP_CHANNEL, verdictStub({ phase: "unknown" }));
    pi.events.on(STOP_CHANNEL, (d) => {
      void (async () => {
        await Promise.resolve();
        await Promise.resolve();
        verdictStub({ phase: "running" })(d);
      })();
    });
    pi.events.emit(STOP_CHANNEL, { agentId: "A" });
    await Promise.resolve(); // one microtask flush: the bridge's read runs here
    const answers = ofChannel(pi, STOP_RESULT_CHANNEL);
    expect(answers).toHaveLength(1);
    expect(answers[0].phase).toBe("unknown");
  });

  it("answers exactly once per stop across a reload (#E8)", async () => {
    const pi = fakePi();
    const unsubs: Array<() => void> = [];
    const trackingEvents = {
      emit: pi.events.emit,
      on: (channel: string, h: Handler) => {
        const u = pi.events.on(channel, h);
        unsubs.push(u);
        return u;
      },
    };
    activate({ events: trackingEvents });
    for (const u of unsubs.splice(0)) u(); // reload: the loader unsubscribes the old runtime
    activate({ events: trackingEvents });
    pi.events.on(STOP_CHANNEL, verdictStub({ phase: "running" }));
    pi.events.emit(STOP_CHANNEL, { agentId: "A" });
    await flush();
    expect(ofChannel(pi, STOP_RESULT_CHANNEL)).toHaveLength(1);
  });
});

describe("registry snapshot (#E4–#E7, #X5)", () => {
  /** A producer stub answering `subagents:registry` with these producer-status entries. */
  const registryStub = (entries: Array<{ agentId: string; status: string }>) => (d: unknown) => {
    const q = d as { answered: number; entries: unknown[] };
    q.answered++;
    q.entries.push(...entries);
  };

  it("maps producer statuses to the dashboard vocabulary (#E4)", () => {
    const pi = fakePi();
    activate(pi);
    const statuses = ["queued", "running", "completed", "error", "aborted", "stopped"];
    pi.events.on(REGISTRY_QUERY_CHANNEL, registryStub(statuses.map((status, i) => ({ agentId: `a${i}`, status }))));
    pi.events.emit(BRIDGE_READY_CHANNEL, {});
    const [snap] = ofChannel(pi, REGISTRY_SNAPSHOT_CHANNEL);
    expect((snap.entries as Array<{ status: string }>).map((e) => e.status)).toEqual([
      "created", "running", "completed", "failed", "failed", "stopped",
    ]);
  });

  it("emits a snapshot only when a producer answered (#E5)", () => {
    // none
    const none = fakePi();
    activate(none);
    none.events.emit(BRIDGE_READY_CHANNEL, {});
    expect(ofChannel(none, REGISTRY_SNAPSHOT_CHANNEL)).toHaveLength(0);
    // one producer with 0 entries
    const one = fakePi();
    activate(one);
    one.events.on(REGISTRY_QUERY_CHANNEL, registryStub([]));
    one.events.emit(BRIDGE_READY_CHANNEL, {});
    const oneSnaps = ofChannel(one, REGISTRY_SNAPSHOT_CHANNEL);
    expect(oneSnaps).toHaveLength(1);
    expect(oneSnaps[0].entries).toEqual([]);
    expect(oneSnaps[0].scope).toBe("registry");
    expect(typeof oneSnaps[0].takenAt).toBe("number");
    // two producers with 1 + 2 entries
    const two = fakePi();
    activate(two);
    two.events.on(REGISTRY_QUERY_CHANNEL, registryStub([{ agentId: "a", status: "running" }]));
    two.events.on(REGISTRY_QUERY_CHANNEL, registryStub([{ agentId: "b", status: "queued" }, { agentId: "c", status: "completed" }]));
    two.events.emit(BRIDGE_READY_CHANNEL, {});
    const twoSnaps = ofChannel(two, REGISTRY_SNAPSHOT_CHANNEL);
    expect(twoSnaps).toHaveLength(1);
    expect(twoSnaps[0].entries).toHaveLength(3);
  });

  it("emits the snapshot after that bridge-ready's declare, never on plain activation (#E6)", () => {
    const pi = fakePi();
    pi.events.on(REGISTRY_QUERY_CHANNEL, registryStub([]));
    activate(pi);
    expect(ofChannel(pi, REGISTRY_SNAPSHOT_CHANNEL)).toHaveLength(0);
    const mark = pi.emitted.length;
    pi.events.emit(BRIDGE_READY_CHANNEL, {});
    const after = pi.emitted.slice(mark).map((e) => e.channel);
    const declIdx = after.indexOf(REGISTER_EVENT_FORWARD_CHANNEL);
    const snapIdx = after.indexOf(REGISTRY_SNAPSHOT_CHANNEL);
    expect(declIdx).toBeGreaterThanOrEqual(0);
    expect(snapIdx).toBeGreaterThan(declIdx);
  });

  it("declares both liveness channels as `latest`, outside the reserved types (#E7)", () => {
    const ch = SUBAGENTS_FORWARD_DECLARATION.channels;
    expect(ch["subagents:stop_result"]).toEqual({ as: "subagent_stop_result", delivery: "latest", key: "agentId" });
    expect(ch["subagents:registry_snapshot"]).toEqual({ as: "subagent_registry_snapshot", delivery: "latest", key: "scope" });
    expect(RESERVED_EVENT_TYPES.has("subagent_stop_result")).toBe(false);
    expect(RESERVED_EVENT_TYPES.has("subagent_registry_snapshot")).toBe(false);
  });

  it("survives a stale runtime whose on/emit throw (#X5)", () => {
    const emitted: string[] = [];
    const stale = {
      emit: (channel: string) => {
        emitted.push(channel);
        throw new Error("stale runtime");
      },
      on: () => {
        throw new Error("stale runtime");
      },
    };
    expect(() => activate({ events: stale })).not.toThrow();
    // No listener was wired, so no snapshot and no answer can be produced.
    expect(emitted.filter((c) => c === REGISTRY_SNAPSHOT_CHANNEL || c === STOP_RESULT_CHANNEL)).toHaveLength(0);
  });
});
