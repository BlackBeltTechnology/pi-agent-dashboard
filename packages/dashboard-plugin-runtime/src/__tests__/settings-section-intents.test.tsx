/**
 * `SettingsSectionByPluginSlot` is the single render path for the
 * `settings-section` slot, so it must consume BOTH contribution forms — refs
 * claims AND intent broadcasts — or the flip would silently amputate every
 * intent-driven and JSON-Schema-descriptor section (design D7).
 *
 * Intents carry no priority, so the merged order is: claims first (registry
 * comparator), then intents (design D8). And because the registry's enabled-set
 * filter covers claims only, intents must be filtered at this consumer or a
 * plugin disabled mid-session keeps an intent-rendered body (design D6).
 *
 * Covers test-plan rows E16, F3, F4.
 * See change: plugin-settings-pages.
 */
import { act, cleanup, render } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createUiPrimitiveRegistry,
  intentStore,
  registerUiPrimitive,
  SettingsSectionByPluginSlot,
  UiPrimitiveProvider,
  type UiPrimitiveRegistry,
} from "../index.js";
import { PluginContextProvider } from "../plugin-context.js";
import { createSlotRegistry, type SlotRegistry } from "../slot-registry.js";

function primitives(): UiPrimitiveRegistry {
  const registry = createUiPrimitiveRegistry();
  const StatusPill = ({ text }: { text: string }) => (
    <span data-testid="intent-node">{text}</span>
  );
  registerUiPrimitive(registry, "ui:status-pill" as never, StatusPill as never);
  return registry;
}

function renderPage(slots: SlotRegistry, pluginId: string) {
  return render(
    <UiPrimitiveProvider value={primitives()}>
      <PluginContextProvider registry={slots}>
        <SettingsSectionByPluginSlot pluginId={pluginId} />
      </PluginContextProvider>
    </UiPrimitiveProvider>,
  );
}

function broadcastIntent(pluginId: string, text: string) {
  act(() => {
    intentStore.set(
      { pluginId, sessionId: null, slot: "settings-section" },
      { primitive: "ui:status-pill", props: { text } },
    );
  });
}

beforeEach(() => intentStore.__resetForTests());
afterEach(() => {
  cleanup();
  intentStore.__resetForTests();
});

describe("SettingsSectionByPluginSlot — intent consumption", () => {
  // (test-plan #F4)
  it("renders an intent-only contribution, with no refs claim at all", () => {
    const slots = createSlotRegistry();
    const { queryByTestId, getByTestId } = renderPage(slots, "flows");
    expect(queryByTestId("intent-node")).toBeNull();

    broadcastIntent("flows", "from-intent");

    expect(getByTestId("intent-node").textContent).toBe("from-intent");
  });

  it("ignores an intent belonging to another plugin", () => {
    const slots = createSlotRegistry();
    const { queryByTestId } = renderPage(slots, "roles");
    broadcastIntent("flows", "from-intent");
    expect(queryByTestId("intent-node")).toBeNull();
  });

  // (test-plan #E16)
  it("renders the claim before the intent, with no priority interleave", () => {
    const slots = createSlotRegistry();
    slots.addClaim({
      pluginId: "flows",
      // A priority well above the intent's would-be default: order is
      // claims-then-intents, not one merged sort.
      priority: 5000,
      slot: "settings-section",
      Component: () => <div data-testid="claim-node">claim</div>,
    });

    const { container } = renderPage(slots, "flows");
    broadcastIntent("flows", "intent");

    const order = Array.from(container.querySelectorAll("[data-testid]")).map((el) =>
      el.getAttribute("data-testid"),
    );
    expect(order).toEqual(["claim-node", "intent-node"]);
  });

  // (test-plan #F3) — the registry filter covers claims only.
  it("drops a disabled plugin's intent", () => {
    const slots = createSlotRegistry();
    slots.setEnabledSet(new Set(["roles"]));

    const { queryByTestId } = renderPage(slots, "flows");
    broadcastIntent("flows", "should-not-render");

    expect(queryByTestId("intent-node")).toBeNull();
  });

  it("drops a live plugin's intent the moment it is disabled", () => {
    const slots = createSlotRegistry();
    slots.setEnabledSet(new Set(["flows"]));
    const { getByTestId, queryByTestId, rerender } = render(
      <UiPrimitiveProvider value={primitives()}>
        <PluginContextProvider registry={slots}>
          <SettingsSectionByPluginSlot pluginId="flows" />
        </PluginContextProvider>
      </UiPrimitiveProvider>,
    );
    broadcastIntent("flows", "live");
    expect(getByTestId("intent-node")).toBeDefined();

    // `usePluginEnabledSet` re-filters on `plugin_config_update`; nothing clears
    // the stale intent, so the consumer must.
    act(() => {
      slots.setEnabledSet(new Set([]));
    });
    rerender(
      <UiPrimitiveProvider value={primitives()}>
        <PluginContextProvider registry={slots}>
          <SettingsSectionByPluginSlot pluginId="flows" />
        </PluginContextProvider>
      </UiPrimitiveProvider>,
    );

    expect(queryByTestId("intent-node")).toBeNull();
  });
});

describe("SlotRegistry.isPluginEnabled", () => {
  it("reports true for every id before any setEnabledSet call", () => {
    const slots = createSlotRegistry();
    expect(slots.isPluginEnabled("anything")).toBe(true);
  });

  it("reports set membership once the filter is active", () => {
    const slots = createSlotRegistry();
    slots.setEnabledSet(new Set(["roles"]));
    expect(slots.isPluginEnabled("roles")).toBe(true);
    expect(slots.isPluginEnabled("flows")).toBe(false);
  });
});
