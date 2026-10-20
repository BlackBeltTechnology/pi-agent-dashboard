/**
 * Supervised mode wiring in the bridge: restore on `session_start`, the
 * `set_supervised` control message, registration fields, `supervised_state` re-report.
 * Test-plan: E30 (restore per session id, no inheritance), E31 bridge half (apply + append),
 * E32 (malformed ignored, pending prompt untouched), X14 (restore failure fails closed).
 * See change: add-supervised-tool-approval (design D4, D12).
 */
import { describe, expect, it, vi } from "vitest";
import { handleInboundMessage } from "../../bridge-handlers/dispatch.js";
import { PromptBus } from "../../prompt-bus.js";
import { createSupervisedGateForBridge } from "../index.js";
import { MODE_ENTRY } from "../mode-control.js";

type Entry = { type: string; customType?: string; data?: unknown };
const modeEntry = (on: unknown, rev?: unknown): Entry => ({ type: "custom", customType: MODE_ENTRY, data: rev === undefined ? { on } : { on, rev } });

function build(o: { cfgDefault?: "full" | "supervised"; bus?: PromptBus; owner?: () => "chat-gateway" | undefined } = {}) {
  const state: Record<string, unknown> = {};
  const sent: any[] = [];
  const logs: string[] = [];
  const entries: Array<[string, unknown]> = [];
  let sid = "s1";
  const gate = createSupervisedGateForBridge({
    state: state as never,
    getSessionId: () => sid,
    getPromptBus: () => o.bus,
    readConfig: () => ({ default: o.cfgDefault ?? "full", timeoutSeconds: 120, tools: ["bash", "powershell", "write", "edit", "Agent"] }),
    configFile: "/nonexistent/config.json",
    redact: (s) => s,
    appendEntry: (t, d) => entries.push([t, d]),
    send: (m) => void sent.push(m),
    getOwner: o.owner,
    log: (l) => logs.push(l),
  });
  return { gate, control: gate.control, state, sent, logs, entries, setSid: (s: string) => (sid = s) };
}

describe("restore on session_start (#E30, #X14)", () => {
  it("#E30 restores the LAST entry for the session id; a session with none starts at the config default (no inheritance)", () => {
    const b = build({ cfgDefault: "full" });
    b.control.restore("s1", () => [modeEntry(true, 1), { type: "message" }, modeEntry(false, 2)]);
    expect(b.gate.modes.get("s1")).toBe(false);
    expect(b.gate.modes.rev("s1")).toBe(2);
    b.gate.modes.set("s1", true); // the earlier variant: previous session ends up Supervised
    b.control.restore("s2", () => []);
    expect(b.gate.modes.get("s2")).toBe(false); // default, NOT s1's `true`
    expect(b.gate.modes.has("s2")).toBe(false);
    expect((b.state.supervisedModes as Map<string, boolean>).get("s1")).toBe(true); // state is Map<sessionId, boolean>
  });

  it("an entry-less session follows a `supervised` config default", () => {
    const b = build({ cfgDefault: "supervised" });
    b.control.restore("s9", () => []);
    expect(b.gate.modes.get("s9")).toBe(true);
  });

  it("restore replaces stale in-memory state with the session file (reload survival: shutdown cleared it, the entries bring it back)", () => {
    const b = build();
    b.gate.modes.set("s1", true, 4);
    b.gate.clearSession("s1"); // session_shutdown (reload)
    expect(b.gate.modes.has("s1")).toBe(false);
    b.control.restore("s1", () => [modeEntry(true, 4)]);
    expect(b.gate.modes.get("s1")).toBe(true);
    expect(b.gate.modes.rev("s1")).toBe(4);
  });

  it("an entry without a usable rev restores with rev 0", () => {
    const b = build();
    b.control.restore("s1", () => [modeEntry(true, "x")]);
    expect(b.gate.modes.get("s1")).toBe(true);
    expect(b.gate.modes.rev("s1")).toBe(0);
  });

  it("#X14 a throwing read fails closed: Supervised + `[supervised] mode restore failed`, even with default full", () => {
    const b = build({ cfgDefault: "full" });
    b.control.restore("s1", () => {
      throw new Error("EIO");
    });
    expect(b.gate.modes.get("s1")).toBe(true);
    expect(b.logs.some((l) => l.startsWith("[supervised] mode restore failed"))).toBe(true);
  });

  it("#X14 a malformed last entry also fails closed (never silently Full)", () => {
    const b = build({ cfgDefault: "full" });
    b.control.restore("s1", () => [modeEntry(false, 1), modeEntry("false", 2)]);
    expect(b.gate.modes.get("s1")).toBe(true);
    expect(b.logs.some((l) => l.startsWith("[supervised] mode restore failed"))).toBe(true);
  });

  it("#X14 the next bash prompts after a failed restore (end to end through the assembled gate)", async () => {
    const bus = new PromptBus({ timeoutMs: 300_000 });
    const requested = vi.fn();
    bus.registerAdapter({ name: "t", onRequest: (p) => void requested(p), onResponse: () => {}, onCancel: () => {} });
    const b = build({ cfgDefault: "full", bus });
    b.control.restore("s1", () => {
      throw new Error("boom");
    });
    const p = b.gate.handler({ toolName: "bash", toolCallId: "a", input: { command: "ls" } }, { hasUI: true, cwd: "/w" });
    await new Promise((r) => setTimeout(r, 0));
    expect(requested).toHaveBeenCalledTimes(1);
    bus.respond({ id: requested.mock.calls[0][0].id, answer: "Deny", source: "dashboard-default" });
    await p;
  });
});

