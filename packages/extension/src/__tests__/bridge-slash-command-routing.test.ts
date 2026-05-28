/**
 * Regression test pinning the slash-command routing contract.
 * Drives `command-handler.handle({type:"send_prompt"...})` against a stub pi
 * and asserts the call counts + emitted command_feedback events from
 * `design.md` Decision 5 table.
 *
 * regression: see openspec/changes/fix-extension-slash-commands-in-dashboard/
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createCommandHandler } from "../command-handler.js";
import { hasDispatchCommand } from "../bridge-context.js";
import { tryDispatchExtensionCommand, type DispatchConnection } from "../slash-dispatch.js";
import type { ExtensionToServerMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";

interface StubOpts {
  withDispatch?: boolean;
  dispatchRejects?: Error;
  getCommandsThrows?: boolean;
  commands?: Array<{ name: string; source: string }>;
}

function makeStubPi(opts: StubOpts = {}) {
  const dispatchCommand = opts.withDispatch
    ? vi.fn(async (_text: string, _options?: any) => {
        if (opts.dispatchRejects) throw opts.dispatchRejects;
      })
    : undefined;
  const sendUserMessage = vi.fn();
  const setSessionName = vi.fn();
  const events = { emit: vi.fn() };
  const getCommands = vi.fn(() => {
    if (opts.getCommandsThrows) throw new Error("stale ctx");
    return opts.commands ?? [
      { name: "ctx-stats", source: "extension" },
      { name: "skill:foo", source: "skill" },
      { name: "review", source: "prompt" },
      { name: "__dashboard_reload", source: "extension" },
    ];
  });
  const pi: any = {
    sendUserMessage,
    getCommands,
    setSessionName,
    events,
  };
  if (dispatchCommand) pi.dispatchCommand = dispatchCommand;
  return { pi, sendUserMessage, dispatchCommand, getCommands, events };
}

function feedbackEvents(sink: ReturnType<typeof vi.fn>, command: string) {
  return sink.mock.calls
    .map((c) => c[0] as ExtensionToServerMessage)
    .filter(
      (m) =>
        m.type === "event_forward" &&
        (m as any).event?.eventType === "command_feedback" &&
        ((m as any).event?.data?.command === command),
    )
    .map((m) => (m as any).event.data);
}

async function drive(text: string, stub: ReturnType<typeof makeStubPi>, delivery?: "steer" | "followUp") {
  const sink = vi.fn();
  const handler = createCommandHandler(stub.pi as any, "s1", { eventSink: sink });
  await handler.handle({ type: "send_prompt", sessionId: "s1", text, delivery } as any);
  return sink;
}

describe("bridge slash command routing (regression contract)", () => {
  it("extension cmd with dispatchCommand → dispatch called, no sendUserMessage, started+completed", async () => {
    // regression: see openspec/changes/fix-extension-slash-commands-in-dashboard/
    const stub = makeStubPi({ withDispatch: true });
    const sink = await drive("/ctx-stats", stub);

    expect(stub.dispatchCommand).toHaveBeenCalledTimes(1);
    expect(stub.dispatchCommand).toHaveBeenCalledWith("/ctx-stats", { streamingBehavior: "followUp" });
    expect(stub.sendUserMessage).not.toHaveBeenCalled();

    const evs = feedbackEvents(sink, "/ctx-stats");
    expect(evs.map((e) => e.status)).toEqual(["started", "completed"]);
  });

  it("extension cmd with delivery: steer → dispatchCommand called with streamingBehavior: steer", async () => {
    const stub = makeStubPi({ withDispatch: true });
    const sink = await drive("/ctx-stats", stub, "steer");

    expect(stub.dispatchCommand).toHaveBeenCalledTimes(1);
    expect(stub.dispatchCommand).toHaveBeenCalledWith("/ctx-stats", { streamingBehavior: "steer" });
    expect(stub.sendUserMessage).not.toHaveBeenCalled();

    const evs = feedbackEvents(sink, "/ctx-stats");
    expect(evs.map((e) => e.status)).toEqual(["started", "completed"]);
  });

  it("extension cmd, NO dispatchCommand, not headless → error feedback with session-shape hint, no sendUserMessage", async () => {
    // Path D: extension commands cannot be dispatched for non-headless sessions.
    // Emits error with hint explaining tmux / wt own pi's stdin.
    // See change: fix-slash-dispatch-delivery, enable-rpc-keeper-by-default.
    const stub = makeStubPi({ withDispatch: false });
    const sink = await drive("/ctx-stats", stub);

    // sendUserMessage is NOT called — the command is handled (with error).
    expect(stub.sendUserMessage).not.toHaveBeenCalled();

    // Error feedback emitted with session-shape hint.
    const evs = feedbackEvents(sink, "/ctx-stats");
    expect(evs.map((e) => e.status)).toEqual(["error"]);
    expect(evs[0].message).toContain("session shape");
  });

  it("extension cmd dispatch rejects → started+error with err.message, no sendUserMessage", async () => {
    const stub = makeStubPi({ withDispatch: true, dispatchRejects: new Error("boom") });
    const sink = await drive("/ctx-stats", stub);

    expect(stub.dispatchCommand).toHaveBeenCalledTimes(1);
    expect(stub.sendUserMessage).not.toHaveBeenCalled();

    const evs = feedbackEvents(sink, "/ctx-stats");
    expect(evs.map((e) => e.status)).toEqual(["started", "error"]);
    expect(evs[1].message).toBe("boom");
  });

  it("skill command → no dispatch, sendUserMessage called once, no command_feedback", async () => {
    const stub = makeStubPi({ withDispatch: true });
    const sink = await drive("/skill:foo", stub);

    expect(stub.dispatchCommand).not.toHaveBeenCalled();
    expect(stub.sendUserMessage).toHaveBeenCalledTimes(1);

    expect(feedbackEvents(sink, "/skill:foo")).toEqual([]);
  });

  it("prompt template → no dispatch, sendUserMessage called once, no command_feedback", async () => {
    const stub = makeStubPi({ withDispatch: true });
    const sink = await drive("/review", stub);

    expect(stub.dispatchCommand).not.toHaveBeenCalled();
    expect(stub.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(feedbackEvents(sink, "/review")).toEqual([]);
  });

  it("passthrough text → no dispatch, sendUserMessage called once, no command_feedback", async () => {
    const stub = makeStubPi({ withDispatch: true });
    const sink = await drive("hello world", stub);

    expect(stub.dispatchCommand).not.toHaveBeenCalled();
    expect(stub.sendUserMessage).toHaveBeenCalledTimes(1);
  });

  it("unrecognized slash → no dispatch, sendUserMessage called once, no command_feedback", async () => {
    const stub = makeStubPi({ withDispatch: true });
    const sink = await drive("/totally-unknown-command", stub);

    expect(stub.dispatchCommand).not.toHaveBeenCalled();
    expect(stub.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(feedbackEvents(sink, "/totally-unknown-command")).toEqual([]);
  });

  it("bridge-native /__dashboard_reload → no dispatch, no error feedback, sendUserMessage fallback", async () => {
    const stub = makeStubPi({ withDispatch: true });
    const sink = await drive("/__dashboard_reload", stub);

    expect(stub.dispatchCommand).not.toHaveBeenCalled();
    // It IS in the command list with source: extension, but DASHBOARD_NATIVE_COMMANDS
    // / __-prefix exclusion suppresses it. The slash branch falls through to sendUserMessage.
    expect(stub.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(feedbackEvents(sink, "/__dashboard_reload")).toEqual([]);
  });

  it("getCommands throws → no crash, no command_feedback, sendUserMessage fallback fires", async () => {
    const stub = makeStubPi({ withDispatch: true, getCommandsThrows: true });
    const sink = await drive("/ctx-stats", stub);

    expect(stub.dispatchCommand).not.toHaveBeenCalled();
    // helper returns false on throw → caller falls through to sendUserMessage path
    expect(stub.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(feedbackEvents(sink, "/ctx-stats")).toEqual([]);
  });

  it("never duplicates command_feedback on dispatch path (success)", async () => {
    const stub = makeStubPi({ withDispatch: true });
    const sink = await drive("/ctx-stats", stub);
    const evs = feedbackEvents(sink, "/ctx-stats");
    expect(evs.filter((e) => e.status === "started")).toHaveLength(1);
    expect(evs.filter((e) => e.status === "completed" || e.status === "error")).toHaveLength(1);
  });

  it("error feedback on fallthrough path (dispatchCommand absent, non-headless)", async () => {
    // Path D returns true with error feedback (including rpc-keeper hint).
    // See change: fix-slash-dispatch-delivery.
    const stub = makeStubPi({ withDispatch: false });
    const sink = await drive("/ctx-stats", stub);
    const evs = feedbackEvents(sink, "/ctx-stats");
    expect(evs).toHaveLength(1);
    expect(evs[0].status).toBe("error");
    expect(evs[0].message).toContain("session shape");
  });

  it("anti-regression: /ctx-stats does NOT reach sendUserMessage when dispatchCommand absent", async () => {
    // Path D now emits error feedback instead of falling through silently.
    // Extension commands can only be dispatched for headless sessions with
    // the RPC keeper enabled. See change: fix-slash-dispatch-delivery.
    const stub = makeStubPi({ withDispatch: false });
    const sink = await drive("/ctx-stats", stub);
    // sendUserMessage is NOT called — command handled with error feedback.
    expect(stub.sendUserMessage).not.toHaveBeenCalled();
    const evs = feedbackEvents(sink, "/ctx-stats");
    expect(evs).toHaveLength(1);
    expect(evs[0].status).toBe("error");
  });
});

// See change: add-rpc-stdin-dispatch-with-keeper-sidecar (task 7.7 + 9.1).
// Direct-driver tests for tryDispatchExtensionCommand covering the
// three-way decision (Paths B / C / D) and asserting mutual exclusion:
// for any single dispatch, EXACTLY ONE of (pi.dispatchCommand call,
// connection.send dispatch_extension_command, sink error feedback) fires.
describe("tryDispatchExtensionCommand: Path B/C/D mutual exclusion", () => {
  const ORIGINAL_ENV_FLAG = process.env.PI_DASHBOARD_SPAWNED;
  const ORIGINAL_ARGV = process.argv;

  function setHeadless(headless: boolean) {
    if (headless) {
      process.env.PI_DASHBOARD_SPAWNED = "1";
      process.argv = ["node", "pi", "--mode", "rpc"];
    } else {
      delete process.env.PI_DASHBOARD_SPAWNED;
      process.argv = ["node", "pi"];
    }
  }

  beforeEach(() => { setHeadless(false); });
  afterEach(() => {
    if (ORIGINAL_ENV_FLAG === undefined) delete process.env.PI_DASHBOARD_SPAWNED;
    else process.env.PI_DASHBOARD_SPAWNED = ORIGINAL_ENV_FLAG;
    process.argv = ORIGINAL_ARGV;
  });

  function makePi(opts: { withDispatch?: boolean } = {}) {
    const dispatchCommand = opts.withDispatch ? vi.fn(async () => undefined) : undefined;
    const getCommands = vi.fn(() => [{ name: "ctx-stats", source: "extension" }]);
    const pi: any = { getCommands };
    if (dispatchCommand) pi.dispatchCommand = dispatchCommand;
    return { pi, dispatchCommand };
  }

  function makeConn(): { conn: DispatchConnection; sent: ExtensionToServerMessage[] } {
    const sent: ExtensionToServerMessage[] = [];
    return { conn: { send: (m) => sent.push(m) }, sent };
  }

  it("Path B: pi.dispatchCommand present → dispatch called; no connection.send; sink gets started+completed", async () => {
    const { pi, dispatchCommand } = makePi({ withDispatch: true });
    const sink = vi.fn();
    const { conn, sent } = makeConn();
    setHeadless(true); // headless detection irrelevant when dispatchCommand exists

    const handled = await tryDispatchExtensionCommand(pi, "/ctx-stats", "sid", sink, conn);
    expect(handled).toBe(true);
    expect(dispatchCommand).toHaveBeenCalledTimes(1);
    expect(sent.filter((m) => m.type === "dispatch_extension_command")).toEqual([]);
    const evs = sink.mock.calls
      .map((c: any[]) => c[0])
      .filter((m: any) => m?.event?.eventType === "command_feedback")
      .map((m: any) => m.event.data.status);
    expect(evs).toEqual(["started", "completed"]);
  });

  it("Path C: no dispatchCommand + headless + connection → dispatch_extension_command emitted; no terminal feedback from bridge", async () => {
    const { pi, dispatchCommand } = makePi({ withDispatch: false });
    expect(dispatchCommand).toBeUndefined();
    const sink = vi.fn();
    const { conn, sent } = makeConn();
    setHeadless(true);

    const handled = await tryDispatchExtensionCommand(pi, "/ctx-stats", "sid-abc", sink, conn);
    expect(handled).toBe(true);

    // Exactly one dispatch_extension_command emission with the right shape.
    const dispatches = sent.filter((m): m is Extract<ExtensionToServerMessage, { type: "dispatch_extension_command" }> =>
      m.type === "dispatch_extension_command");
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0].sessionId).toBe("sid-abc");
    expect(dispatches[0].command).toBe("/ctx-stats");
    expect(typeof dispatches[0].requestId).toBe("string");
    expect(dispatches[0].requestId.length).toBeGreaterThan(0);

    // Bridge emitted started ONLY — server is responsible for the terminal event.
    const evs = sink.mock.calls
      .map((c: any[]) => c[0])
      .filter((m: any) => m?.event?.eventType === "command_feedback")
      .map((m: any) => m.event.data.status);
    expect(evs).toEqual(["started"]);
  });

  it("Path D: no dispatchCommand + non-headless → returns true with error feedback including rpc-keeper hint", async () => {
    const { pi } = makePi({ withDispatch: false });
    const sink = vi.fn();
    const { conn, sent } = makeConn();
    setHeadless(false);

    const handled = await tryDispatchExtensionCommand(pi, "/ctx-stats", "sid", sink, conn);
    expect(handled).toBe(true); // handled with error feedback
    expect(sent.filter((m) => m.type === "dispatch_extension_command")).toEqual([]);
    // Error feedback emitted with rpc-keeper hint.
    const evs = sink.mock.calls
      .map((c: any[]) => c[0])
      .filter((m: any) => m?.event?.eventType === "command_feedback");
    expect(evs).toHaveLength(1);
    expect((evs[0] as any).event.data.status).toBe("error");
    expect((evs[0] as any).event.data.message).toContain("session shape");
  });

  it("Path D: no dispatchCommand + no connection → returns true with error feedback", async () => {
    const { pi } = makePi({ withDispatch: false });
    const sink = vi.fn();
    setHeadless(false);

    const handled = await tryDispatchExtensionCommand(pi, "/ctx-stats", "sid", sink, undefined);
    expect(handled).toBe(true); // handled with error feedback
    // Error feedback emitted with rpc-keeper hint.
    const evs = sink.mock.calls
      .map((c: any[]) => c[0])
      .filter((m: any) => m?.event?.eventType === "command_feedback");
    expect(evs).toHaveLength(1);
    expect((evs[0] as any).event.data.status).toBe("error");
  });

  it("non-extension /skill:foo → returns false; no path fires; no events", async () => {
    const pi: any = {
      getCommands: () => [{ name: "skill:foo", source: "skill" }],
      dispatchCommand: vi.fn(),
    };
    const sink = vi.fn();
    const { conn, sent } = makeConn();
    setHeadless(true);

    const handled = await tryDispatchExtensionCommand(pi, "/skill:foo", "sid", sink, conn);
    expect(handled).toBe(false);
    expect(pi.dispatchCommand).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
    expect(sink).not.toHaveBeenCalled();
  });

  it("mutual exclusion: across all single-dispatch invocations, exactly one of (B, C, D) fires", async () => {
    type Scenario = { withDispatch: boolean; headless: boolean; expect: "B" | "C" | "D" };
    const scenarios: Scenario[] = [
      { withDispatch: true,  headless: true,  expect: "B" },
      { withDispatch: true,  headless: false, expect: "B" },
      { withDispatch: false, headless: true,  expect: "C" },
      { withDispatch: false, headless: false, expect: "D" },
    ];
    for (const s of scenarios) {
      const { pi, dispatchCommand } = makePi({ withDispatch: s.withDispatch });
      const sink = vi.fn();
      const { conn, sent } = makeConn();
      setHeadless(s.headless);

      const handled = await tryDispatchExtensionCommand(pi, "/ctx-stats", "sid", sink, conn);

      const dispatchedB = !!dispatchCommand && dispatchCommand.mock.calls.length > 0;
      const dispatchedC = sent.some((m) => m.type === "dispatch_extension_command");
      const dispatchedD = sink.mock.calls
        .map((c: any[]) => c[0])
        .some((m: any) => m?.event?.eventType === "command_feedback" && m?.event?.data?.status === "error");

      expect(handled, JSON.stringify(s)).toBe(true); // all paths now handle the command

      const fired = [dispatchedB && "B", dispatchedC && "C", dispatchedD && "D"].filter(Boolean);
      expect(fired, JSON.stringify(s)).toEqual([s.expect]);
    }
  });
});

// See change: add-steering-message (task 4.4).
// Verify the slash-routing fallback paths that call sendUserMessage honor the
// delivery field — `"steer"` → deliverAs:"steer"; absent/"followUp" → deliverAs:"followUp".
describe("bridge slash routing: delivery field → sendUserMessage deliverAs", () => {
  function lastDeliverAs(sendUserMessage: ReturnType<typeof vi.fn>): string | undefined {
    const lastCall = sendUserMessage.mock.calls.at(-1);
    if (!lastCall) return undefined;
    const opts = lastCall[1];
    return opts?.deliverAs;
  }

  it("skill command + delivery:'steer' → sendUserMessage called with deliverAs:'steer'", async () => {
    const stub = makeStubPi({ withDispatch: true });
    await drive("/skill:foo", stub, "steer");
    expect(stub.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(lastDeliverAs(stub.sendUserMessage)).toBe("steer");
  });

  it("skill command + delivery:'followUp' → sendUserMessage called with deliverAs:'followUp'", async () => {
    const stub = makeStubPi({ withDispatch: true });
    await drive("/skill:foo", stub, "followUp");
    expect(stub.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(lastDeliverAs(stub.sendUserMessage)).toBe("followUp");
  });

  it("skill command + delivery omitted → sendUserMessage defaults to deliverAs:'followUp'", async () => {
    const stub = makeStubPi({ withDispatch: true });
    await drive("/skill:foo", stub);
    expect(stub.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(lastDeliverAs(stub.sendUserMessage)).toBe("followUp");
  });

  it("prompt template + delivery:'steer' → deliverAs:'steer'", async () => {
    const stub = makeStubPi({ withDispatch: true });
    await drive("/review", stub, "steer");
    expect(lastDeliverAs(stub.sendUserMessage)).toBe("steer");
  });

  it("passthrough text + delivery:'steer' → deliverAs:'steer'", async () => {
    const stub = makeStubPi({ withDispatch: true });
    await drive("hello world", stub, "steer");
    expect(lastDeliverAs(stub.sendUserMessage)).toBe("steer");
  });

  it("passthrough text + delivery omitted → deliverAs:'followUp'", async () => {
    const stub = makeStubPi({ withDispatch: true });
    await drive("hello world", stub);
    expect(lastDeliverAs(stub.sendUserMessage)).toBe("followUp");
  });

  it("unrecognized slash + delivery:'steer' → deliverAs:'steer'", async () => {
    const stub = makeStubPi({ withDispatch: true });
    await drive("/totally-unknown-command", stub, "steer");
    expect(lastDeliverAs(stub.sendUserMessage)).toBe("steer");
  });

  it("bridge-native /__dashboard_reload fallback + delivery:'steer' → deliverAs:'steer'", async () => {
    const stub = makeStubPi({ withDispatch: true });
    await drive("/__dashboard_reload", stub, "steer");
    expect(lastDeliverAs(stub.sendUserMessage)).toBe("steer");
  });

  it("getCommands throws fallback + delivery:'steer' → deliverAs:'steer'", async () => {
    const stub = makeStubPi({ withDispatch: true, getCommandsThrows: true });
    await drive("/ctx-stats", stub, "steer");
    expect(lastDeliverAs(stub.sendUserMessage)).toBe("steer");
  });
});

describe("hasDispatchCommand", () => {
  it("returns true when field is a function", () => {
    expect(hasDispatchCommand({ dispatchCommand: () => {} })).toBe(true);
  });
  it("returns false when field is absent", () => {
    expect(hasDispatchCommand({})).toBe(false);
  });
  it("returns false when field is not a function", () => {
    expect(hasDispatchCommand({ dispatchCommand: "yes" })).toBe(false);
  });
  it("returns false on null/undefined", () => {
    expect(hasDispatchCommand(null)).toBe(false);
    expect(hasDispatchCommand(undefined)).toBe(false);
  });
});
