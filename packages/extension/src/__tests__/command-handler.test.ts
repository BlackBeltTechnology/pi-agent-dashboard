import { describe, it, expect, vi } from "vitest";
import { createCommandHandler, parseSendPrompt } from "../command-handler.js";
import type { ServerToExtensionMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";

// Mock the tool registry so `!`/`!!` bash resolution is deterministic
// across hosts. `bashMock` is mutated per-test to simulate found / missing.
// See change: register-bash-and-tool-install-help.
const registryMock = vi.hoisted(() => ({
  bash: { ok: true, path: "/usr/bin/bash" } as { ok: boolean; path: string | null },
}));
vi.mock("@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js", () => ({
  getDefaultRegistry: () => ({
    resolve: (name: string) =>
      name === "bash"
        ? {
            name: "bash",
            ok: registryMock.bash.ok,
            path: registryMock.bash.path,
            source: registryMock.bash.ok ? "system" : null,
            tried: [],
            resolvedAt: 0,
          }
        : { name, ok: false, path: null, source: null, tried: [], resolvedAt: 0 },
  }),
}));

describe("CommandHandler", () => {
  function createMockPi() {
    return {
      sendUserMessage: vi.fn(),
      getCommands: vi.fn().mockReturnValue([
        { name: "test", description: "Test cmd", source: "extension" as const },
      ]),
      setSessionName: vi.fn(),
      getSessionName: vi.fn(),
      on: vi.fn(),
      exec: vi.fn(),
    };
  }

  it("should call sendUserMessage on send_prompt when idle", async () => {
    const pi = createMockPi();
    const handler = createCommandHandler(pi as any, "s1");

    const msg: ServerToExtensionMessage = {
      type: "send_prompt",
      sessionId: "s1",
      text: "Hello agent",
    };

    await handler.handle(msg);

    expect(pi.sendUserMessage).toHaveBeenCalledWith("Hello agent", { deliverAs: "followUp" });
  });

  it("should ignore messages for different sessionIds", async () => {
    const pi = createMockPi();
    const handler = createCommandHandler(pi as any, "s1");

    const msg: ServerToExtensionMessage = {
      type: "send_prompt",
      sessionId: "s2",
      text: "Hello",
    };

    await handler.handle(msg);
    expect(pi.sendUserMessage).not.toHaveBeenCalled();
  });

  it("should send images with valid mimeType via sendUserMessage", async () => {
    const pi = createMockPi();
    const handler = createCommandHandler(pi as any, "s1");

    await handler.handle({
      type: "send_prompt",
      sessionId: "s1",
      text: "check this",
      images: [
        { type: "image", data: "abc123", mimeType: "image/png" },
      ],
    });

    expect(pi.sendUserMessage).toHaveBeenCalledWith([
      { type: "text", text: "check this" },
      { type: "image", data: "abc123", mimeType: "image/png" },
    ], { deliverAs: "followUp" });
  });

  it("should drop images with invalid mimeType and send text only", async () => {
    const pi = createMockPi();
    const handler = createCommandHandler(pi as any, "s1");

    await handler.handle({
      type: "send_prompt",
      sessionId: "s1",
      text: "check this",
      images: [
        { type: "image", data: "abc123", mimeType: "image/bmp" },
      ],
    });

    // Invalid mimeType → dropped, sends text only
    expect(pi.sendUserMessage).toHaveBeenCalledWith("check this", { deliverAs: "followUp" });
  });

  it("should drop images with undefined or null mimeType", async () => {
    const pi = createMockPi();
    const handler = createCommandHandler(pi as any, "s1");

    await handler.handle({
      type: "send_prompt",
      sessionId: "s1",
      text: "check this",
      images: [
        { type: "image", data: "abc123", mimeType: undefined as any },
        { type: "image", data: "abc123", mimeType: null as any },
      ],
    });

    expect(pi.sendUserMessage).toHaveBeenCalledWith("check this", { deliverAs: "followUp" });
  });

  it("should drop images with empty or non-string data", async () => {
    const pi = createMockPi();
    const handler = createCommandHandler(pi as any, "s1");

    await handler.handle({
      type: "send_prompt",
      sessionId: "s1",
      text: "check this",
      images: [
        { type: "image", data: "", mimeType: "image/png" },
      ],
    });

    expect(pi.sendUserMessage).toHaveBeenCalledWith("check this", { deliverAs: "followUp" });
  });

  it("should drop non-object image entries", async () => {
    const pi = createMockPi();
    const handler = createCommandHandler(pi as any, "s1");

    await handler.handle({
      type: "send_prompt",
      sessionId: "s1",
      text: "check this",
      images: [null as any, "bad" as any],
    });

    expect(pi.sendUserMessage).toHaveBeenCalledWith("check this", { deliverAs: "followUp" });
  });

  it("should keep valid images and drop invalid ones", async () => {
    const pi = createMockPi();
    const handler = createCommandHandler(pi as any, "s1");

    await handler.handle({
      type: "send_prompt",
      sessionId: "s1",
      text: "check this",
      images: [
        { type: "image", data: "good", mimeType: "image/jpeg" },
        { type: "image", data: "bad", mimeType: "image/bmp" },
        { type: "image", data: "also-good", mimeType: "image/webp" },
      ],
    });

    expect(pi.sendUserMessage).toHaveBeenCalledWith([
      { type: "text", text: "check this" },
      { type: "image", data: "good", mimeType: "image/jpeg" },
      { type: "image", data: "also-good", mimeType: "image/webp" },
    ], { deliverAs: "followUp" });
  });

  it("should handle rename_session by calling setSessionName and returning confirmation", async () => {
    const pi = createMockPi();
    const handler = createCommandHandler(pi as any, "s1");

    const result = await handler.handle({
      type: "rename_session",
      sessionId: "s1",
      name: "My New Name",
    });

    expect(pi.setSessionName).toHaveBeenCalledWith("My New Name");
    expect(result).toEqual({
      type: "session_name_update",
      sessionId: "s1",
      name: "My New Name",
    });
  });

  it("should call shutdown option when shutdown message received", async () => {
    const pi = createMockPi();
    const shutdown = vi.fn();
    const handler = createCommandHandler(pi as any, "s1", { shutdown });

    await handler.handle({ type: "shutdown", sessionId: "s1" } as ServerToExtensionMessage);
    expect(shutdown).toHaveBeenCalled();
  });

  it("should not crash when shutdown called without option", async () => {
    const pi = createMockPi();
    const handler = createCommandHandler(pi as any, "s1");

    // Should not throw
    await handler.handle({ type: "shutdown", sessionId: "s1" } as ServerToExtensionMessage);
  });

  it("should call abort option when abort message received", async () => {
    const pi = createMockPi();
    const abort = vi.fn();
    const handler = createCommandHandler(pi as any, "s1", { abort });

    await handler.handle({ type: "abort", sessionId: "s1" } as ServerToExtensionMessage);
    expect(abort).toHaveBeenCalled();
  });

  it("should not crash when abort called without option", async () => {
    const pi = createMockPi();
    const handler = createCommandHandler(pi as any, "s1");

    // Should not throw
    await handler.handle({ type: "abort", sessionId: "s1" } as ServerToExtensionMessage);
  });

  it("abort schedules persistent-abort retries (rawAbort) until isIdle returns true", async () => {
    // Persistent-abort scheduler uses rawAbort (not the full wrapper) for
    // repeated 200ms ticks. See change:
    // unify-status-banner-and-terminal-limit-stop.
    vi.useFakeTimers();
    const pi = createMockPi();
    const abort = vi.fn();
    const rawAbort = vi.fn();
    let idleAfter = 3; // become idle after 3 polls
    const isIdle = vi.fn(() => --idleAfter <= 0);
    const isStreaming = vi.fn(() => true); // stays streaming, only isIdle gates
    const handler = createCommandHandler(pi as any, "s1", { abort, rawAbort, isIdle, isStreaming, eventSink: vi.fn() });

    await handler.handle({ type: "abort", sessionId: "s1" } as ServerToExtensionMessage);
    expect(abort).toHaveBeenCalledOnce();   // wrapper-abort: exactly once
    expect(rawAbort).not.toHaveBeenCalled(); // ticks haven't fired yet

    // Advance through the persistent-abort schedule. Each 200ms tick
    // checks streaming transition, then isIdle, then calls rawAbort.
    vi.advanceTimersByTime(200); // tick 1: idleAfter 3→2, rawAbort
    vi.advanceTimersByTime(200); // tick 2: idleAfter 2→1, rawAbort
    vi.advanceTimersByTime(200); // tick 3: idleAfter 1→0, isIdle true, no rawAbort, scheduler stops
    vi.advanceTimersByTime(1000); // no more rawAborts

    expect(abort.mock.calls.length).toBe(1);     // wrapper still only once
    expect(rawAbort.mock.calls.length).toBe(2);  // 2 ticks before isIdle returned true
    vi.useRealTimers();
  });

  it("persistent-abort scheduler stops after 2 seconds even if never idle", async () => {
    vi.useFakeTimers();
    const pi = createMockPi();
    const abort = vi.fn();
    const rawAbort = vi.fn();
    const isIdle = vi.fn(() => false);            // never idle
    const isStreaming = vi.fn(() => true);        // stays streaming
    const handler = createCommandHandler(pi as any, "s1", { abort, rawAbort, isIdle, isStreaming, eventSink: vi.fn() });

    await handler.handle({ type: "abort", sessionId: "s1" } as ServerToExtensionMessage);

    vi.advanceTimersByTime(2500); // safely past 2s cap
    // Wrapper-abort: exactly once. Raw-abort: ~10 ticks (2000ms / 200ms).
    expect(abort.mock.calls.length).toBe(1);
    const rawCalls = rawAbort.mock.calls.length;
    expect(rawCalls).toBeGreaterThanOrEqual(9);
    expect(rawCalls).toBeLessThanOrEqual(10);

    // Past cap, no more calls
    const before = rawAbort.mock.calls.length;
    vi.advanceTimersByTime(1000);
    expect(rawAbort.mock.calls.length).toBe(before);
    vi.useRealTimers();
  });

  it("persistent-abort scheduler stops on isAgentStreaming true→false transition", async () => {
    // See change: unify-status-banner-and-terminal-limit-stop. Once pi's
    // agent_end has flipped streaming off, the scheduler must stop —
    // continuing would risk aborting a fresh user re-send.
    vi.useFakeTimers();
    const pi = createMockPi();
    const abort = vi.fn();
    const rawAbort = vi.fn();
    let streaming = true;
    const isStreaming = vi.fn(() => streaming);
    const isIdle = vi.fn(() => false); // isIdle never reports idle
    const handler = createCommandHandler(pi as any, "s1", { abort, rawAbort, isIdle, isStreaming, eventSink: vi.fn() });

    await handler.handle({ type: "abort", sessionId: "s1" } as ServerToExtensionMessage);
    expect(abort).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(200); // tick 1: still streaming, rawAbort fires
    vi.advanceTimersByTime(200); // tick 2: still streaming, rawAbort fires
    expect(rawAbort.mock.calls.length).toBe(2);

    // pi's agent_end flips streaming off
    streaming = false;

    vi.advanceTimersByTime(200); // tick 3: streaming transitioned, scheduler stops
    vi.advanceTimersByTime(2000); // no more rawAborts even past the 2s cap
    expect(rawAbort.mock.calls.length).toBe(2);
    vi.useRealTimers();
  });

  it("abort synthesizes auto_retry_end event without finalError after invoking abort callback", async () => {
    // The hardcoded "Aborted by user" finalError placeholder was removed.
    // The synth still fires (to clear retryState) but no longer sets
    // SessionState.lastError to a misleading string — the real provider
    // error surfaces via pi's subsequent agent_end / orderer synth.
    // See change: unify-status-banner-and-terminal-limit-stop.
    const pi = createMockPi();
    const calls: Array<{ name: string; arg?: unknown }> = [];
    const abort = vi.fn(() => calls.push({ name: "abort" }));
    const eventSink = vi.fn((m: unknown) => calls.push({ name: "eventSink", arg: m }));
    const handler = createCommandHandler(pi as any, "s1", { abort, eventSink });

    await handler.handle({ type: "abort", sessionId: "s1" } as ServerToExtensionMessage);

    expect(abort).toHaveBeenCalledOnce();
    expect(eventSink).toHaveBeenCalledOnce();
    // Order: abort() first, then synthesized event
    expect(calls[0]!.name).toBe("abort");
    expect(calls[1]!.name).toBe("eventSink");
    const evt = (calls[1]!.arg as any);
    expect(evt.type).toBe("event_forward");
    expect(evt.sessionId).toBe("s1");
    expect(evt.event.eventType).toBe("auto_retry_end");
    expect(evt.event.data).toEqual({ success: false, attempt: -1 });
    expect(evt.event.data.finalError).toBeUndefined();
    expect(typeof evt.event.timestamp).toBe("number");
  });

  it("should handle request_commands message", async () => {
    const pi = createMockPi();
    const handler = createCommandHandler(pi as any, "s1");

    const msg: ServerToExtensionMessage = {
      type: "request_commands",
      sessionId: "s1",
    };

    const result = await handler.handle(msg);
    expect(pi.getCommands).toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(result?.type).toBe("commands_list");
  });

  it("should send flows_list via eventSink on request_commands", async () => {
    const pi = createMockPi();
    (pi as any).events = {
      emit: vi.fn((event: string, probe: any) => {
        if (event === "flow:list-flows") {
          probe.flows = [{ name: "my-flow", description: "A flow", taskRequired: false }];
        }
      }),
    };
    const eventSink = vi.fn();
    const handler = createCommandHandler(pi as any, "s1", { eventSink });

    await handler.handle({ type: "request_commands", sessionId: "s1" });
    expect(eventSink).toHaveBeenCalledWith({
      type: "flows_list",
      sessionId: "s1",
      flows: [{ name: "my-flow", description: "A flow", taskRequired: false }],
    });
  });

  it("should send empty flows_list when pi-flows is not installed", async () => {
    const pi = createMockPi();
    // No events property — pi-flows not installed
    const eventSink = vi.fn();
    const handler = createCommandHandler(pi as any, "s1", { eventSink });

    await handler.handle({ type: "request_commands", sessionId: "s1" });
    expect(eventSink).toHaveBeenCalledWith({
      type: "flows_list",
      sessionId: "s1",
      flows: [],
    });
  });

  it("should filter hidden commands (starting with __) from commands list", async () => {
    const pi = createMockPi();
    pi.getCommands.mockReturnValue([
      { name: "test", description: "Test cmd", source: "extension" as const },
      { name: "__dashboard", source: "extension" as const },
      { name: "__internal", source: "extension" as const },
      { name: "review", description: "Review", source: "prompt" as const },
    ]);
    const handler = createCommandHandler(pi as any, "s1");

    const result = await handler.handle({ type: "request_commands", sessionId: "s1" });
    expect(result?.type).toBe("commands_list");
    const commands = (result as any).commands;
    expect(commands).toHaveLength(2);
    expect(commands.map((c: any) => c.name)).toEqual(["test", "review"]);
  });

  it("should handle list_sessions gracefully when SessionManager is unavailable", async () => {
    const pi = createMockPi();
    const handler = createCommandHandler(pi as any, "s1");

    const result = await handler.handle({
      type: "list_sessions",
      sessionId: "s1",
      cwd: "/some/path",
    } as any);

    // Should return empty array on import failure
    expect(result).toBeDefined();
    expect(result!.type).toBe("sessions_list");
    expect((result as any).sessions).toEqual([]);
  });

  it("should use sessionId getter for dynamic session ID", async () => {
    const pi = createMockPi();
    let currentId = "s1";
    const handler = createCommandHandler(pi as any, () => currentId);

    // Message for s1 should work
    await handler.handle({ type: "send_prompt", sessionId: "s1", text: "hello" });
    expect(pi.sendUserMessage).toHaveBeenCalledWith("hello", { deliverAs: "followUp" });

    pi.sendUserMessage.mockClear();

    // Change the session ID
    currentId = "s2";

    // Now message for s1 should be ignored
    await handler.handle({ type: "send_prompt", sessionId: "s1", text: "ignored" });
    expect(pi.sendUserMessage).not.toHaveBeenCalled();

    // And message for s2 should work
    await handler.handle({ type: "send_prompt", sessionId: "s2", text: "accepted" });
    expect(pi.sendUserMessage).toHaveBeenCalledWith("accepted", { deliverAs: "followUp" });
  });

  describe("command routing", () => {
    it("should route !!command as silent bash execution", async () => {
      const pi = createMockPi();
      const exec = vi.fn().mockResolvedValue({ stdout: "output", stderr: "", exitCode: 0 });
      (pi as any).exec = exec;
      const eventSink = vi.fn();
      const handler = createCommandHandler(pi as any, "s1", { eventSink });

      registryMock.bash = { ok: true, path: "/usr/bin/bash" };
      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "!!ls -la" });

      // Spawns the registry-resolved absolute path, not the literal "sh".
      expect(exec).toHaveBeenCalledWith("/usr/bin/bash", ["-c", "ls -la"], expect.objectContaining({ timeout: 30000 }));
      expect(pi.sendUserMessage).not.toHaveBeenCalled();
      expect(eventSink).toHaveBeenCalledWith(expect.objectContaining({
        type: "event_forward",
        event: expect.objectContaining({
          eventType: "bash_output",
          data: expect.objectContaining({ command: "ls -la", excludeFromContext: true }),
        }),
      }));
    });

    it("should route !command as bash execution + LLM send", async () => {
      const pi = createMockPi();
      const exec = vi.fn().mockResolvedValue({ stdout: "file.txt", stderr: "", exitCode: 0 });
      (pi as any).exec = exec;
      const eventSink = vi.fn();
      const handler = createCommandHandler(pi as any, "s1", { eventSink });

      registryMock.bash = { ok: true, path: "/usr/bin/bash" };
      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "!ls" });

      expect(exec).toHaveBeenCalledWith("/usr/bin/bash", ["-c", "ls"], expect.objectContaining({ timeout: 30000 }));
      expect(pi.sendUserMessage).toHaveBeenCalled();
      expect(eventSink).toHaveBeenCalledWith(expect.objectContaining({
        type: "event_forward",
        event: expect.objectContaining({
          eventType: "bash_output",
          data: expect.objectContaining({ command: "ls", excludeFromContext: false }),
        }),
      }));
    });

    it("emits a MissingToolError and never spawns when bash is unresolved", async () => {
      // See change: register-bash-and-tool-install-help (task 3.4).
      registryMock.bash = { ok: false, path: null };
      const pi = createMockPi();
      const exec = vi.fn();
      (pi as any).exec = exec;
      const eventSink = vi.fn();
      const handler = createCommandHandler(pi as any, "s1", { eventSink });

      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "!ls" });

      // Never attempts a spawn, never sends to the LLM.
      expect(exec).not.toHaveBeenCalled();
      expect(pi.sendUserMessage).not.toHaveBeenCalled();
      // Emits exactly one bash_output event carrying the missing-tool payload.
      const bashEvents = eventSink.mock.calls
        .map((c) => c[0] as any)
        .filter((m) => m?.event?.eventType === "bash_output");
      expect(bashEvents).toHaveLength(1);
      expect(bashEvents[0].event.data.missingTool).toEqual({ kind: "missing-tool", toolName: "bash" });
      registryMock.bash = { ok: true, path: "/usr/bin/bash" }; // reset
    });

    it("should fall through for empty bang commands", async () => {
      const pi = createMockPi();
      const handler = createCommandHandler(pi as any, "s1");

      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "!" });
      expect(pi.sendUserMessage).toHaveBeenCalledWith("!", { deliverAs: "followUp" });

      pi.sendUserMessage.mockClear();
      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "!!" });
      expect(pi.sendUserMessage).toHaveBeenCalledWith("!!", { deliverAs: "followUp" });
    });

    it("should route /compact to ctx.compact()", async () => {
      const pi = createMockPi();
      const compact = vi.fn();
      const eventSink = vi.fn();
      const handler = createCommandHandler(pi as any, "s1", { compact, eventSink });

      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "/compact" });

      expect(compact).toHaveBeenCalledWith({});
      expect(pi.sendUserMessage).not.toHaveBeenCalled();
      expect(eventSink).toHaveBeenCalledWith(expect.objectContaining({
        type: "event_forward",
        event: expect.objectContaining({
          eventType: "command_feedback",
          data: expect.objectContaining({ command: "/compact", status: "started" }),
        }),
      }));
    });

    it("should route /compact with custom instructions", async () => {
      const pi = createMockPi();
      const compact = vi.fn();
      const eventSink = vi.fn();
      const handler = createCommandHandler(pi as any, "s1", { compact, eventSink });

      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "/compact summarize only code" });

      expect(compact).toHaveBeenCalledWith({ customInstructions: "summarize only code" });
    });

    it("should send error feedback when compact fails", async () => {
      const pi = createMockPi();
      const compact = vi.fn().mockImplementation(() => { throw new Error("Already compacted"); });
      const eventSink = vi.fn();
      const handler = createCommandHandler(pi as any, "s1", { compact, eventSink });

      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "/compact" });

      expect(eventSink).toHaveBeenCalledWith(expect.objectContaining({
        type: "event_forward",
        event: expect.objectContaining({
          eventType: "command_feedback",
          data: expect.objectContaining({ command: "/compact", status: "error", message: "Already compacted" }),
        }),
      }));
    });

    it("should route /slash commands through sessionPrompt when available", async () => {
      const pi = createMockPi();
      const sessionPrompt = vi.fn();
      const handler = createCommandHandler(pi as any, "s1", { sessionPrompt });

      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "/some-command args" });

      expect(sessionPrompt).toHaveBeenCalledWith("/some-command args", undefined);
      expect(pi.sendUserMessage).not.toHaveBeenCalled();
    });

    it("should emit command_feedback for slash commands", async () => {
      const pi = createMockPi();
      const sessionPrompt = vi.fn();
      const eventSink = vi.fn();
      const handler = createCommandHandler(pi as any, "s1", { sessionPrompt, eventSink });

      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "/reload" });

      expect(eventSink).toHaveBeenCalledWith(expect.objectContaining({
        type: "event_forward",
        event: expect.objectContaining({
          eventType: "command_feedback",
          data: expect.objectContaining({ command: "/reload", status: "completed" }),
        }),
      }));
    });

    it("should NOT emit command_feedback for unrecognized slash commands (no sessionPrompt)", async () => {
      // Per fix-extension-slash-commands-in-dashboard, unrecognized slashes
      // (not extension commands, not bridge-handled) fall through to
      // sendUserMessage with NO command_feedback events. Only registered
      // extension commands emit started/{completed,error}.
      const pi = createMockPi();
      const eventSink = vi.fn();
      const handler = createCommandHandler(pi as any, "s1", { eventSink });

      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "/some-command" });

      // Slash fallback forwards delivery (default 'followUp'). See change: add-steering-message.
      expect(pi.sendUserMessage).toHaveBeenCalledWith("/some-command", { deliverAs: "followUp" });
      const feedbackCalls = eventSink.mock.calls.filter(
        (c) => (c[0] as any)?.event?.eventType === "command_feedback",
      );
      expect(feedbackCalls).toHaveLength(0);
    });

    it("should fallback to sendUserMessage when sessionPrompt is not available for slash commands", async () => {
      const pi = createMockPi();
      const handler = createCommandHandler(pi as any, "s1");

      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "/some-command args" });

      expect(pi.sendUserMessage).toHaveBeenCalledWith("/some-command args", { deliverAs: "followUp" });
    });

    it("should route /quit to shutdown", async () => {
      const pi = createMockPi();
      const shutdown = vi.fn();
      const handler = createCommandHandler(pi as any, "s1", { shutdown });

      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "/quit" });

      expect(shutdown).toHaveBeenCalled();
      expect(pi.sendUserMessage).not.toHaveBeenCalled();
    });

    it("should route /exit to shutdown", async () => {
      const pi = createMockPi();
      const shutdown = vi.fn();
      const handler = createCommandHandler(pi as any, "s1", { shutdown });

      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "/exit" });

      expect(shutdown).toHaveBeenCalled();
      expect(pi.sendUserMessage).not.toHaveBeenCalled();
    });

    it("should route /reload to reload callback", async () => {
      const pi = createMockPi();
      const reload = vi.fn();
      const eventSink = vi.fn();
      const handler = createCommandHandler(pi as any, "s1", { reload, eventSink });

      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "/reload" });

      expect(reload).toHaveBeenCalled();
      expect(pi.sendUserMessage).not.toHaveBeenCalled();
      expect(eventSink).toHaveBeenCalledWith(expect.objectContaining({
        type: "event_forward",
        event: expect.objectContaining({
          eventType: "command_feedback",
          data: expect.objectContaining({ command: "/reload", status: "completed" }),
        }),
      }));
    });

    it("should not crash when /reload called without option", async () => {
      const pi = createMockPi();
      const handler = createCommandHandler(pi as any, "s1");

      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "/reload" });
      expect(pi.sendUserMessage).not.toHaveBeenCalled();
    });

    it("should route /new to spawnNew callback", async () => {
      const pi = createMockPi();
      const spawnNew = vi.fn();
      const eventSink = vi.fn();
      const handler = createCommandHandler(pi as any, "s1", { spawnNew, eventSink });

      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "/new" });

      expect(spawnNew).toHaveBeenCalled();
      expect(pi.sendUserMessage).not.toHaveBeenCalled();
      expect(eventSink).toHaveBeenCalledWith(expect.objectContaining({
        type: "event_forward",
        event: expect.objectContaining({
          eventType: "command_feedback",
          data: expect.objectContaining({ command: "/new", status: "completed" }),
        }),
      }));
    });

    it("should pass plain text through to sendUserMessage", async () => {
      const pi = createMockPi();
      const handler = createCommandHandler(pi as any, "s1");

      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "explain this code" });

      expect(pi.sendUserMessage).toHaveBeenCalledWith("explain this code", { deliverAs: "followUp" });
    });

    it("should handle bash execution with non-zero exit code", async () => {
      const pi = createMockPi();
      const exec = vi.fn().mockResolvedValue({ stdout: "", stderr: "not found", exitCode: 127 });
      (pi as any).exec = exec;
      const eventSink = vi.fn();
      const handler = createCommandHandler(pi as any, "s1", { eventSink });

      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "!!badcmd" });

      expect(eventSink).toHaveBeenCalledWith(expect.objectContaining({
        type: "event_forward",
        event: expect.objectContaining({
          eventType: "bash_output",
          data: expect.objectContaining({ exitCode: 127, output: "not found" }),
        }),
      }));
    });
  });

  describe("set_model", () => {
    it("should call setModel with provider and modelId", async () => {
      const pi = createMockPi();
      const setModel = vi.fn().mockResolvedValue(undefined);
      const handler = createCommandHandler(pi as any, "s1", { setModel });

      await handler.handle({
        type: "set_model",
        sessionId: "s1",
        provider: "anthropic",
        modelId: "claude-sonnet-4-20250514",
      } as ServerToExtensionMessage);

      expect(setModel).toHaveBeenCalledWith("anthropic", "claude-sonnet-4-20250514");
    });

    it("should not throw when setModel option is not provided", async () => {
      const pi = createMockPi();
      const handler = createCommandHandler(pi as any, "s1");

      await expect(handler.handle({
        type: "set_model",
        sessionId: "s1",
        provider: "anthropic",
        modelId: "unknown-model",
      } as ServerToExtensionMessage)).resolves.toBeUndefined();
    });

    it("should route /model slash command through setModel callback", async () => {
      const pi = createMockPi();
      const setModel = vi.fn().mockResolvedValue(undefined);
      const eventSink = vi.fn();
      const handler = createCommandHandler(pi as any, "s1", { setModel, eventSink });

      await handler.handle({
        type: "send_prompt",
        sessionId: "s1",
        text: "/model anthropic/claude-haiku-4-5",
      });

      expect(setModel).toHaveBeenCalledWith("anthropic", "claude-haiku-4-5");
      expect(pi.sendUserMessage).not.toHaveBeenCalled();
      expect(eventSink).toHaveBeenCalledWith(expect.objectContaining({
        type: "event_forward",
        event: expect.objectContaining({
          eventType: "command_feedback",
          data: expect.objectContaining({ command: "/model anthropic/claude-haiku-4-5", status: "completed" }),
        }),
      }));
    });
  });
});

