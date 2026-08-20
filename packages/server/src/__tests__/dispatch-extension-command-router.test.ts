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
import {
  dispatchReload,
  RELOAD_DISPATCH_COMMAND,
  type DispatchReloadContext,
} from "../rpc-keeper/dispatch-reload.js";
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

// ── dispatchReload: the keeper path ──────────────────────────────────────────
// See change: fix-out-of-band-reload (test-plan #E1, #E6, #E7, #X2).
describe("dispatchReload — keeper path", () => {
  function keeperHarness(opts: { writeResult?: boolean | Error; pid?: number } = {}) {
    const writeRpcCalls: string[] = [];
    const respawn = vi.fn(async () => {});
    const feedback: Array<{ command: string; status: string; message?: string }> = [];
    const killBySessionId = vi.fn(async () => true);
    const ctx: DispatchReloadContext = {
      headlessPidRegistry: {
        hasKeeper: () => true,
        getPid: () => opts.pid,
        writeRpc: async (_sid, line) => {
          writeRpcCalls.push(line);
          if (opts.writeResult instanceof Error) throw opts.writeResult;
          return opts.writeResult ?? true;
        },
        listSessions: () => [],
      },
      getSession: () => ({ status: "idle" }),
      isSessionConnected: () => true,
      sendToSession: () => true,
      respawn,
      emitCommandFeedback: (_sid, command, status, message) =>
        feedback.push({ command, status, message }),
    };
    return { ctx, writeRpcCalls, respawn, feedback, killBySessionId };
  }

  it("#E1 dispatches once and never kills the process", async () => {
    const h = keeperHarness({ pid: 1234 });
    const outcome = await dispatchReload("S1", h.ctx);

    expect(outcome).toBe("keeper");
    expect(h.writeRpcCalls).toHaveLength(1);
    expect(JSON.parse(h.writeRpcCalls[0])).toMatchObject({
      type: "prompt",
      message: RELOAD_DISPATCH_COMMAND,
    });
    expect(h.respawn).not.toHaveBeenCalled();
  });

  it("#E6 keys the terminal feedback `/reload`, not the dispatched command name", async () => {
    // The pill the trigger opened is keyed `/reload`; terminating it with
    // `/__dashboard_reload` would leave that pill stuck at "in progress"
    // forever while a second, orphan pill completed.
    const h = keeperHarness({ pid: 1234 });
    await dispatchReload("S1", h.ctx);

    expect(h.feedback).toEqual([{ command: "/reload", status: "completed", message: undefined }]);
    expect(h.feedback.every((f) => f.command !== RELOAD_DISPATCH_COMMAND)).toBe(true);
  });

  it("#E7 two reloads in quick succession both fire, with no dedup and no spawn", async () => {
    const h = keeperHarness({ pid: 1234 });
    await Promise.all([dispatchReload("S1", h.ctx), dispatchReload("S1", h.ctx)]);

    expect(h.writeRpcCalls).toHaveLength(2);
    expect(h.feedback).toHaveLength(2);
    expect(h.respawn).not.toHaveBeenCalled();
  });

  it("#X2 a throwing keeper write on a PID-less session errors with the reason, no spawn", async () => {
    const h = keeperHarness({ writeResult: new Error("ECONNREFUSED"), pid: undefined });
    const outcome = await dispatchReload("S1", h.ctx);

    expect(outcome).toBe("error");
    expect(h.respawn).not.toHaveBeenCalled();
    expect(h.feedback).toHaveLength(1);
    expect(h.feedback[0]).toMatchObject({ command: "/reload", status: "error" });
    expect(h.feedback[0].message).toContain("ECONNREFUSED");
  });
});
