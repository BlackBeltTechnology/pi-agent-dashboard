/**
 * Bridge thinking_level_select wiring (shape contract).
 *
 * Pi 0.71+ fires a dedicated `thinking_level_select` event when the thinking
 * level changes alone. The bridge handler calls `sendModelUpdateIfChanged`,
 * which pushes ONE `model_update` per distinct (model, thinkingLevel) pair.
 * A repeat event with the same level is a no-op via the dedup gate.
 *
 * See change: adopt-pi-071-072-073-features (A.3).
 */
import { describe, it, expect } from "vitest";
import { sendModelUpdateIfChanged } from "../model-tracker.js";
import type { BridgeContext } from "../bridge-context.js";

function makeBc(thinkingLevel: string): { bc: BridgeContext; sent: any[] } {
  const sent: any[] = [];
  const bc = {
    sessionId: "S1",
    cachedCtx: { model: { provider: "anthropic", id: "claude" } },
    pi: { getThinkingLevel: () => thinkingLevel },
    connection: { send: (m: any) => sent.push(m) },
    lastModel: undefined,
    lastThinkingLevel: undefined,
  } as unknown as BridgeContext;
  return { bc, sent };
}

describe("bridge thinking_level_select → model_update", () => {
  it("fires one model_update on a new thinking level", () => {
    const { bc, sent } = makeBc("high");
    // Simulate the bridge's thinking_level_select handler.
    sendModelUpdateIfChanged(bc);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: "model_update",
      sessionId: "S1",
      model: "anthropic/claude",
      thinkingLevel: "high",
    });
  });

  it("does not re-emit when the thinking level is unchanged", () => {
    const { bc, sent } = makeBc("high");
    sendModelUpdateIfChanged(bc); // first push
    sendModelUpdateIfChanged(bc); // same value → dedup no-op
    expect(sent).toHaveLength(1);
  });

  it("re-emits when only the thinking level changes (model unchanged)", () => {
    const sent: any[] = [];
    let level = "medium";
    const bc = {
      sessionId: "S2",
      cachedCtx: { model: { provider: "anthropic", id: "claude" } },
      pi: { getThinkingLevel: () => level },
      connection: { send: (m: any) => sent.push(m) },
      lastModel: undefined,
      lastThinkingLevel: undefined,
    } as unknown as BridgeContext;

    sendModelUpdateIfChanged(bc);
    level = "high";
    sendModelUpdateIfChanged(bc);

    expect(sent).toHaveLength(2);
    expect(sent[1].thinkingLevel).toBe("high");
  });
});
