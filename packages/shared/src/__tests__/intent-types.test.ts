import { describe, it, expect } from "vitest";
import type {
  IntentNode,
  ActionDescriptor,
  PluginIntentsMessage,
  PluginActionMessage,
} from "../dashboard-plugin/intent-types.js";

describe("intent-types — wire format", () => {
  it("IntentNode round-trips through JSON.stringify + JSON.parse losslessly", () => {
    const intent: IntentNode = {
      primitive: "ui:action-list",
      props: {
        actions: [
          { label: "Run Flow X" },
          { label: "Run Flow Y" },
        ],
      },
      key: "actions-1",
      actions: {
        onClick: {
          pluginId: "flows",
          action: "flow.run",
          payload: { flow: "X" },
        } satisfies ActionDescriptor,
      },
    };

    const roundTrip = JSON.parse(JSON.stringify(intent)) as IntentNode;
    expect(roundTrip).toEqual(intent);
    expect(roundTrip.primitive).toBe("ui:action-list");
    expect((roundTrip.actions?.onClick as ActionDescriptor).pluginId).toBe("flows");
  });

  it("nested IntentNode inside props survives round-trip", () => {
    const inner: IntentNode = {
      primitive: "ui:markdown",
      props: { content: "## Hello" },
    };

    const outer: IntentNode = {
      primitive: "ui:agent-card",
      props: {
        name: "Explore",
        status: "running",
        body: inner,
      },
    };

    const roundTrip = JSON.parse(JSON.stringify(outer)) as IntentNode;
    expect(roundTrip).toEqual(outer);

    // Nested IntentNode is still structurally an IntentNode after parse
    const nestedBody = (roundTrip.props as Record<string, unknown>).body as IntentNode;
    expect(nestedBody.primitive).toBe("ui:markdown");
    expect((nestedBody.props as Record<string, unknown>).content).toBe("## Hello");
  });

  it("PluginIntentsMessage envelope is well-typed", () => {
    const msg: PluginIntentsMessage = {
      type: "plugin_intents",
      pluginId: "flows",
      sessionId: "abc-123",
      slot: "session-card-action-bar",
      intent: {
        primitive: "ui:action-list",
        props: { actions: [] },
      },
    };

    const roundTrip = JSON.parse(JSON.stringify(msg)) as PluginIntentsMessage;
    expect(roundTrip.type).toBe("plugin_intents");
    expect(roundTrip.slot).toBe("session-card-action-bar");
    expect(roundTrip.sessionId).toBe("abc-123");
  });

  it("PluginIntentsMessage with null intent (clear semantics) round-trips", () => {
    const msg: PluginIntentsMessage = {
      type: "plugin_intents",
      pluginId: "flows",
      sessionId: "abc-123",
      slot: "content-view",
      intent: null,
    };

    const roundTrip = JSON.parse(JSON.stringify(msg)) as PluginIntentsMessage;
    expect(roundTrip.intent).toBeNull();
  });

  it("PluginActionMessage envelope is well-typed", () => {
    const msg: PluginActionMessage = {
      type: "plugin_action",
      pluginId: "flows",
      sessionId: "abc-123",
      action: "flow.run",
      payload: { flow: "X" },
    };

    const roundTrip = JSON.parse(JSON.stringify(msg)) as PluginActionMessage;
    expect(roundTrip.type).toBe("plugin_action");
    expect(roundTrip.action).toBe("flow.run");
    expect((roundTrip.payload as { flow: string }).flow).toBe("X");
  });

  it("sessionId may be null for global slots", () => {
    const msg: PluginIntentsMessage = {
      type: "plugin_intents",
      pluginId: "subagents",
      sessionId: null,
      slot: "settings-section",
      intent: {
        primitive: "ui:status-pill",
        props: { state: "connected", text: "ready" },
      },
    };

    const roundTrip = JSON.parse(JSON.stringify(msg)) as PluginIntentsMessage;
    expect(roundTrip.sessionId).toBeNull();
  });
});
