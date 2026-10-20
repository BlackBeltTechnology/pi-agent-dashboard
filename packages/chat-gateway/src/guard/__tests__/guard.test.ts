/**
 * L3 guard handler tests — the hard `{block:true}` gate, the chat approval
 * escalation, and the FAIL-CLOSED timeout (C3).
 *
 * See change: add-chat-gateway.
 */

import { createToolCallGuard as createGuardViaGuardEntry } from "@blackbelt-technology/pi-dashboard-chat-gateway-plugin/guard";
import { toolGateOwner } from "@blackbelt-technology/pi-dashboard-shared/tool-gate/owner.js";
import { describe, expect, it, vi } from "vitest";
import chatGatewayGuard, { createToolCallGuard, type GuardCtx, type GuardPi, policyFromEnv } from "../index.js";

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

describe("add-supervised-tool-approval: policy parsing + reasons (chat-gateway side)", () => {
  it("E5: a raw allow default from the env resolves to deny", () => {
    const env = { PI_EXT_CHAT_GATEWAY_GUARD_POLICY: '{"defaultAction":"allow"}' };
    expect(policyFromEnv(env)).toEqual({ defaultAction: "deny" });
  });

  it("E26: the ./guard entry rejects a raw allow default — an unlisted tool is blocked", async () => {
    const confirm = vi.fn(async () => true);
    const guard = createGuardViaGuardEntry({
      policy: { defaultAction: "allow" } as any,
    });
    const result = await guard({ toolName: "foo" }, ctxWithConfirm(confirm));
    expect(result).toEqual({ block: true, reason: "chat-gateway: denied_by_default" });
    expect(confirm).not.toHaveBeenCalled();
  });

  it("E25: exact match — the gateway guard does not case-fold (Bash is not bash)", async () => {
    const guard = createToolCallGuard({ policy: { allow: ["bash"] } });
    const result = await guard({ toolName: "Bash" }, ctxWithConfirm(vi.fn(async () => true)));
    expect(result).toEqual({ block: true, reason: "chat-gateway: denied_by_default" });
  });

  it("X6: confirm false, timeout and a throwing confirm all yield the one chat-gateway reason", async () => {
    const expected = { block: true, reason: "chat-gateway: approval_denied_or_timed_out" };
    const denied = createToolCallGuard({ policy: { approval: ["bash"] } });
    expect(await denied({ toolName: "bash" }, ctxWithConfirm(async () => false))).toEqual(expected);

    const timedOut = createToolCallGuard({
      policy: { approval: ["bash"] },
      schedule: (fn) => {
        fn();
        return 1;
      },
      cancel: () => {},
    });
    expect(await timedOut({ toolName: "bash" }, ctxWithConfirm(() => new Promise<boolean>(() => {})))).toEqual(
      expected,
    );

    const throws = createToolCallGuard({ policy: { approval: ["bash"] } });
    expect(
      await throws(
        { toolName: "bash" },
        ctxWithConfirm(() => {
          throw new Error("sync throw");
        }),
      ),
    ).toEqual(expected);
  });

  it("X9 (gateway side): approval:[bash] → exactly one confirm; allow:[bash] → zero prompts", async () => {
    const approvalConfirm = vi.fn(async () => true);
    const approval = createToolCallGuard({ policy: { approval: ["bash"] } });
    expect(await approval({ toolName: "bash" }, ctxWithConfirm(approvalConfirm))).toBeUndefined();
    expect(approvalConfirm).toHaveBeenCalledTimes(1);

    const allowConfirm = vi.fn(async () => true);
    const allow = createToolCallGuard({ policy: { allow: ["bash"] } });
    expect(await allow({ toolName: "bash" }, ctxWithConfirm(allowConfirm))).toBeUndefined();
    expect(allowConfirm).not.toHaveBeenCalled();
  });
});

describe("owner lifecycle (E28)", () => {
  function fakePi() {
    const handlers = new Map<string, (event: unknown, ctx: GuardCtx) => unknown>();
    const pi = {
      on: (event: string, handler: (event: unknown, ctx: GuardCtx) => unknown) => void handlers.set(event, handler),
    } as unknown as GuardPi;
    const ctxFor = (id: string): GuardCtx => ({ ...ctxWithConfirm(async () => true), sessionManager: { getSessionId: () => id } });
    return { pi, fire: (event: string, id: string) => handlers.get(event)?.({}, ctxFor(id)), handlers };
  }

  it("E28: not marked at registration; marked on session_start; cleared on session_shutdown; per session id", () => {
    const { pi, fire, handlers } = fakePi();
    chatGatewayGuard(pi, { policy: { allow: ["read"] } });
    expect([...handlers.keys()].sort()).toEqual(["session_shutdown", "session_start", "tool_call"]);
    expect(toolGateOwner("s1")).toBeUndefined();

    fire("session_start", "s1");
    expect(toolGateOwner("s1")).toBe("chat-gateway");

    fire("session_shutdown", "s1");
    expect(toolGateOwner("s1")).toBeUndefined();

    fire("session_start", "s2");
    expect(toolGateOwner("s2")).toBe("chat-gateway");
    expect(toolGateOwner("s1")).toBeUndefined();
    fire("session_shutdown", "s2");
  });
});
