/**
 * flows-plugin bridge declares every pi-flows run channel through the generic
 * forward seam and requests a commands resend on rediscover / complete.
 * See change: update-flows-plugin (D1, D4; test-plan E4, E5, E8).
 */
import fs from "node:fs";
import path from "node:path";
import {
  BRIDGE_READY_CHANNEL,
  COMMANDS_CHANGED_CHANNEL,
  REGISTER_EVENT_FORWARD_CHANNEL,
} from "@blackbelt-technology/pi-dashboard-shared/event-forward-declaration.js";
import { afterEach, describe, expect, it } from "vitest";
import { PluginForwardRegistry } from "../../../../extension/src/plugin-event-forward-registry.js";
import { FLOW_RUN_DECLARATION, FLOW_REPLAY_ENTRY_TYPES } from "../flow-event-forward.js";
import activate from "../index.js";

function fakePi() {
  const emitted: Array<{ channel: string; data: unknown }> = [];
  const handlers = new Map<string, Array<(d: unknown) => void>>();
  return {
    emitted,
    on: () => undefined,
    events: {
      emit: (channel: string, data: unknown) => {
        emitted.push({ channel, data });
        for (const h of handlers.get(channel) ?? []) h(data);
      },
      on: (channel: string, h: (d: unknown) => void) => {
        handlers.set(channel, [...(handlers.get(channel) ?? []), h]);
        return () => handlers.set(channel, (handlers.get(channel) ?? []).filter((x) => x !== h));
      },
    },
  };
}

const runDecls = (pi: ReturnType<typeof fakePi>) =>
  pi.emitted.filter(
    (e) =>
      e.channel === REGISTER_EVENT_FORWARD_CHANNEL &&
      Object.keys((e.data as { channels: object }).channels).some((c) => c.startsWith("flow:")),
  );

describe("flows-plugin bridge: run channel declaration (E4)", () => {
  it("declares the 16 run channels on activate and on bridge-ready, deep-equal", () => {
    const pi = fakePi();
    activate(pi);
    pi.events.emit(BRIDGE_READY_CHANNEL, {});
    const decls = runDecls(pi);
    expect(decls).toHaveLength(2);
    expect(decls[0].data).toEqual(decls[1].data);
    const decl = decls[0].data as typeof FLOW_RUN_DECLARATION;
    expect(decl.pluginId).toBe("flows");
    const ch = decl.channels;
    expect(Object.keys(ch)).toHaveLength(16);
    const stepKeyed = [
      ["flow:agent-started", "flow_agent_started"],
      ["flow:agent-complete", "flow_agent_complete"],
      ["flow:agent-error", "flow_agent_error"],
      ["flow:subagent-tool-call", "flow_tool_call"],
      ["flow:subagent-tool-result", "flow_tool_result"],
      ["flow:assistant-text", "flow_assistant_text"],
      ["flow:thinking-text", "flow_thinking_text"],
      ["flow:loop-iteration", "flow_loop_iteration"],
      ["flow:decision", "flow_decision"],
    ];
    for (const [c, as] of stepKeyed) expect(ch[c], c).toEqual({ as, delivery: "stream", key: "stepId" });
    expect(ch["flow:flow-started"]).toEqual({ as: "flow_started", delivery: "stream", key: "flowName" });
    expect(ch["flow:complete"]).toEqual({ as: "flow_complete", delivery: "stream", key: "flowName" });
    expect(ch["flow:auto-decision"]).toEqual({ as: "flow_auto_decision", delivery: "stream", key: "agentName" });
    expect(ch["flow:summary-started"]).toEqual({ as: "flow_summary_started", delivery: "live" });
    expect(ch["flow:summary-ready"]).toEqual({ as: "flow_summary_ready", delivery: "live" });
    expect(ch["flow:summary-dismissed"]).toEqual({ as: "flow_summary_dismissed", delivery: "live" });
    expect(ch["flow:autonomous-mode-changed"]).toEqual({ as: "flow_autonomous_changed", delivery: "live" });
    expect(Object.keys(ch).length).toBeLessThanOrEqual(32);
  });

  it("declares the persisted entry type, equal to the manifest replayEntryTypes", () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../../package.json"), "utf8"));
    expect(FLOW_RUN_DECLARATION.replayEntryTypes).toEqual(pkg["pi-dashboard-plugin"].replayEntryTypes);
    expect([...FLOW_REPLAY_ENTRY_TYPES]).toEqual(["flow-event", "flow-run-close"]);
  });
});