describe("parseSendPrompt", () => {
  it("should detect !! prefix (silent bash)", () => {
    const result = parseSendPrompt("!!ls -la");
    expect(result).toEqual({ type: "bash", command: "ls -la", excludeFromContext: true });
  });

  it("should detect ! prefix (bash with LLM)", () => {
    const result = parseSendPrompt("!git status");
    expect(result).toEqual({ type: "bash", command: "git status", excludeFromContext: false });
  });

  it("should return passthrough for empty !! ", () => {
    const result = parseSendPrompt("!!");
    expect(result).toEqual({ type: "passthrough", text: "!!" });
  });

  it("should return passthrough for empty !", () => {
    const result = parseSendPrompt("!");
    expect(result).toEqual({ type: "passthrough", text: "!" });
  });

  it("should detect /compact without args", () => {
    const result = parseSendPrompt("/compact");
    expect(result).toEqual({ type: "compact", customInstructions: undefined });
  });

  it("should detect /compact with args", () => {
    const result = parseSendPrompt("/compact focus on code changes");
    expect(result).toEqual({ type: "compact", customInstructions: "focus on code changes" });
  });

  it("should detect generic slash commands", () => {
    const result = parseSendPrompt("/some-command arg1 arg2");
    expect(result).toEqual({ type: "slash", text: "/some-command arg1 arg2" });
  });

  it("should return passthrough for plain text", () => {
    const result = parseSendPrompt("explain this code");
    expect(result).toEqual({ type: "passthrough", text: "explain this code" });
  });

  it("should return passthrough for text with / in the middle", () => {
    const result = parseSendPrompt("look at src/index.ts");
    expect(result).toEqual({ type: "passthrough", text: "look at src/index.ts" });
  });

  it("should trim bang command text", () => {
    const result = parseSendPrompt("!!  ls -la  ");
    expect(result).toEqual({ type: "bash", command: "ls -la", excludeFromContext: true });
  });

  it("should return passthrough for !! with only whitespace after", () => {
    const result = parseSendPrompt("!!   ");
    expect(result).toEqual({ type: "passthrough", text: "!!   " });
  });

  it("should detect /quit as shutdown", () => {
    expect(parseSendPrompt("/quit")).toEqual({ type: "shutdown" });
  });

  it("should detect /exit as shutdown", () => {
    expect(parseSendPrompt("/exit")).toEqual({ type: "shutdown" });
  });

  it("should detect /reload as reload", () => {
    expect(parseSendPrompt("/reload")).toEqual({ type: "reload" });
  });

  it("should detect /new as new", () => {
    expect(parseSendPrompt("/new")).toEqual({ type: "new" });
  });

  it("should detect /model provider/id as model command", () => {
    expect(parseSendPrompt("/model anthropic/claude-haiku-4-5")).toEqual({
      type: "model",
      provider: "anthropic",
      modelId: "claude-haiku-4-5",
    });
  });

  it("should treat /model without slash in arg as generic slash", () => {
    expect(parseSendPrompt("/model something")).toEqual({ type: "slash", text: "/model something" });
  });

  it("should treat bare /model as generic slash", () => {
    expect(parseSendPrompt("/model")).toEqual({ type: "slash", text: "/model" });
  });

  it("should detect /flows:new as generic slash (routed by bridge sessionPrompt)", () => {
    expect(parseSendPrompt("/flows:new create a test flow")).toEqual({
      type: "slash",
      text: "/flows:new create a test flow",
    });
  });

  it("should detect /flows:delete as generic slash (routed by session.prompt)", () => {
    expect(parseSendPrompt("/flows:delete my-flow")).toEqual({
      type: "slash",
      text: "/flows:delete my-flow",
    });
  });
});