describe("set_supervised (#E31 bridge half, #E32)", () => {
  it("applies {on,rev}, appends the supervised-mode entry and reports supervised_state", () => {
    const b = build();
    b.control.onSetSupervised({ type: "set_supervised", on: true, rev: 7 });
    expect(b.gate.modes.get("s1")).toBe(true);
    expect(b.gate.modes.rev("s1")).toBe(7);
    expect(b.entries).toEqual([[MODE_ENTRY, { on: true, rev: 7 }]]);
    expect(b.sent).toEqual([{ type: "supervised_state", sessionId: "s1", on: true, rev: 7 }]);
  });

  it("applies the server's value even when its rev is lower (the server owns reconcile)", () => {
    const b = build();
    b.gate.modes.set("s1", true, 9);
    b.control.onSetSupervised({ on: false, rev: 5 });
    expect(b.gate.modes.get("s1")).toBe(false);
    expect(b.gate.modes.rev("s1")).toBe(5);
  });

  it("without a rev the bridge bumps its own (prev + 1)", () => {
    const b = build();
    b.gate.modes.set("s1", true, 3);
    b.control.onSetSupervised({ on: false });
    expect(b.gate.modes.rev("s1")).toBe(4);
    expect(b.entries.at(-1)).toEqual([MODE_ENTRY, { on: false, rev: 4 }]);
  });

  it("reports the tool-gate owner alongside the mode", () => {
    const b = build({ owner: () => "chat-gateway" });
    b.control.onSetSupervised({ on: true, rev: 1 });
    expect(b.sent[0]).toMatchObject({ toolGateOwner: "chat-gateway" });
  });

  it("a failing appendEntry still applies the mode (logged)", () => {
    const state: Record<string, unknown> = {};
    const logs: string[] = [];
    const g = createSupervisedGateForBridge({
      state: state as never,
      getSessionId: () => "s1",
      getPromptBus: () => undefined,
      readConfig: () => ({ default: "full", timeoutSeconds: 120, tools: [] }),
      configFile: "/nonexistent/config.json",
      redact: (s) => s,
      appendEntry: () => {
        throw new Error("disk");
      },
      send: () => {},
      log: (l) => logs.push(l),
    });
    g.control.onSetSupervised({ on: true, rev: 1 });
    expect(g.modes.get("s1")).toBe(true);
    expect(logs.some((l) => l.includes("supervised-mode entry failed"))).toBe(true);
  });

  it("#E32 malformed payloads are ignored: mode kept, nothing appended or sent, a pending approval stays open", async () => {
    const bus = new PromptBus({ timeoutMs: 300_000 });
    const requested = vi.fn();
    bus.registerAdapter({ name: "t", onRequest: (p) => void requested(p), onResponse: () => {}, onCancel: () => {} });
    const b = build({ bus });
    b.gate.modes.set("s1", true, 2);
    const pending = b.gate.handler({ toolName: "bash", toolCallId: "a", input: { command: "ls" } }, { hasUI: true, cwd: "/w" });
    await new Promise((r) => setTimeout(r, 0));
    expect(bus.pendingCount).toBe(1);

    const inst = {
      isActive: () => true,
      pi: {},
      sessionId: "s1",
      supervisedGate: b.gate,
    } as never;
    for (const bad of [{ type: "set_supervised", on: "yes" }, { type: "set_supervised" }, { type: "set_supervised", on: 1 }, { type: "set_supervised", on: null }]) {
      await handleInboundMessage(inst, bad);
    }
    expect(b.gate.modes.get("s1")).toBe(true);
    expect(b.gate.modes.rev("s1")).toBe(2);
    expect(b.entries).toHaveLength(0);
    expect(b.sent).toHaveLength(0);
    expect(bus.pendingCount).toBe(1); // pending prompt still open, not resolved
    bus.respond({ id: requested.mock.calls[0][0].id, answer: "Deny", source: "dashboard-default" });
    await pending;
  });

  it("dispatch routes a well-formed set_supervised to the control (flip never resolves a pending approval, 4.3)", async () => {
    const bus = new PromptBus({ timeoutMs: 300_000 });
    const requested = vi.fn();
    bus.registerAdapter({ name: "t", onRequest: (p) => void requested(p), onResponse: () => {}, onCancel: () => {} });
    const b = build({ bus });
    b.gate.modes.set("s1", true, 1);
    const pending = b.gate.handler({ toolName: "bash", toolCallId: "a", input: { command: "ls" } }, { hasUI: true, cwd: "/w" });
    await new Promise((r) => setTimeout(r, 0));
    await handleInboundMessage({ isActive: () => true, pi: {}, sessionId: "s1", supervisedGate: b.gate } as never, { type: "set_supervised", on: false, rev: 2 });
    expect(b.gate.modes.get("s1")).toBe(false);
    expect(bus.pendingCount).toBe(1); // 4.3: the flip did not resolve the card
    bus.respond({ id: requested.mock.calls[0][0].id, answer: "Allow once", source: "dashboard-default" });
    expect(await pending).toBeUndefined();
  });
});