describe("flows-plugin bridge: payloads forwarded verbatim (E5)", () => {
  it("lifecycle nodeKind / outcome ride in event_forward.data unchanged", () => {
    const pi = fakePi();
    const sent: Array<{ eventType: string; data: Record<string, unknown> }> = [];
    const registry = new PluginForwardRegistry(pi.events, {
      send: (eventType, data) => sent.push({ eventType, data }),
      isSessionReady: () => true,
      isActive: () => true,
      isConnected: () => true,
      isCoreChannel: () => false,
    });
    registry.attach();
    // The server's ownership table releases held declarations (D1).
    registry.setOwnership({ eventTypes: { "flow_*": "flows" } });
    activate(pi);
    const payloads = [
      { stepId: "s", nodeKind: "code-decision" },
      { stepId: "s", outcome: "soft" },
      { stepId: "s", outcome: "hard" },
      { stepId: "s" },
    ];
    for (const p of payloads) {
      pi.events.emit("flow:agent-started", p);
      pi.events.emit("flow:agent-complete", p);
    }
    expect(sent).toHaveLength(8);
    sent.forEach((s, i) => {
      expect(s.eventType).toBe(i % 2 === 0 ? "flow_agent_started" : "flow_agent_complete");
      expect(s.data).toEqual(payloads[Math.floor(i / 2)]);
    });
    expect("nodeKind" in sent[6].data).toBe(false);
  });
});

describe("flows-plugin bridge: commands resend request (E8)", () => {
  it("emits dashboard:commands-changed once per rediscover / complete", () => {
    const pi = fakePi();
    activate(pi);
    pi.events.emit("flow:rediscover", {});
    pi.events.emit("flow:complete", { flowName: "r" });
    expect(pi.emitted.filter((e) => e.channel === COMMANDS_CHANGED_CHANNEL)).toHaveLength(2);
    expect(pi.emitted.some((e) => e.channel === "commands_list" || e.channel === "flow:list")).toBe(false);
  });
});

/** T7: a dismissal with a runId is persisted as its own `flow-run-close` entry.
 *  See change: persist-flow-run-close (D1). */
describe("flows-plugin bridge: persists run dismissals (T7)", () => {
  function piWithAppend(appendEntry: (type: string, data: unknown) => void) {
    return Object.assign(fakePi(), { appendEntry });
  }

  it("appends one flow-run-close record for a dismiss with runId", () => {
    const appended: Array<[string, unknown]> = [];
    const pi = piWithAppend((type, data) => appended.push([type, data]));
    activate(pi);
    pi.events.emit("flow:summary-dismissed", { runId: "r1" });
    expect(appended).toHaveLength(1);
    const [type, rec] = appended[0] as [string, { seq: unknown; eventType: unknown; data: unknown }];
    expect(type).toBe("flow-run-close");
    expect(typeof rec.seq).toBe("number");
    expect(rec.eventType).toBe("flow_summary_dismissed");
    expect(rec.data).toEqual({ runId: "r1" });
  });

  it.each([[{}], [undefined], [{ runId: "" }], [{ runId: 5 }]])("persists nothing for %j", (payload) => {
    const appended: unknown[] = [];
    const pi = piWithAppend((...a) => appended.push(a));
    activate(pi);
    pi.events.emit("flow:summary-dismissed", payload);
    expect(appended).toEqual([]);
  });

  it("swallows an appendEntry failure; the live forward still happens", () => {
    const pi = piWithAppend(() => {
      throw new Error("disk full");
    });
    const sent: string[] = [];
    const registry = new PluginForwardRegistry(pi.events, {
      send: (eventType) => sent.push(eventType),
      isSessionReady: () => true,
      isActive: () => true,
      isConnected: () => true,
      isCoreChannel: () => false,
    });
    registry.attach();
    // The server's ownership table releases held declarations (D1).
    registry.setOwnership({ eventTypes: { "flow_*": "flows" } });
    activate(pi);
    expect(() => pi.events.emit("flow:summary-dismissed", { runId: "r1" })).not.toThrow();
    expect(sent).toContain("flow_summary_dismissed");
  });
});

// ── flow_open tool. See change: add-flow-open-tool (test-plan E21, X4, X5). ──

