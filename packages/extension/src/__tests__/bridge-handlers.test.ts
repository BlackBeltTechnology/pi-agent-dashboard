/**
 * The modules extracted from `bridge.ts` run against a stub instance, without the entry point.
 *
 * Covers test-plan E4 (each module loads and runs alone), E5/X5 (inbound dispatch decision
 * table), E9 (session_start delegates session change), X2 (reload takeover keeps the old
 * instance inert), X3 (cross-reload values adopted, not defaulted), X6 (no-UI session).
 *
 * See change: test-trust-audit (design D2).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeStubConnection, makeStubInstance, makeStubPi } from "./helpers/bridge-instance-stub.js";

// E4: the entry point must never be loaded by an extracted module. A module that imports it
// (directly or through another module) makes this factory throw at import time.
vi.mock("../bridge.js", () => {
  throw new Error("bridge.ts (the entry point) was loaded by an extracted handler module");
});
vi.mock("../provider-register.js", () => ({
  reloadProviders: vi.fn(async () => ({ added: [], removed: [], changed: [] })),
  buildProviderCatalogue: vi.fn(() => [{ id: "prov" }]),
  toModelInfo: vi.fn((m: unknown) => m),
}));
vi.mock("../model-refresh.js", () => ({ refreshAfterCredentialsReload: vi.fn(async () => {}) }));

import { createInstance } from "../bridge-handlers/instance.js";

const dispatchModule = import("../bridge-handlers/dispatch.js");
const lifecycleModule = import("../bridge-handlers/lifecycle.js");
const forwardersModule = import("../bridge-handlers/forwarders.js");
const uiPatchModule = import("../bridge-handlers/ui-prompt-patch.js");

describe("E4: each extracted module imports and runs without the entry point", () => {
  it("loads all four modules (the bridge.js mock would throw if any imported the entry point)", async () => {
    await expect(Promise.all([dispatchModule, lifecycleModule, forwardersModule, uiPatchModule])).resolves.toHaveLength(4);
  });

  it("lifecycle: turn_end records ctx and drains usage, touching only the instance", async () => {
    const { registerTurnEnd } = await lifecycleModule;
    const drainUsage = vi.fn();
    const { inst, pi, shared, connection } = makeStubInstance({ drainUsage, lastFirstMessage: "already sent" });
    registerTurnEnd(inst);
    const ctx = { sessionManager: {} };
    await pi.handlers.get("turn_end")![0]({ type: "turn_end" }, ctx);
    expect(inst.cachedCtx).toBe(ctx);
    expect(drainUsage).toHaveBeenCalledWith(ctx);
    expect(connection.send).not.toHaveBeenCalled();
    expect(shared).toEqual({ generation: 1 });
  });

  it("forwarders: a pass-through event reaches pi.on and the stub connection", async () => {
    const { registerPassThroughForwarders } = await forwardersModule;
    const { inst, pi, connection } = makeStubInstance({ coalescer: { flush: vi.fn() } as never, cachedCtx: undefined });
    registerPassThroughForwarders(inst);
    expect(pi.handlers.has("input")).toBe(true);
    await pi.handlers.get("input")![0]({ type: "input", text: "hi" }, { cwd: "/x" });
    const sent = connection.send.mock.calls.map((c) => c[0]).filter((m) => m?.type === "event_forward");
    expect(sent).toHaveLength(1);
    expect(sent[0].event.eventType).toBe("input");
  });

  it("ui-prompt-patch: routes ctx.ui.select through the bus and restores nothing on the instance", async () => {
    const { patchUiForPromptBus } = await uiPatchModule;
    const request = vi.fn(async () => ({ cancelled: false, answer: "b" }));
    const bus = { request, registerAdapter: vi.fn() } as never;
    const { inst, connection } = makeStubInstance();
    const ctx = { hasUI: false, ui: { notify: vi.fn() } } as { hasUI: boolean; ui: Record<string, unknown> };
    patchUiForPromptBus(inst, ctx, bus);
    const answer = await (ctx.ui.select as (t: string, o: string[]) => Promise<string | undefined>)("Pick", ["a", "b"]);
    expect(answer).toBe("b");
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ type: "select", question: "Pick", options: ["a", "b"] }));
    expect(connection.send).not.toHaveBeenCalled();
  });
});

describe("X6: session_start on a no-UI session", () => {
  it("does not register the TUI adapter and still registers the dashboard adapter", async () => {
    const { patchUiForPromptBus } = await uiPatchModule;
    const registerAdapter = vi.fn();
    const bus = { request: vi.fn(), registerAdapter } as never;
    const { inst } = makeStubInstance();
    patchUiForPromptBus(inst, { hasUI: false, ui: {} }, bus);
    // The TUI adapter is the only adapter `patchUiForPromptBus` registers; none for hasUI=false.
    expect(registerAdapter).not.toHaveBeenCalled();
    patchUiForPromptBus(inst, { hasUI: true, ui: {} }, bus);
    expect(registerAdapter).toHaveBeenCalledTimes(1);
  });
});

describe("X2: reload takeover keeps the old instance inert", () => {
  it("old instance's handlers send nothing; the new instance's run", async () => {
    const { registerTurnEnd } = await lifecycleModule;
    const piA = makeStubPi();
    const piB = makeStubPi();
    const shared = { generation: 1 };
    const connA = makeStubConnection();
    const connB = makeStubConnection();
    const { inst: instA } = makeStubInstance({ connection: connA as never, lastFirstMessage: undefined, drainUsage: vi.fn() }, { generation: 1, shared, pi: piA });
    const { inst: instB } = makeStubInstance({ connection: connB as never, lastFirstMessage: undefined, drainUsage: vi.fn() }, { generation: 2, shared, pi: piB });
    // The takeover: a newer incarnation bumps the shared counter.
    shared.generation = 2;
    registerTurnEnd(instA);
    registerTurnEnd(instB);
    const ctx = { sessionManager: { getEntries: () => [{ type: "message", message: { role: "user", content: "hello world" } }] } };
    await piA.handlers.get("turn_end")![0]({}, ctx);
    await piB.handlers.get("turn_end")![0]({}, ctx);
    expect(instA.isActive()).toBe(false);
    expect(instB.isActive()).toBe(true);
    expect(connA.send).not.toHaveBeenCalled();
    expect(instA.cachedCtx).toBeUndefined();
    expect(instB.cachedCtx).toBe(ctx);
  });
});

describe("X3: cross-reload values are adopted, not defaulted", () => {
  it("a new instance sees the shared session id, attached change and stop-after-turn latch", () => {
    const shared = { generation: 2, sessionId: "S1", attachedChange: "c1", shouldStopAfterTurn: true };
    const inst = createInstance(makeStubPi() as never, 2, shared);
    expect(inst.shared.sessionId).toBe("S1");
    expect(inst.shared.attachedChange).toBe("c1");
    expect(inst.shared.shouldStopAfterTurn).toBe(true);
    expect(inst.generation).toBe(2);
    expect(inst.isActive()).toBe(true);
  });
});

describe("E9: session_start delegates the session change to session-sync", () => {
  it("a resume to a different session id calls session-sync's handleSessionChange once", async () => {
    vi.resetModules();
    const handleSessionChange = vi.fn();
    vi.doMock("../session-sync.js", async (orig) => ({ ...(await orig<typeof import("../session-sync.js")>()), handleSessionChange }));
    const { registerSessionStart } = await import("../bridge-handlers/lifecycle.js");
    const { inst, pi } = makeStubInstance({
      sessionId: "OLD",
      pathGate: { onSessionStart: vi.fn() } as never,
      mcpRegistrar: { onSessionStart: vi.fn() } as never,
      usageDrain: { baseline: vi.fn(() => undefined) } as never,
      abortLatch: { clear: vi.fn() } as never,
      // Session-change reset surface (everything handleSessionChange touches before delegating).
      subagentFrameBuffer: { reset: vi.fn() } as never,
      subagentTickThrottle: { reset: vi.fn() } as never,
      coalescer: { clear: vi.fn() } as never,
      bridgeSteering: [],
      bridgeFollowUp: { length: 0, reset: vi.fn() } as never,
      renewGitTracker: vi.fn() as never,
      syncBc: vi.fn(() => ({})) as never,
      applyBc: vi.fn(),
      getFlowsList: vi.fn(() => []),
      sendPiVersionIfChanged: vi.fn(),
      gitPollTimer: null,
      polling: { setGitPollTimer: vi.fn() } as never,
    });
    // The handler continues past the delegation into registration, which this test does not
    // exercise: it may throw on the first unstubbed field once the delegation has happened.
    registerSessionStart(inst);
    const ctx = { sessionManager: { getSessionId: () => "NEW" }, hasUI: false };
    await pi.handlers.get("session_start")![0]({ reason: "resume" }, ctx).catch(() => {});
    expect(handleSessionChange).toHaveBeenCalledTimes(1);
    // The new bridge context is handed on with the session ctx (arg 2) and the flow lister.
    expect(handleSessionChange.mock.calls[0][1]).toBe(ctx);
    vi.doUnmock("../session-sync.js");
  });
});

// ── E5 / X5: inbound dispatch decision table ─────────────────────────────────────────────

describe("E5: inbound message dispatch — one row per accepted message type", () => {
  let h: ReturnType<typeof makeStubInstance>;
  let commandHandle: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    commandHandle = vi.fn(async () => undefined);
    h = makeStubInstance({
      commandHandler: { handle: commandHandle } as never,
      pluginRequests: { handleReply: vi.fn() } as never,
      pathGate: { onServerMessage: vi.fn(() => false) } as never,
      mcpRegistrar: { onMinted: vi.fn() } as never,
      promptBus: { respond: vi.fn() } as never,
      bridgeFollowUp: {
        editText: vi.fn(() => ({ ok: true })),
        removeAt: vi.fn(() => true),
        promote: vi.fn(() => true),
        clearAll: vi.fn(() => true),
        clearIndices: vi.fn(() => true),
      } as never,
      emitQueueUpdate: vi.fn(),
      sendCommandFeedback: vi.fn(),
      sendModelUpdateIfChanged: vi.fn(),
      polling: { gitTracker: null } as never,
      prStatus: { refresh: vi.fn() } as never,
      cachedModelRegistry: { getAvailable: () => [{ provider: "p", id: "m" }], authStorage: { reload: vi.fn() } } as never,
    });
    h.pi.events.emit.mockImplementation((name: string, data: Record<string, unknown>) => {
      if (name === "roles:get-all") Object.assign(data, { roles: { fast: "m" }, presets: [], activePreset: null, builtinRoleNames: [] });
      if (name.startsWith("roles:") && name !== "roles:get-all") data.success = true;
    });
  });

  const run = async (msg: Record<string, unknown>) => (await dispatchModule).handleInboundMessage(h.inst, msg);
  const sentTypes = () => h.connection.send.mock.calls.map((c) => c[0]?.type);

  it("stop_after_turn latches the shared stop flag", async () => {
    await run({ type: "stop_after_turn" });
    expect(h.shared.shouldStopAfterTurn).toBe(true);
  });

  it("preferences_update stores the auto-name toggle", async () => {
    h.inst.autoNameSessions = true;
    await run({ type: "preferences_update", autoNameSessions: false });
    expect(h.inst.autoNameSessions).toBe(false);
  });

  it("plugin_reply resolves through the plugin request client", async () => {
    const msg = { type: "plugin_reply", id: "r1" };
    await run(msg);
    expect(h.inst.pluginRequests.handleReply).toHaveBeenCalledWith(msg);
  });

  it("mcp_token_minted registers the minted bearer", async () => {
    const msg = { type: "mcp_token_minted", token: "t", url: "u" };
    await run(msg);
    expect(h.inst.mcpRegistrar.onMinted).toHaveBeenCalledWith(msg);
  });

  it("server_restarting pauses auto-start for the announced window", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await run({ type: "server_restarting", reason: "upgrade", quiesceMs: 4000 });
    expect(h.connection.pauseAutoStart).toHaveBeenCalledWith(4000);
  });

  it("credentials_updated pushes models_list and providers_list", async () => {
    await run({ type: "credentials_updated" });
    expect(sentTypes()).toEqual(["models_list", "providers_list"]);
  });

  it("auto_name_state_restore adopts a restored state when no namer exists yet", async () => {
    await run({ type: "auto_name_state_restore", state: { lastSelfApplied: "Fix login" }, nameSource: "auto", nameSourceFor: "Fix login" });
    expect(h.inst.namerState).toBeDefined();
    expect(h.shared.namerState).toBe(h.inst.namerState);
  });

  it.each([
    ["run", { action: "run", flowName: "f", task: "t" }, "flow:run"],
    ["set-edit-mode", { action: "set-edit-mode", enabled: true }, "flow:set-edit-mode"],
    ["delete", { action: "delete", flowName: "f" }, "flow:delete-request"],
  ])("flow_management %s emits %s", async (_label, extra, event) => {
    await run({ type: "flow_management", ...extra });
    expect(h.pi.events.emit).toHaveBeenCalledWith(event, expect.anything());
  });

  it.each([
    ["abort", "flow:abort"],
    ["toggle_autonomous", "flow:toggle-autonomous"],
    ["dismiss_summary", "flow:summary-dismissed"],
  ])("flow_control %s emits %s", async (action, event) => {
    await run({ type: "flow_control", action });
    expect(h.pi.events.emit).toHaveBeenCalledWith(event, {});
  });

  it.each([
    ["role_set", { role: "fast", modelId: "m" }, "roles:set"],
    ["role_preset_load", { presetName: "p" }, "roles:preset-load"],
    ["role_preset_save", { presetName: "p" }, "roles:preset-save"],
    ["role_preset_delete", { presetName: "p" }, "roles:preset-delete"],
    ["role_remove", { role: "fast" }, "roles:remove"],
  ])("%s emits %s then pushes roles_list", async (type, extra, event) => {
    await run({ type, ...extra });
    expect(h.pi.events.emit).toHaveBeenCalledWith(event, expect.anything());
    expect(sentTypes()).toEqual(["roles_list"]);
  });

  it("request_roles replies with roles_list", async () => {
    await run({ type: "request_roles" });
    expect(sentTypes()).toEqual(["roles_list"]);
  });

  it("prompt_response answers the prompt bus", async () => {
    await run({ type: "prompt_response", promptId: "p1", answer: "yes", cancelled: false });
    expect(h.inst.promptBus!.respond).toHaveBeenCalledWith(expect.objectContaining({ id: "p1", answer: "yes", source: "dashboard-default" }));
  });

  it("plugin_emit_event re-emits on pi.events", async () => {
    await run({ type: "plugin_emit_event", eventType: "x:y", data: { a: 1 } });
    expect(h.pi.events.emit).toHaveBeenCalledWith("x:y", { a: 1 });
  });

  it("plugin_emit_event with an empty event type does nothing", async () => {
    await run({ type: "plugin_emit_event", eventType: "" });
    expect(h.pi.events.emit).not.toHaveBeenCalled();
  });

  it("edit_followup_entry edits then refreshes the queue; a refusal sends command feedback", async () => {
    await run({ type: "edit_followup_entry", index: 0, text: "x" });
    expect(h.inst.emitQueueUpdate).toHaveBeenCalledTimes(1);
    (h.inst.bridgeFollowUp.editText as ReturnType<typeof vi.fn>).mockReturnValueOnce({ ok: false, message: "nope" });
    await run({ type: "edit_followup_entry", index: 9, text: "x" });
    expect(h.inst.sendCommandFeedback).toHaveBeenCalledWith("edit_followup_entry", "nope");
    expect(h.inst.emitQueueUpdate).toHaveBeenCalledTimes(1);
  });

  it("remove / promote / clear follow-up entries mutate then refresh the queue", async () => {
    await run({ type: "remove_followup_entry", index: 0 });
    await run({ type: "promote_followup_entry", index: 1 });
    await run({ type: "clear_followup_entries", indices: "all" });
    await run({ type: "clear_followup_entries", indices: [0] });
    expect(h.inst.emitQueueUpdate).toHaveBeenCalledTimes(4);
    expect(h.inst.bridgeFollowUp.clearAll).toHaveBeenCalledTimes(1);
    expect(h.inst.bridgeFollowUp.clearIndices).toHaveBeenCalledWith([0]);
  });

  it("remove_followup_entry out of range reports feedback and does not refresh", async () => {
    (h.inst.bridgeFollowUp.removeAt as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
    await run({ type: "remove_followup_entry", index: 99 });
    expect(h.inst.sendCommandFeedback).toHaveBeenCalledWith("remove_followup_entry", "Index out of range");
    expect(h.inst.emitQueueUpdate).not.toHaveBeenCalled();
  });

  it("set_thinking_level goes to the command handler, then refreshes the model update", async () => {
    vi.useFakeTimers();
    try {
      await run({ type: "set_thinking_level", level: "high" });
      expect(commandHandle).toHaveBeenCalledTimes(1);
      expect(h.inst.sendModelUpdateIfChanged).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(60);
      expect(h.inst.sendModelUpdateIfChanged).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a command-handler response is sent back on the connection", async () => {
    commandHandle.mockResolvedValueOnce({ type: "command_result", ok: true });
    await run({ type: "send_prompt", text: "hi" });
    expect(sentTypes()).toEqual(["command_result"]);
  });

  it("transcript_request for another session is refused without touching the filesystem", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await run({ type: "transcript_request", sessionId: "OTHER", cursor: undefined });
    const sent = h.connection.send.mock.calls[0][0];
    expect(sent.type).toBe("transcript_chunk");
    expect(sent.refused).toBeDefined();
  });

  it("an inactive instance ignores every message (stale listener guard)", async () => {
    h.shared.generation = 2;
    await run({ type: "stop_after_turn" });
    expect(h.shared.shouldStopAfterTurn).toBeUndefined();
  });

  it("X5: an unknown message type falls through to the command handler and throws nothing", async () => {
    await expect(run({ type: "__nope__" })).resolves.toBeUndefined();
    expect(commandHandle).toHaveBeenCalledTimes(1);
    expect(h.connection.send).not.toHaveBeenCalled();
    expect(h.pi.events.emit).not.toHaveBeenCalled();
  });
});
