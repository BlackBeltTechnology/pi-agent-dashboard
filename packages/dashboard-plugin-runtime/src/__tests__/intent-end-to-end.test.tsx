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
import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import {
  intentStore,
  UiPrimitiveProvider,
  createUiPrimitiveRegistry,
  registerUiPrimitive,
  SessionCardActionBarSlot,
  type UiPrimitiveRegistry,
} from "../index.js";
import { PluginContextProvider } from "../plugin-context.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

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