describe("registration fields + supervised_state re-report (4.2d, 3.14)", () => {
  it("registrationFields carries {on,rev} and the owner (only when set)", () => {
    let owner: "chat-gateway" | undefined;
    const b = build({ owner: () => owner });
    b.gate.modes.set("s1", true, 3);
    expect(b.control.registrationFields("s1")).toEqual({ supervised: { on: true, rev: 3 } });
    owner = "chat-gateway";
    expect(b.control.registrationFields("s1")).toEqual({ supervised: { on: true, rev: 3 }, toolGateOwner: "chat-gateway" });
  });

  it("a never-flipped session reports the effective default with rev 0", () => {
    const b = build({ cfgDefault: "supervised" });
    expect(b.control.registrationFields("s2")).toEqual({ supervised: { on: true, rev: 0 } });
  });

  it("reportIfChanged: silent before registration, silent when unchanged, sends when the owner appears later", () => {
    let owner: "chat-gateway" | undefined;
    const b = build({ owner: () => owner });
    b.control.reportIfChanged();
    expect(b.sent).toHaveLength(0); // not registered yet → the registration carries it
    b.control.registrationFields("s1");
    b.control.reportIfChanged();
    expect(b.sent).toHaveLength(0);
    owner = "chat-gateway"; // guard marked the slot after the bridge registered
    b.control.reportIfChanged();
    expect(b.sent).toEqual([{ type: "supervised_state", sessionId: "s1", on: false, rev: 0, toolGateOwner: "chat-gateway" }]);
    b.control.reportIfChanged();
    expect(b.sent).toHaveLength(1); // reported once
  });

  it("reportIfChanged sends when the mode changed locally; clearSession forgets the session", () => {
    const b = build();
    b.control.registrationFields("s1");
    b.gate.modes.set("s1", true);
    b.control.reportIfChanged();
    expect(b.sent).toHaveLength(1);
    b.gate.clearSession("s1");
    b.control.reportIfChanged();
    expect(b.sent).toHaveLength(1);
  });
});

describe("accessor for the path gate (#E21 inputs)", () => {
  it("inEffect = mode on AND owner !== chat-gateway AND tool in the configured set (case-insensitive)", () => {
    let owner: "chat-gateway" | undefined;
    const b = build({ owner: () => owner });
    expect(b.gate.inEffect("s1", "edit")).toBe(false); // mode off
    b.gate.modes.set("s1", true);
    expect(b.gate.inEffect("s1", "edit")).toBe(true);
    expect(b.gate.inEffect("s1", "EDIT")).toBe(true);
    expect(b.gate.inEffect("s1", "read")).toBe(false); // not in the risky set
    owner = "chat-gateway";
    expect(b.gate.inEffect("s1", "edit")).toBe(false); // guard-owned session
  });
});
