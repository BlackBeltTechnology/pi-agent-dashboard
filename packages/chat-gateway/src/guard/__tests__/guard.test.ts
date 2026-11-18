/**
 * L3 guard handler tests — the hard `{block:true}` gate, the chat approval
 * escalation, and the FAIL-CLOSED timeout (C3).
 *
 * See change: add-chat-gateway.
 */
import { describe, expect, it, vi } from "vitest";
import { createToolCallGuard, policyFromEnv } from "../index.js";

function ctxWithConfirm(confirm: (title: string, message?: string) => Promise<boolean>) {
  return { ui: { confirm, notify: vi.fn() } };
}

describe("policyFromEnv (V.2 wiring)", () => {
  it("parses the host-projected policy", () => {
    const env = { PI_EXT_CHAT_GATEWAY_GUARD_POLICY: '{"allow":["read"],"approval":["bash"]}' };
    expect(policyFromEnv(env)).toEqual({ allow: ["read"], approval: ["bash"] });
  });

  it("defaults to deny-all when the env is absent or unparseable (fails CLOSED)", () => {
    expect(policyFromEnv({})).toEqual({ defaultAction: "deny" });
    expect(policyFromEnv({ PI_EXT_CHAT_GATEWAY_GUARD_POLICY: "{not json" })).toEqual({
      defaultAction: "deny",
    });
  });
});

describe("createToolCallGuard", () => {
  it("X2: a denied tool is blocked BEFORE execution and never prompts", async () => {
    const confirm = vi.fn(async () => true);
    const guard = createToolCallGuard({ policy: { allow: ["read"] } });

    const result = await guard({ toolName: "bash" }, ctxWithConfirm(confirm));

    expect(result).toEqual({ block: true, reason: "chat-gateway: denied_by_default" });
    expect(confirm).not.toHaveBeenCalled();
  });

  it("an allowed tool proceeds (no block, no prompt)", async () => {
    const confirm = vi.fn(async () => true);
    const guard = createToolCallGuard({ policy: { allow: ["read"] } });

    expect(await guard({ toolName: "read" }, ctxWithConfirm(confirm))).toBeUndefined();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("X3: an approval-gated tool prompts; ALLOW runs it", async () => {
    const confirm = vi.fn(async () => true);
    const guard = createToolCallGuard({ policy: { approval: ["bash"] } });

    expect(await guard({ toolName: "bash" }, ctxWithConfirm(confirm))).toBeUndefined();
    expect(confirm).toHaveBeenCalledOnce();
  });

  it("X3: an approval-gated tool prompts; DENY blocks it", async () => {
    const guard = createToolCallGuard({ policy: { approval: ["bash"] } });

    const result = await guard({ toolName: "bash" }, ctxWithConfirm(async () => false));

    expect(result).toEqual({ block: true, reason: "chat-gateway: approval_denied_or_timed_out" });
  });

  it("X4: an UNANSWERED approval fails closed (blocked, never auto-allowed)", async () => {
    // A confirm that never settles, with a timer that fires immediately.
    const guard = createToolCallGuard({
      policy: { approval: ["bash"] },
      timeoutMs: 5_000,
      schedule: (fn) => {
        fn();
        return 1;
      },
      cancel: () => {},
    });

    const result = await guard(
      { toolName: "bash" },
      ctxWithConfirm(() => new Promise<boolean>(() => {})),
    );

    expect(result).toEqual({ block: true, reason: "chat-gateway: approval_denied_or_timed_out" });
  });

  it("a THROWING confirm fails closed (blocked, never allowed)", async () => {
    const guard = createToolCallGuard({ policy: { approval: ["bash"] } });

    const result = await guard(
      { toolName: "bash" },
      ctxWithConfirm(async () => {
        throw new Error("ui exploded");
      }),
    );

    expect(result).toEqual({ block: true, reason: "chat-gateway: approval_denied_or_timed_out" });
  });

  it("an approvable-by-default policy still prompts (and still fails closed on no answer)", async () => {
    const confirm = vi.fn(async () => false);
    const guard = createToolCallGuard({ policy: { defaultAction: "approve" } });

    const result = await guard({ toolName: "mystery" }, ctxWithConfirm(confirm));

    expect(confirm).toHaveBeenCalledOnce();
    expect(result?.block).toBe(true);
  });
});

// ── harden-agent-tool-guards D6: readiness announcement (T.88) ───────────────────────────────
import chatGatewayGuard, { tokenFromEnv } from "../index.js";

describe("T.88 readiness announcement at session_start", () => {
  function fakePi() {
    const handlers: Record<string, Array<(...a: unknown[]) => unknown>> = {};
    const order: string[] = [];
    const emitted: Array<{ name: string; payload: unknown }> = [];
    const pi = {
      on: (event: string, h: (...a: unknown[]) => unknown) => {
        (handlers[event] ??= []).push(h);
        order.push(`on:${event}`);
      },
      events: { emit: (name: string, payload: unknown) => (emitted.push({ name, payload }), order.push(`emit:${name}`)) },
    };
    return { pi, handlers, order, emitted };
  }
  const withEnv = (env: Record<string, string | undefined>, fn: () => void) => {
    const prev = { t: process.env.PI_EXT_CHAT_GATEWAY_GUARD_TOKEN, p: process.env.PI_EXT_CHAT_GATEWAY_GUARD_POLICY };
    for (const [k, v] of Object.entries(env)) v === undefined ? delete process.env[k] : (process.env[k] = v);
    try {
      fn();
    } finally {
      for (const [k, v] of [["PI_EXT_CHAT_GATEWAY_GUARD_TOKEN", prev.t], ["PI_EXT_CHAT_GATEWAY_GUARD_POLICY", prev.p]] as const) {
        v === undefined ? delete process.env[k] : (process.env[k] = v);
      }
    }
  };

  it("token set: exactly one dashboard:plugin-message with the token, emitted at session_start after the tool_call handler is registered", () => {
    withEnv({ PI_EXT_CHAT_GATEWAY_GUARD_TOKEN: "t1" }, () => {
      const { pi, handlers, order, emitted } = fakePi();
      chatGatewayGuard(pi as never);
      expect(emitted).toEqual([]); // nothing at factory time
      expect(order[0]).toBe("on:tool_call");
      handlers.session_start[0]();
      expect(emitted).toEqual([
        { name: "dashboard:plugin-message", payload: { pluginId: "chat-gateway", messageType: "chat_gateway_guard_ready", payload: { token: "t1" } } },
      ]);
    });
  });

  it("unset or empty token: no session_start handler, nothing announced", () => {
    for (const token of [undefined, ""]) {
      withEnv({ PI_EXT_CHAT_GATEWAY_GUARD_TOKEN: token }, () => {
        const { pi, handlers, emitted } = fakePi();
        chatGatewayGuard(pi as never);
        expect(handlers.session_start).toBeUndefined();
        expect(emitted).toEqual([]);
        expect(tokenFromEnv()).toBeUndefined();
      });
    }
  });

  it("an unparseable policy still announces and denies every tool", async () => {
    const { pi, handlers, emitted } = fakePi();
    withEnv({ PI_EXT_CHAT_GATEWAY_GUARD_TOKEN: "t2", PI_EXT_CHAT_GATEWAY_GUARD_POLICY: "{not json" }, () => {
      chatGatewayGuard(pi as never);
      handlers.session_start[0]();
    });
    expect(emitted).toHaveLength(1);
    const result = await handlers.tool_call[0]({ toolName: "read" }, { ui: { confirm: async () => true } });
    expect(result).toMatchObject({ block: true });
  });
});
