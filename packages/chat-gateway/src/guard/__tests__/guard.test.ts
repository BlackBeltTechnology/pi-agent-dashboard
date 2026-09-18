/**
 * L3 guard handler tests — the hard `{block:true}` gate, the chat approval
 * escalation, and the FAIL-CLOSED timeout (C3).
 *
 * See change: add-chat-gateway.
 */
import { describe, expect, it, vi } from "vitest";
import { createToolCallGuard } from "../index.js";

function ctxWithConfirm(confirm: (title: string, message?: string) => Promise<boolean>) {
  return { ui: { confirm, notify: vi.fn() } };
}

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
