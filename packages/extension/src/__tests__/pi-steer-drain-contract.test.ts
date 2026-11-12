/**
 * Contract with the INSTALLED pi-agent-core loop: the bridge hands held steers
 * to pi inside its awaited `turn_end` handler, which pi-coding-agent runs from
 * the loop's `finishTurn`. That is race-free only while the loop
 *   - awaits `finishTurn` BEFORE it polls `getSteeringMessages()` on a
 *     completed turn, and delivers what it finds before the next LLM call;
 *   - never polls steering after `finishTurn` on an aborted turn (held steers
 *     then wait for the bridge's settle drain).
 * A pi upgrade that reorders either breaks this test, not users.
 *
 * Covers test-plan row E25. See change: bridge-owned-cancellable-steer (D1).
 */
import { runAgentLoop } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";

type Msg = Record<string, unknown>;

function assistant(text: string, stopReason: string): Msg {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason,
    api: "stub",
    provider: "stub",
    model: "stub",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    timestamp: Date.now(),
  };
}

/** One canned assistant reply per LLM call; records what each call saw. */
function stubStream(replies: Msg[], seen: Msg[][]) {
  let call = 0;
  return async (_model: unknown, ctx: { messages: Msg[] }) => {
    seen.push([...ctx.messages]);
    const message = replies[Math.min(call++, replies.length - 1)];
    return {
      async *[Symbol.asyncIterator]() {
        yield { type: "done", reason: message.stopReason, message };
      },
      result: async () => message,
    };
  };
}

async function run(replies: Msg[]) {
  const order: string[] = [];
  const seen: Msg[][] = [];
  const queue: Msg[] = [];
  let enqueued = false;
  const steer: Msg = { role: "user", content: [{ type: "text", text: "held steer" }], timestamp: 1 };
  await runAgentLoop(
    [{ role: "user", content: [{ type: "text", text: "go" }], timestamp: 0 }] as never,
    { systemPrompt: "", messages: [], tools: [] } as never,
    {
      model: { provider: "stub", id: "stub", api: "stub" },
      convertToLlm: (m: Msg[]) => m,
      finishTurn: async () => {
        // The bridge's turn_end hand-off: enqueue after a macrotask, as pi's
        // async prompt() chain does.
        order.push("finishTurn:start");
        if (!enqueued) {
          enqueued = true;
          await new Promise((resolve) => setTimeout(resolve, 0));
          queue.push(steer);
        }
        order.push("finishTurn:end");
        return undefined;
      },
      getSteeringMessages: async () => {
        order.push("getSteering");
        return queue.splice(0);
      },
      getFollowUpMessages: async () => [],
    } as never,
    async (event: { type: string }) => {
      if (event.type === "turn_end") order.push("turn_end");
    },
    undefined,
    stubStream(replies, seen) as never,
  );
  return { order, seen, steer };
}

describe("installed pi-agent-core drains steers after the awaited turn boundary", () => {
  it("completed turn: finishTurn is awaited before the steering poll; the steer reaches the 2nd LLM call", async () => {
    const r = await run([assistant("one", "stop"), assistant("two", "stop")]);
    const firstEnd = r.order.indexOf("finishTurn:end");
    const pollAfter = r.order.indexOf("getSteering", firstEnd);
    expect(firstEnd).toBeGreaterThan(-1);
    expect(pollAfter).toBeGreaterThan(firstEnd);
    expect(r.order.slice(r.order.indexOf("finishTurn:start"), pollAfter)).toEqual([
      "finishTurn:start",
      "finishTurn:end",
      "turn_end",
    ]);
    expect(r.seen).toHaveLength(2);
    expect(r.seen[0]).not.toContainEqual(r.steer);
    expect(r.seen[1]).toContainEqual(r.steer);
  });

  it("aborted turn: no steering poll after finishTurn", async () => {
    const r = await run([assistant("cut", "aborted")]);
    const end = r.order.indexOf("finishTurn:end");
    expect(end).toBeGreaterThan(-1);
    expect(r.order.slice(end)).not.toContain("getSteering");
    expect(r.seen).toHaveLength(1);
  });
});
