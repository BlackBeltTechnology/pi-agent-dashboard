/**
 * Plugin ownership on the bridge socket (D1): the server sends the manifest-derived
 * `plugin_ownership` table on `session_register`, and rejects an `event_forward` of
 * an owned type whose `pluginId` stamp is not the owner (test-plan #X4).
 * Harness: the `wireEvents` stub from `event-wiring-commands-list-invalidation.test.ts`.
 * See change: move-subagents-to-plugin (tasks 1.1, 1.11).
 */
import { describe, expect, it, vi } from "vitest";
import { wireEvents } from "../event-wiring.js";
import { createBrowserGateway } from "../pairing/browser-gateway.js";
import { createPendingForkRegistry } from "../pending/pending-fork-registry.js";
import { createMemoryEventStore } from "../persistence/memory-event-store.js";
import { buildPluginOwnership, createPluginOwnership } from "../plugin-ownership.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import { makeFakeDirectoryService } from "./helpers/load-fixtures.js";

const PLUGINS = [
  {
    manifest: {
      id: "subagents",
      eventTypes: ["subagent_*"],
      claims: [{ slot: "settings-section" }, { slot: "tool-renderer", toolName: "Agent" }],
    },
  },
  { manifest: { id: "flows", eventTypes: ["flow_*"], claims: [] } },
];

function makeRig() {
  const sessionManager = createMemorySessionManager();
  const eventStore = createMemoryEventStore(() => false);
  const piGateway = {
    start: vi.fn(), stop: vi.fn(), sendToSession: vi.fn(), getConnectedSessionIds: vi.fn(() => []),
    isSessionConnected: vi.fn(() => true), onEvent: vi.fn(),
  } as any;
  const browserGateway = createBrowserGateway(sessionManager, eventStore, piGateway);
  const pluginOwnership = createPluginOwnership(() => PLUGINS);
  wireEvents({
    sessionManager, eventStore, piGateway, browserGateway,
    sessionOrderManager: {
      insert: vi.fn(), remove: vi.fn(), getOrder: vi.fn(() => []), reorder: vi.fn(),
      getAllOrders: vi.fn(() => ({})), moveToFront: vi.fn(), rekey: vi.fn(),
    } as any,
    preferencesStore: {
      getPinnedDirectories: () => [], setPinnedDirectories: () => {}, getSessionOrder: () => ({}),
      setSessionOrder: () => {}, getAutoNameSessions: () => false,
    } as any,
    pendingForkRegistry: createPendingForkRegistry(),
    directoryService: makeFakeDirectoryService().service as any,
    knownSessionIds: new Set<string>(),
    pendingDashboardSpawns: new Map<string, number>(),
    viewedSessionTracker: browserGateway.viewedSessionTracker,
    pluginOwnership,
  });
  sessionManager.register({ id: "s1", cwd: "/repo", source: "cli", startedAt: 1 } as any);
  const send = (msg: Record<string, unknown>) => piGateway.onEvent!("s1", { sessionId: "s1", ...msg } as any);
  const forward = (eventType: string, pluginId?: string) =>
    send({
      type: "event_forward",
      event: { eventType, timestamp: 1, data: { id: "a1" } },
      ...(pluginId !== undefined ? { pluginId } : {}),
    });
  const storedTypes = () => eventStore.getEvents("s1", 0).map((e: any) => e.eventType ?? e.event?.eventType);
  return { piGateway, pluginOwnership, send, forward, storedTypes };
}

describe("buildPluginOwnership", () => {
  it("maps manifest eventTypes and tool-renderer claims to their plugin", () => {
    expect(buildPluginOwnership(PLUGINS)).toEqual({
      type: "plugin_ownership",
      eventTypes: { "subagent_*": "subagents", "flow_*": "flows" },
      toolClaims: { Agent: "subagents" },
    });
  });
});

describe("X4: owned forward mis-stamped", () => {
  it("drops an owned event_forward stamped with another plugin and counts it", () => {
    const r = makeRig();
    r.forward("subagent_created", "other");
    expect(r.storedTypes()).not.toContain("subagent_created");
    expect(r.pluginOwnership.stats.rejectedMisstamped).toBe(1);
  });

  it("drops an owned event_forward carrying no stamp", () => {
    const r = makeRig();
    r.forward("subagent_created");
    expect(r.storedTypes()).not.toContain("subagent_created");
    expect(r.pluginOwnership.stats.rejectedMisstamped).toBe(1);
  });

  it("stores an owned event_forward stamped by its owner, and an unowned type unstamped", () => {
    const r = makeRig();
    r.forward("subagent_created", "subagents");
    r.forward("custom_unowned_type");
    expect(r.storedTypes()).toEqual(expect.arrayContaining(["subagent_created", "custom_unowned_type"]));
    expect(r.pluginOwnership.stats.rejectedMisstamped).toBe(0);
  });
});

describe("session_register sends the ownership table", () => {
  it("sends plugin_ownership to the registering bridge", () => {
    const r = makeRig();
    r.send({ type: "session_register", cwd: "/repo", source: "cli", startedAt: 1 });
    expect(r.piGateway.sendToSession).toHaveBeenCalledWith("s1", buildPluginOwnership(PLUGINS));
  });
});
