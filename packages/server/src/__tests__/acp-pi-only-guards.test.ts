/**
 * pi-only browser ops are refused for ACP sessions (typed unsupported_for_acp)
 * and still forwarded for pi sessions. See change: add-acp-session-driver
 * (test-plan #E43).
 */
import { describe, expect, it, vi } from "vitest";
import { type AcpGuardContext, guardAcpBrowserMessage, UNSUPPORTED_FOR_ACP } from "../browser-handlers/acp-guard.js";

const OPS: Array<Record<string, unknown>> = [
  { type: "flow_control", action: "abort" },
  { type: "flow_management", action: "x" },
  { type: "architect_prompt_response", answer: "x" },
  { type: "retry_session" },
  { type: "stop_after_turn" },
  { type: "role_set", role: "r", modelId: "m" },
  { type: "role_preset_load", name: "p" },
  { type: "role_preset_save", name: "p" },
  { type: "role_preset_delete", name: "p" },
  { type: "role_remove", role: "r" },
  { type: "request_roles" },
  { type: "ui_management", action: "list", event: "e" },
  { type: "open_inline_terminal", cwd: "/" },
  { type: "list_files", query: "q" },
  { type: "kill_process", pgid: 1 },
  { type: "subagent_resync_request", agentId: "a" },
];

function ctxFor(driver: "acp" | undefined) {
  const feedback = vi.fn();
  const ctx = { sessionManager: { get: (id: string) => (id === "S" ? { id: "S", driver } : undefined) }, feedback } as unknown as AcpGuardContext;
  return { feedback, ctx };
}

describe("guardAcpBrowserMessage", () => {
  for (const op of OPS) {
    it(`E43: ${String(op.type)} → refused for ACP, passes for pi`, () => {
      const acp = ctxFor("acp");
      expect(guardAcpBrowserMessage({ ...op, sessionId: "S" } as never, acp.ctx)).toBe(true);
      expect(acp.feedback).toHaveBeenCalledTimes(1);
      expect(acp.feedback.mock.calls[0]?.[1]).toContain(UNSUPPORTED_FOR_ACP);
      expect(acp.feedback.mock.calls[0]?.[2]).toBe(op.type);

      const pi = ctxFor(undefined);
      expect(guardAcpBrowserMessage({ ...op, sessionId: "S" } as never, pi.ctx)).toBe(false);
      expect(pi.feedback).not.toHaveBeenCalled();
    });
  }

  it("supported ops (send_prompt, abort, set_model, queue edits, prompt_response) are never refused", () => {
    const { ctx, feedback } = ctxFor("acp");
    for (const type of ["send_prompt", "abort", "set_model", "set_thinking_level", "edit_followup_entry", "prompt_response", "request_commands", "shutdown", "force_kill"]) {
      expect(guardAcpBrowserMessage({ type, sessionId: "S" } as never, ctx), type).toBe(false);
    }
    expect(feedback).not.toHaveBeenCalled();
  });

  it("unknown sessions and session-less frames are not refused", () => {
    const { ctx } = ctxFor("acp");
    expect(guardAcpBrowserMessage({ type: "flow_control", sessionId: "ghost", action: "abort" } as never, ctx)).toBe(false);
    expect(guardAcpBrowserMessage({ type: "flow_control" } as never, ctx)).toBe(false);
  });
});