describe("flows-plugin bridge: flow_open tool", () => {
  type Tool = {
    name: string;
    description: string;
    promptGuidelines: string[];
    execute: (id: string, p: Record<string, unknown>, s?: unknown, u?: unknown, c?: { cwd?: string }) => Promise<{ details: Record<string, unknown> }>;
  };
  const SYM = Symbol.for("pi-dashboard.pluginRequest");
  const g = globalThis as Record<symbol, unknown>;
  afterEach(() => {
    delete g[SYM];
  });

  function piWithTools() {
    const base = fakePi();
    const tools: Tool[] = [];
    const lifecycle = new Map<string, Array<() => void>>();
    return {
      ...base,
      tools,
      on: (name: string, h: () => void) => lifecycle.set(name, [...(lifecycle.get(name) ?? []), h]),
      fire: (name: string) => {
        for (const h of lifecycle.get(name) ?? []) h();
      },
      registerTool: (t: Tool) => tools.push(t),
    };
  }

  it("E21: activate registers one flow_open tool with description + promptGuidelines", () => {
    const pi = piWithTools();
    activate(pi);
    const t = pi.tools.filter((x) => x.name === "flow_open");
    expect(t).toHaveLength(1);
    expect(t[0].description).toMatch(/flow/);
    expect(t[0].promptGuidelines.join(" ")).toMatch(/writing, editing or inspecting.*flow_open/);
  });

  it("X4: refused flow-running between flow-started and its matching complete; rejected complete does not clear; session_start resets", async () => {
    const calls: unknown[] = [];
    g[SYM] = async (_p: string, _t: string, payload: unknown) => {
      calls.push(payload);
      return { ok: true, result: { status: "shown", acks: 1 } };
    };
    const pi = piWithTools();
    activate(pi);
    const tool = pi.tools.find((x) => x.name === "flow_open") as Tool;
    const status = async () => (await tool.execute("1", { flow: "a:b" })).details;
    expect(await status()).toMatchObject({ status: "shown" });
    pi.events.emit("flow:flow-started", { runId: "r1" });
    expect(await status()).toEqual({ status: "refused", reason: "flow-running" });
    pi.events.emit("flow:complete", { status: "rejected" });
    expect(await status()).toEqual({ status: "refused", reason: "flow-running" });
    pi.events.emit("flow:complete", { runId: "other" });
    expect(await status()).toEqual({ status: "refused", reason: "flow-running" });
    pi.events.emit("flow:complete", { runId: "r1" });
    expect(await status()).toMatchObject({ status: "shown" });
    pi.events.emit("flow:flow-started", { runId: "r2" });
    pi.fire("session_start");
    expect(await status()).toMatchObject({ status: "shown" });
    expect(calls).toEqual([{ flow: "a:b" }, { flow: "a:b" }, { flow: "a:b" }]);
  });

  it("X5: no seam, lane error, lane timeout or a throwing seam → refused unavailable, never throws", async () => {
    const pi = piWithTools();
    activate(pi);
    const tool = pi.tools.find((x) => x.name === "flow_open") as Tool;
    const run = () => tool.execute("1", { path: "f" }, undefined, undefined, { cwd: "/w" });
    expect((await run()).details).toEqual({ status: "refused", reason: "unavailable" });
    g[SYM] = async () => ({ ok: false, error: "no_handler" });
    expect((await run()).details).toEqual({ status: "refused", reason: "unavailable" });
    g[SYM] = async () => ({ ok: false, error: "timeout" });
    expect((await run()).details).toEqual({ status: "refused", reason: "unavailable" });
    g[SYM] = () => {
      throw new Error("boom");
    };
    expect((await run()).details).toEqual({ status: "refused", reason: "unavailable" });
  });

  it("resolves a relative path against the tool cwd and rejects both/neither arguments", async () => {
    const calls: unknown[] = [];
    g[SYM] = async (_p: string, _t: string, payload: unknown) => {
      calls.push(payload);
      return { ok: true, result: { status: "no-viewer" } };
    };
    const pi = piWithTools();
    activate(pi);
    const tool = pi.tools.find((x) => x.name === "flow_open") as Tool;
    await tool.execute("1", { path: "flows/a" }, undefined, undefined, { cwd: "/w" });
    expect(calls).toEqual([{ path: path.resolve("/w", "flows/a") }]);
    expect((await tool.execute("1", {})).details).toEqual({ status: "refused", reason: "invalid-arguments" });
    expect((await tool.execute("1", { flow: "a:b", path: "x" })).details).toEqual({ status: "refused", reason: "invalid-arguments" });
  });
});
