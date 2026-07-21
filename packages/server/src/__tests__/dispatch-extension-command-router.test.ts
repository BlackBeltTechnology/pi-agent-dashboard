/**
 * dispatch-router unit tests (Phase 8 / task 8.7).
 *
 * Drives `handleDispatchExtensionCommand` with a mock `headlessPidRegistry`
 * + browser broadcaster; asserts the optimistic-completion contract from
 * `extension-rpc-dispatch` Requirement "Server-side dispatch routing to keeper".
 *
 * See change: add-rpc-stdin-dispatch-with-keeper-sidecar.
 */
import { describe, it, expect, vi } from "vitest";
import {
  buildPiRpcLine,
  handleDispatchExtensionCommand,
  type DispatchRouterContext,
} from "../rpc-keeper/dispatch-router.js";
import type { HeadlessPidRegistry } from "../spawn-process/headless-pid-registry.js";

// ── Mocks ────────────────────────────────────────────────────────────────────

interface FakeRegistryState {
  writeRpcCalls: Array<{ sessionId: string; line: string }>;
  writeRpcResult: boolean | Error;
}

function makeFakeRegistry(opts: { result: boolean | Error }): {
  registry: HeadlessPidRegistry;
  state: FakeRegistryState;
} {
  const state: FakeRegistryState = {
    writeRpcCalls: [],
    writeRpcResult: opts.result,
  };
  const registry: Partial<HeadlessPidRegistry> = {
    writeRpc: async (sessionId, line) => {
      state.writeRpcCalls.push({ sessionId, line });
      if (state.writeRpcResult instanceof Error) throw state.writeRpcResult;
      return state.writeRpcResult;
    },
  };
  return { registry: registry as HeadlessPidRegistry, state };
}

interface FeedbackBroadcast {
  sessionId: string;
  command: string;
  status: "completed" | "error";
  message?: string;
}

function makeContext(registry: HeadlessPidRegistry): {
  ctx: DispatchRouterContext;
  broadcasts: FeedbackBroadcast[];
} {
  const broadcasts: FeedbackBroadcast[] = [];
  return {
    ctx: {
      headlessPidRegistry: registry,
      emitCommandFeedback: (sessionId, command, status, message) =>
        broadcasts.push({ sessionId, command, status, message }),
    },
    broadcasts,
  };
}

function feedbackData(b: FeedbackBroadcast): FeedbackBroadcast {
  return b;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("buildPiRpcLine", () => {
  it("constructs the pi RPC prompt JSON with command and id", () => {
    const line = buildPiRpcLine("/ctx-stats", "req-1");
    expect(JSON.parse(line)).toEqual({
      type: "prompt",
      message: "/ctx-stats",
      id: "req-1",
    });
  });

  it("preserves command text verbatim (no quoting)", () => {
    const line = buildPiRpcLine("/ctx-stats verbose=1", "req-2");
    const parsed = JSON.parse(line);
    expect(parsed.message).toBe("/ctx-stats verbose=1");
  });
});

describe("handleDispatchExtensionCommand", () => {
  it("success path: writeRpc invoked, optimistic 'completed' broadcast", async () => {
    const { registry, state } = makeFakeRegistry({ result: true });
    const { ctx, broadcasts } = makeContext(registry);

    await handleDispatchExtensionCommand(
      { type: "dispatch_extension_command", sessionId: "S1", command: "/ctx-stats", requestId: "r1" },
      ctx,
    );

    expect(state.writeRpcCalls).toHaveLength(1);
    expect(state.writeRpcCalls[0].sessionId).toBe("S1");
    expect(JSON.parse(state.writeRpcCalls[0].line)).toEqual({
      type: "prompt",
      message: "/ctx-stats",
      id: "r1",
    });

    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0].sessionId).toBe("S1");
    expect(broadcasts[0].command).toBe("/ctx-stats");
    expect(broadcasts[0].status).toBe("completed");
    expect(broadcasts[0].message).toBeUndefined();
  });

  it("no-keeper path: writeRpc returns false \u2192 'error' with keeper-unavailable message", async () => {
    const { registry } = makeFakeRegistry({ result: false });
    const { ctx, broadcasts } = makeContext(registry);

    await handleDispatchExtensionCommand(
      { type: "dispatch_extension_command", sessionId: "S2", command: "/curator", requestId: "r2" },
      ctx,
    );

    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0].status).toBe("error");
    expect(broadcasts[0].command).toBe("/curator");
    expect(broadcasts[0].message).toMatch(/RPC keeper unavailable/);
  });

  it("write-fails path: writeRpc throws \u2192 'error' with reason-prefixed message", async () => {
    const { registry } = makeFakeRegistry({ result: new Error("EPIPE") });
    const { ctx, broadcasts } = makeContext(registry);

    await handleDispatchExtensionCommand(
      { type: "dispatch_extension_command", sessionId: "S3", command: "/agents", requestId: "r3" },
      ctx,
    );

    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0].status).toBe("error");
    expect(broadcasts[0].message).toMatch(/Failed to write RPC line/);
    expect(broadcasts[0].message).toMatch(/EPIPE/);
  });

  it("never throws even on registry failures", async () => {
    const { registry } = makeFakeRegistry({ result: new Error("boom") });
    const { ctx } = makeContext(registry);

    await expect(
      handleDispatchExtensionCommand(
        { type: "dispatch_extension_command", sessionId: "S4", command: "/x", requestId: "r4" },
        ctx,
      ),
    ).resolves.toBeUndefined();
  });

  it("emits exactly one broadcast per dispatch (success)", async () => {
    const { registry } = makeFakeRegistry({ result: true });
    const { ctx, broadcasts } = makeContext(registry);

    await handleDispatchExtensionCommand(
      { type: "dispatch_extension_command", sessionId: "S5", command: "/x", requestId: "r5" },
      ctx,
    );

    expect(broadcasts).toHaveLength(1);
  });

  it("emits exactly one broadcast per dispatch (failure)", async () => {
    const { registry } = makeFakeRegistry({ result: false });
    const { ctx, broadcasts } = makeContext(registry);

    await handleDispatchExtensionCommand(
      { type: "dispatch_extension_command", sessionId: "S6", command: "/x", requestId: "r6" },
      ctx,
    );

    expect(broadcasts).toHaveLength(1);
  });
});
