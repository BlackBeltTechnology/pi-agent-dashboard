/**
 * End-to-end integration test: simulate a server broadcast by directly
 * mutating the IntentStore, render a slot consumer, verify the primitive
 * renders via the registry resolution path.
 *
 * Does NOT use a real plugin or WebSocket — that's section 19's manual
 * smoke. This verifies the wire-format → renderer path is functional.
 *
 * See change: adopt-server-driven-intent-rendering.
 */

import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, cleanup, render, within } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createUiPrimitiveRegistry,
  IntentRenderer,
  IntentStore,
  intentStore,
  registerUiPrimitive,
  SessionCardActionBarSlot,
  UiPrimitiveProvider,
  type UiPrimitiveRegistry,
} from "../index.js";
import { PluginContextProvider } from "../plugin-context.js";

function mockSession(id = "test-session"): DashboardSession {
  return {
    id,
    cwd: "/tmp",
    branch: null,
    status: "running",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as unknown as DashboardSession;
}

function setup() {
  intentStore.__resetForTests();
  const registry = createUiPrimitiveRegistry();
  const ActionList = ({ actions }: { actions: { label: string; onClick?: () => void }[] }) => (
    <ul data-testid="action-list">
      {actions.map((a, i) => (
        <li key={i}>
          <button onClick={a.onClick}>{a.label}</button>
        </li>
      ))}
    </ul>
  );
  const StatusPill = ({ text }: { text: string }) => (
    <span data-testid="status-pill">{text}</span>
  );
  registerUiPrimitive(registry, "ui:action-list" as never, ActionList as never);
  registerUiPrimitive(registry, "ui:status-pill" as never, StatusPill as never);
  return registry;
}

function renderSlot(registry: UiPrimitiveRegistry, session: DashboardSession) {
  return render(
    <UiPrimitiveProvider value={registry}>
      <PluginContextProvider>
        <SessionCardActionBarSlot session={session} />
      </PluginContextProvider>
    </UiPrimitiveProvider>,
  );
}

afterEach(() => {
  cleanup();
  intentStore.__resetForTests();
});

describe("intent end-to-end: server broadcast → store → slot consumer → render", () => {
  beforeEach(() => intentStore.__resetForTests());

  it("intent set after mount renders via IntentRenderer", () => {
    const registry = setup();
    const session = mockSession("abc");
    const { getByTestId, queryByTestId } = renderSlot(registry, session);

    // Initial: no intents, slot renders nothing.
    expect(queryByTestId("action-list")).toBeNull();

    // Simulate server broadcast.
    act(() => {
      intentStore.set(
        { pluginId: "flows", sessionId: "abc", slot: "session-card-action-bar" },
        {
          primitive: "ui:action-list",
          props: { actions: [{ label: "Run A" }, { label: "Run B" }] },
        },
      );
    });

    expect(getByTestId("action-list").textContent).toBe("Run ARun B");
  });

  it("two intents for the same slot (different plugins) both render", () => {
    const registry = setup();
    const session = mockSession("abc");
    const { container } = renderSlot(registry, session);

    act(() => {
      intentStore.set(
        { pluginId: "flows", sessionId: "abc", slot: "session-card-action-bar" },
        { primitive: "ui:action-list", props: { actions: [{ label: "A" }] } },
      );
      intentStore.set(
        { pluginId: "goal", sessionId: "abc", slot: "session-card-action-bar" },
        { primitive: "ui:status-pill", props: { text: "status-pill-x" } },
      );
    });

    // Both contributions render side-by-side.
    expect(container.textContent).toContain("A");
    expect(container.textContent).toContain("status-pill-x");
  });

  it("intent set to null clears the rendering", () => {
    const registry = setup();
    const session = mockSession("abc");
    const { queryByTestId } = renderSlot(registry, session);

    act(() => {
      intentStore.set(
        { pluginId: "flows", sessionId: "abc", slot: "session-card-action-bar" },
        { primitive: "ui:action-list", props: { actions: [{ label: "A" }] } },
      );
    });
    expect(queryByTestId("action-list")).not.toBeNull();

    act(() => {
      intentStore.set(
        { pluginId: "flows", sessionId: "abc", slot: "session-card-action-bar" },
        null,
      );
    });
    expect(queryByTestId("action-list")).toBeNull();
  });

  it("intent for a different session does NOT render in this session's slot", () => {
    const registry = setup();
    const session = mockSession("abc");
    const { queryByTestId } = renderSlot(registry, session);

    act(() => {
      intentStore.set(
        { pluginId: "flows", sessionId: "xyz", slot: "session-card-action-bar" },
        { primitive: "ui:action-list", props: { actions: [{ label: "A" }] } },
      );
    });
    expect(queryByTestId("action-list")).toBeNull();
  });

  it("intent referencing an unknown primitive renders UnknownPrimitive fallback", () => {
    const registry = setup();
    const session = mockSession("abc");
    const { container } = renderSlot(registry, session);

    act(() => {
      intentStore.set(
        { pluginId: "flows", sessionId: "abc", slot: "session-card-action-bar" },
        { primitive: "ui:does-not-exist", props: {} },
      );
    });
    expect(container.textContent).toContain("Unknown primitive: ui:does-not-exist");
  });
});

// ── test-plan #E34 — a `plugin_intents` broadcast reaches EVERY client ─────────
// Each connected client applies the same broadcast to its OWN IntentStore (the
// `useMessageHandler` `case "plugin_intents"` arm: `store.set(key, msg.intent)`).
// See change: decouple-plugins-from-core.
describe("plugin_intents broadcast: every client, nested primitives, null clears (#E34)", () => {
  const SLOT = "session-card-action-bar" as const;
  const NESTED = {
    primitive: "ui:agent-card",
    props: {
      name: "Explore",
      status: "running",
      body: { primitive: "ui:markdown-content", props: { content: "## nested" } },
    },
  };
  const broadcast = (intent: unknown) =>
    ({ type: "plugin_intents", pluginId: "flows", sessionId: "abc", slot: SLOT, intent }) as const;
  const apply = (store: IntentStore, m: ReturnType<typeof broadcast>) =>
    store.set({ pluginId: m.pluginId, sessionId: m.sessionId, slot: m.slot }, m.intent as never);

  function nestedRegistry(bodySpy?: (body: unknown) => void) {
    const registry = createUiPrimitiveRegistry();
    registerUiPrimitive(
      registry,
      "ui:agent-card" as never,
      (({ name, status, body }: { name: string; status: string; body?: React.ReactNode }) => {
        bodySpy?.(body);
        return (
          <section data-testid="card">
            <h3>{name}</h3>
            <span>{status}</span>
            {body}
          </section>
        );
      }) as never,
    );
    registerUiPrimitive(
      registry,
      "ui:markdown-content" as never,
      (({ content }: { content: string }) => <div data-testid="md">{content}</div>) as never,
    );
    return registry;
  }

  const renderFrom = (store: IntentStore, registry: UiPrimitiveRegistry) => {
    const intent = store.getForSlot(SLOT, "abc").get("flows");
    return render(
      <UiPrimitiveProvider value={registry}>
        {intent ? <IntentRenderer intent={intent} pluginId="flows" send={() => {}} /> : null}
      </UiPrimitiveProvider>,
    );
  };

  it("both clients' stores hold the intent and render identical HTML; nested markdown arrives as the body", () => {
    const clientA = new IntentStore();
    const clientB = new IntentStore();
    const m = broadcast(NESTED);
    apply(clientA, m);
    apply(clientB, m);
    expect(clientA.getForSlot(SLOT, "abc").get("flows")).toEqual(NESTED);
    expect(clientB.getForSlot(SLOT, "abc").get("flows")).toEqual(NESTED);

    const bodies: unknown[] = [];
    const a = renderFrom(clientA, nestedRegistry((b) => bodies.push(b)));
    const b = renderFrom(clientB, nestedRegistry());
    expect(a.container.innerHTML).toBe(b.container.innerHTML);
    expect(within(a.container).getByTestId("md").textContent).toBe("## nested");
    // The agent-card received the markdown as a rendered React element in `body`.
    expect(React.isValidElement(bodies[0])).toBe(true);
  });

  it("intent:null clears the key on every client and the slot renders 0 nodes from flows", () => {
    const clientA = new IntentStore();
    const clientB = new IntentStore();
    for (const c of [clientA, clientB]) apply(c, broadcast(NESTED));
    for (const c of [clientA, clientB]) apply(c, broadcast(null));
    expect(clientA.getForSlot(SLOT, "abc").has("flows")).toBe(false);
    expect(clientB.getForSlot(SLOT, "abc").has("flows")).toBe(false);

    // The real slot (global store) after the same clearing broadcast.
    const registry = nestedRegistry();
    const session = mockSession("abc");
    act(() => {
      intentStore.set({ pluginId: "flows", sessionId: "abc", slot: SLOT }, NESTED as never);
    });
    const { container, queryByTestId } = renderSlot(registry, session);
    expect(queryByTestId("card")).not.toBeNull();
    act(() => {
      intentStore.set({ pluginId: "flows", sessionId: "abc", slot: SLOT }, null);
    });
    expect(container.querySelectorAll("[data-testid='card']").length).toBe(0);
    expect(container.textContent).toBe("");
  });
});
