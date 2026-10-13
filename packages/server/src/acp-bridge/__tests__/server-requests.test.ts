/**
 * Server → bridge message coverage. See change: add-acp-session-driver (test-plan #E26).
 */
import type { ServerToExtensionMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import { describe, expect, it, vi } from "vitest";
import { handleServerMessage, type ServerRequestContext } from "../server-requests.js";

function ctx() {
  const send = vi.fn();
  const c = {
    sessionId: "s",
    send,
    sendPrompt: vi.fn(),
    abort: vi.fn(),
    setModel: vi.fn(),
    setThinkingLevel: vi.fn(),
    promptResponse: vi.fn(),
    clearFollowups: vi.fn(),
    editFollowup: vi.fn(),
    removeFollowup: vi.fn(),
    promoteFollowup: vi.fn(),
    resyncState: vi.fn(),
    publishModels: vi.fn(),
    publishCommands: vi.fn(),
    resyncPrompts: vi.fn(),
    stop: vi.fn(),
    ignored: vi.fn(),
  } satisfies ServerRequestContext;
  return c;
}
const m = (x: Record<string, unknown>) => ({ sessionId: "s", ...x }) as unknown as ServerToExtensionMessage;

describe("handleServerMessage", () => {
  it("E26: reply-expecting messages get deterministic empty / refused replies", () => {
    const c = ctx();
    handleServerMessage(m({ type: "list_files", query: "q" }), c);
    expect(c.send).toHaveBeenLastCalledWith({ type: "files_list", sessionId: "s", query: "q", files: [] });
    handleServerMessage(m({ type: "transcript_request" }), c);
    expect(c.send).toHaveBeenLastCalledWith(expect.objectContaining({ type: "transcript_chunk", entries: [], complete: true, refused: expect.objectContaining({ cause: "acp" }) }));
    handleServerMessage(m({ type: "request_providers" }), c);
    expect(c.send).toHaveBeenLastCalledWith({ type: "providers_list", sessionId: "s", providers: [] });
    handleServerMessage(m({ type: "git_commit_draft", requestId: "r", cwd: "/", files: [] }), c);
    expect(c.send).toHaveBeenLastCalledWith(expect.objectContaining({ type: "git_commit_draft_result", requestId: "r", source: "stub" }));
  });

  it("supported messages hit their handlers", () => {
    const c = ctx();
    handleServerMessage(m({ type: "send_prompt", text: "x" }), c);
    handleServerMessage(m({ type: "abort" }), c);
    handleServerMessage(m({ type: "set_model", provider: "acp:q", modelId: "a" }), c);
    handleServerMessage(m({ type: "set_thinking_level", level: "high" }), c);
    handleServerMessage(m({ type: "edit_followup_entry", index: 1, text: "t" }), c);
    handleServerMessage(m({ type: "clear_followup_entries", indices: "all" }), c);
    handleServerMessage(m({ type: "request_state_sync" }), c);
    handleServerMessage(m({ type: "prompt_resync_request", requestId: "q" }), c);
    handleServerMessage(m({ type: "shutdown" }), c);
    handleServerMessage(m({ type: "register_rejected", reason: "dup" }), c);
    expect(c.sendPrompt).toHaveBeenCalled();
    expect(c.abort).toHaveBeenCalled();
    expect(c.setModel).toHaveBeenCalledWith("acp:q", "a");
    expect(c.setThinkingLevel).toHaveBeenCalledWith("high");
    expect(c.editFollowup).toHaveBeenCalledWith(1, "t");
    expect(c.clearFollowups).toHaveBeenCalledWith("all");
    expect(c.resyncState).toHaveBeenCalled();
    expect(c.resyncPrompts).toHaveBeenCalledWith("q");
    expect(c.stop).toHaveBeenNthCalledWith(1, expect.any(String), 0);
    expect(c.stop).toHaveBeenNthCalledWith(2, expect.stringContaining("dup"), 1);
  });

  it("pi-only and housekeeping messages are ignored; an unknown one does not throw", () => {
    const c = ctx();
    for (const type of ["flow_control", "role_set", "kill_process", "heartbeat_ack", "plugin_reply", "stop_after_turn", "retry_session"]) {
      handleServerMessage(m({ type }), c);
    }
    expect(c.ignored).toHaveBeenCalledTimes(7);
    expect(() => handleServerMessage(m({ type: "brand_new_member" }), c)).not.toThrow();
    expect(c.send).not.toHaveBeenCalled();
  });
});