describe("CommandHandler delivery routing (pi-native queues)", () => {
  // After change: honest-mid-turn-queue-surface, the bridge appends to pi's
  // queues via pi.sendUserMessage{deliverAs} only. clear*Queue stubs remain
  // on the mock so we can assert they are NEVER called (negative assertion
  // locking in the absence). Pi's real ExtensionAPI exposes no clear*Queue
  // method; the stubs here model the policy, not the surface.
  function createMockPi() {
    return {
      sendUserMessage: vi.fn(),
      getCommands: vi.fn().mockReturnValue([]),
      setSessionName: vi.fn(),
      getSessionName: vi.fn(),
      on: vi.fn(),
      exec: vi.fn(),
      clearFollowUpQueue: vi.fn(),
      clearSteeringQueue: vi.fn(),
    };
  }

  it("passthrough followUp on IDLE session forwards to pi (no buffer)", async () => {
    // Idle path (default when isStreaming option absent): pi sees the
    // message; the bridge buffer is bypassed entirely.
    // See change: rework-mid-turn-prompt-queue (design.md D1).
    const pi = createMockPi();
    const onFollowupSent = vi.fn();
    const handler = createCommandHandler(pi as any, "s1", { onFollowupSent });

    await handler.handle({ type: "send_prompt", sessionId: "s1", text: "after done", delivery: "followUp" });

    expect(pi.clearFollowUpQueue).not.toHaveBeenCalled();
    expect(pi.sendUserMessage).toHaveBeenCalledWith("after done", { deliverAs: "followUp" });
    expect(onFollowupSent).not.toHaveBeenCalled(); // buffer untouched on idle path
  });

  it("passthrough followUp while STREAMING buffers in bridge and skips pi.sendUserMessage", async () => {
    // Streaming path: the bridge owns the follow-up buffer; pi never sees
    // the entry until the drain loop ships it on agent_end as a fresh turn.
    // See change: rework-mid-turn-prompt-queue (design.md D1).
    const pi = createMockPi();
    const onFollowupSent = vi.fn();
    const handler = createCommandHandler(pi as any, "s1", {
      isStreaming: () => true,
      onFollowupSent,
    });

    await handler.handle({ type: "send_prompt", sessionId: "s1", text: "buffered", delivery: "followUp" });

    // CRITICAL: pi.sendUserMessage MUST NOT be called for the streaming
    // follow-up path — the entry lives only in the bridge buffer.
    expect(pi.sendUserMessage).not.toHaveBeenCalled();
    expect(pi.clearFollowUpQueue).not.toHaveBeenCalled();
    expect(pi.clearSteeringQueue).not.toHaveBeenCalled();
    // onFollowupSent (→ bufferFollowupSend) IS called so the bridge can push
    // the text to bridgeFollowUp + emit queue_update.
    expect(onFollowupSent).toHaveBeenCalledWith("buffered");
  });

  it("passthrough delivery absent defaults to followUp (idle path forwards to pi)", async () => {
    const pi = createMockPi();
    const handler = createCommandHandler(pi as any, "s1");

    await handler.handle({ type: "send_prompt", sessionId: "s1", text: "plain" });

    expect(pi.clearFollowUpQueue).not.toHaveBeenCalled();
    expect(pi.sendUserMessage).toHaveBeenCalledWith("plain", { deliverAs: "followUp" });
  });

  it("passthrough delivery steer does NOT call clearFollowUpQueue or clearSteeringQueue", async () => {
    const pi = createMockPi();
    const handler = createCommandHandler(pi as any, "s1");

    await handler.handle({ type: "send_prompt", sessionId: "s1", text: "focus on X", delivery: "steer" });

    expect(pi.clearFollowUpQueue).not.toHaveBeenCalled();
    expect(pi.clearSteeringQueue).not.toHaveBeenCalled();
    expect(pi.sendUserMessage).toHaveBeenCalledWith("focus on X", { deliverAs: "steer" });
  });

  it("passthrough with images preserves image content (v2: no pre-clear)", async () => {
    const pi = createMockPi();
    const images = [{ type: "image" as const, data: "AAA", mimeType: "image/png" }];
    const handler = createCommandHandler(pi as any, "s1");

    await handler.handle({ type: "send_prompt", sessionId: "s1", text: "img", images, delivery: "followUp" });

    expect(pi.clearFollowUpQueue).not.toHaveBeenCalled();
    expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);
    const [content, opts] = pi.sendUserMessage.mock.calls[0];
    expect(opts).toEqual({ deliverAs: "followUp" });
    expect(Array.isArray(content)).toBe(true);
  });

  it("bash commands bypass delivery routing entirely (no clearFollowUpQueue call)", async () => {
    const pi = createMockPi();
    pi.exec = vi.fn().mockResolvedValue({ stdout: "hi", stderr: "", exitCode: 0 });
    const handler = createCommandHandler(pi as any, "s1");

    await handler.handle({ type: "send_prompt", sessionId: "s1", text: "!ls" });

    // Bash handler forwards stdout via sendUserMessage as its result, but
    // delivery routing is not involved — no clearFollowUpQueue or deliverAs option.
    expect(pi.clearFollowUpQueue).not.toHaveBeenCalled();
    expect(pi.clearSteeringQueue).not.toHaveBeenCalled();
  });

  it("slash command with delivery=steer passes delivery to sessionPrompt; no pi call from handler", async () => {
    const pi = createMockPi();
    const sessionPrompt = vi.fn();
    const handler = createCommandHandler(pi as any, "s1", { sessionPrompt });

    await handler.handle({ type: "send_prompt", sessionId: "s1", text: "/some-command args", delivery: "steer" });

    expect(sessionPrompt).toHaveBeenCalledWith("/some-command args", "steer");
    expect(pi.sendUserMessage).not.toHaveBeenCalled();
  });

  it("abort no longer requires clearQueueOnAbort option", async () => {
    const pi = createMockPi();
    const abort = vi.fn();
    const handler = createCommandHandler(pi as any, "s1", { abort });

    await handler.handle({ type: "abort", sessionId: "s1" });

    expect(abort).toHaveBeenCalledTimes(1);
  });

  // attach_proposal_changed → onAttachProposalChanged mirror (task 3.4).
  // See change: inject-session-context-into-agent.
  describe("attach_proposal_changed", () => {
    it("matching sessionId → calls onAttachProposalChanged with the value", async () => {
      const pi = createMockPi();
      const onAttachProposalChanged = vi.fn();
      const handler = createCommandHandler(pi as any, "s1", { onAttachProposalChanged });

      await handler.handle({ type: "attach_proposal_changed", sessionId: "s1", attachedChange: "X" });

      expect(onAttachProposalChanged).toHaveBeenCalledWith("X");
    });

    it("null payload → clears (calls with null)", async () => {
      const pi = createMockPi();
      const onAttachProposalChanged = vi.fn();
      const handler = createCommandHandler(pi as any, "s1", { onAttachProposalChanged });

      await handler.handle({ type: "attach_proposal_changed", sessionId: "s1", attachedChange: null });

      expect(onAttachProposalChanged).toHaveBeenCalledWith(null);
    });

    it("mismatched sessionId → dropped by the guard, callback untouched", async () => {
      const pi = createMockPi();
      const onAttachProposalChanged = vi.fn();
      const handler = createCommandHandler(pi as any, "s1", { onAttachProposalChanged });

      await handler.handle({ type: "attach_proposal_changed", sessionId: "s2", attachedChange: "X" });

      expect(onAttachProposalChanged).not.toHaveBeenCalled();
    });

    it("malformed attachedChange (non-string, non-null) → dropped, callback untouched", async () => {
      const pi = createMockPi();
      const onAttachProposalChanged = vi.fn();
      const handler = createCommandHandler(pi as any, "s1", { onAttachProposalChanged });

      await handler.handle({ type: "attach_proposal_changed", sessionId: "s1", attachedChange: 123 as any });

      expect(onAttachProposalChanged).not.toHaveBeenCalled();
    });
  });
});
