/**
 * Bridge graceful stop-after-turn (shape contract).
 *
 * Models the bridge's two touch points:
 *   - onMessage stop_after_turn → set state.shouldStopAfterTurn = true
 *   - turn_end with flag set → cachedCtx.shutdown() once + clear flag
 *
 * See change: adopt-pi-071-072-073-features (B.2).
 */
import { describe, it, expect, vi } from "vitest";

interface FakeState {
  shouldStopAfterTurn?: boolean;
}

// Mirrors the bridge onMessage stop_after_turn branch.
function onStopAfterTurn(state: FakeState): void {
  state.shouldStopAfterTurn = true;
}

// Mirrors the bridge turn_end branch.
function onTurnEnd(state: FakeState, ctx: { shutdown?: () => void; abort?: () => void }): void {
  if (!state.shouldStopAfterTurn) return;
  state.shouldStopAfterTurn = false;
  try {
    if (typeof ctx?.shutdown === "function") ctx.shutdown();
    else ctx?.abort?.();
  } catch {
    /* non-fatal */
  }
}

describe("bridge stop-after-turn latch", () => {
  it("stop_after_turn sets the flag; turn_end shuts down once and clears it", () => {
    const state: FakeState = {};
    const shutdown = vi.fn();
    const ctx = { shutdown };

    onStopAfterTurn(state);
    expect(state.shouldStopAfterTurn).toBe(true);

    onTurnEnd(state, ctx);
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(state.shouldStopAfterTurn).toBe(false);

    // A second turn_end after the flag clears does NOT shut down again.
    onTurnEnd(state, ctx);
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it("falls back to abort when shutdown is unavailable", () => {
    const state: FakeState = {};
    const abort = vi.fn();
    const ctx = { abort };

    onStopAfterTurn(state);
    onTurnEnd(state, ctx);
    expect(abort).toHaveBeenCalledTimes(1);
    expect(state.shouldStopAfterTurn).toBe(false);
  });

  it("is idempotent: repeated stop_after_turn keeps a single pending latch", () => {
    const state: FakeState = {};
    onStopAfterTurn(state);
    onStopAfterTurn(state);
    expect(state.shouldStopAfterTurn).toBe(true);

    const shutdown = vi.fn();
    onTurnEnd(state, { shutdown });
    expect(shutdown).toHaveBeenCalledTimes(1);
  });
});
