/**
 * A deliberately-in-flight request keeps its assertion (test-plan #X16).
 *
 * Design D3's trap: the dominant pattern in the touched extension suites is
 * fire-then-assert — `bus.request(...)` is left in flight ON PURPOSE, then the
 * test asserts on adapter state. Adding `await` at the call site would settle
 * the request before the assertion and change what the test proves, and
 * `await expect(p).rejects…` would be worse still: `PromptBus.request` is
 * `new Promise((resolve) => …)` with NO reject path, so a `.rejects` assertion
 * against one of these promises can only ever fail.
 *
 * These tests pin the settle contract the suites now rely on, so a future edit
 * cannot quietly swap it for one that asserts less.
 *
 * See change: cleanup-async-semantics-server-extension (test-plan #X16, design D3).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PromptBus, type PromptAdapter, type PromptRequest } from "../prompt-bus.js";
import { settlePrompts } from "./helpers/settle-prompts.js";

function createMockAdapter(name: string, claim: unknown = {}): PromptAdapter {
  return {
    name,
    onRequest: vi.fn().mockReturnValue(claim),
    onResponse: vi.fn(),
    onCancel: vi.fn(),
  } as unknown as PromptAdapter;
}

describe("deliberately-in-flight requests settle without weakening the test", () => {
  let bus: PromptBus;

  beforeEach(() => {
    vi.useFakeTimers();
    bus = new PromptBus({ timeoutMs: 5000, onDashboardRequest: vi.fn() });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("the adapter interaction is observable BEFORE the promise settles", async () => {
    const adapter = createMockAdapter("a");
    bus.registerAdapter(adapter);

    const pending = bus.request({ pipeline: "command", type: "select", question: "Q", options: ["A"] });

    // This is the assertion the fire-then-assert pattern exists to make. It
    // must hold while the request is still in flight — that is the whole point.
    expect(adapter.onRequest).toHaveBeenCalledWith(
      expect.objectContaining({ pipeline: "command", question: "Q" }),
    );
    expect(bus.pendingCount).toBe(1);

    await settlePrompts(bus, pending);
    expect(bus.pendingCount).toBe(0);
  });

  it("settling RESOLVES — the promise has no reject path to assert against", async () => {
    const adapter = createMockAdapter("a");
    bus.registerAdapter(adapter);

    const pending = bus.request({ pipeline: "command", type: "select", question: "Q", options: [] });
    await settlePrompts(bus, pending);

    // `.resolves`, never `.rejects`. If `request` ever grew a reject path this
    // assertion is where that shows up.
    await expect(pending).resolves.toEqual(
      expect.objectContaining({ cancelled: true, source: "__bus__" }),
    );
  });

  it("a request that an adapter DID answer keeps its answer through the settle", async () => {
    const adapter = createMockAdapter("a");
    bus.registerAdapter(adapter);

    const pending = bus.request({ pipeline: "command", type: "select", question: "Q", options: ["A"] });
    const id = (vi.mocked(adapter.onRequest).mock.calls[0][0] as PromptRequest).id;
    bus.respond({ id, answer: "A", source: "a" });

    // settlePrompts must not clobber a real answer with a cancellation.
    await settlePrompts(bus, pending);
    await expect(pending).resolves.toEqual({ id, answer: "A", source: "a" });
  });

  it("settling is safe on a bus with no dashboard callback", async () => {
    // Regression guard: `getPendingRequests()` skips entries with no resolved
    // component, and `request` only resolves the generic-dialog fallback when
    // `onDashboardRequest` is configured. A settle built on that accessor hangs
    // forever here — which is exactly how this helper first failed.
    const bare = new PromptBus({ timeoutMs: 5000 });
    bare.registerAdapter(createMockAdapter("tui", {}));
    const pending = bare.request({ pipeline: "command", type: "select", question: "Q", options: ["A"] });

    await settlePrompts(bare, pending);
    await expect(pending).resolves.toEqual(expect.objectContaining({ cancelled: true }));
  });
});

describe("X16: no `.rejects` was applied to a resolving prompt request", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const TOUCHED = [
    "prompt-bus.test.ts",
    "prompt-bus-wiring.test.ts",
    "tui-prompt-adapter.test.ts",
  ];

  it("the touched suites assert `.rejects` on no promise returned by `request`", () => {
    for (const file of TOUCHED) {
      const src = fs.readFileSync(path.join(here, file), "utf8");
      // `expect(<x>).rejects` where <x> is a captured request promise. These
      // suites name them `pending`, `inflight`, `promise`, `first`, `second`,
      // `commandInflight`, `architectInflight`.
      const offenders = [
        ...src.matchAll(
          /expect\(\s*(pending|inflight|promise\d*|first|second|commandInflight|architectInflight)\s*\)\s*\.rejects/g,
        ),
      ].map((m) => `${file}: expect(${m[1]}).rejects`);
      expect(offenders, "a resolving request cannot reject — this assertion can only fail").toEqual([]);
    }
  });

  it("every touched suite settles through the shared helper", () => {
    // Guards the guard: if a suite stopped importing the helper, the assertion
    // above would pass trivially.
    for (const file of TOUCHED) {
      const src = fs.readFileSync(path.join(here, file), "utf8");
      expect(src, `${file} no longer uses settlePrompts`).toContain("settlePrompts");
    }
  });
});
