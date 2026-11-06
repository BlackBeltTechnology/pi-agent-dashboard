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
import { describe, expect, it } from "vitest";
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
    expect([...FLOW_REPLAY_ENTRY_TYPES]).toEqual(["flow-event"]);
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
