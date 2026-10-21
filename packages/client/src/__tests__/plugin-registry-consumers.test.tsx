/**
 * Shell consumes the registry — populated + co-tenancy halves (test-plan #E91 / task 8.114).
 * The empty + runtime-after-load halves live in `plugin-registry-runtime.test.tsx`.
 *
 * Mounts the REAL `DemoSettings` through the REAL slot consumers (`SettingsSectionByPluginSlot`,
 * `SettingsSectionSlot`) fed the way `App.tsx` feeds them (`registry.addClaim` per manifest claim). The migrated
 * flows components (`SessionFlowActionsClaim` → `FlowActivityBadge`, once each) are asserted in
 * `packages/flows-plugin/src/__tests__/registry-consumers.test.tsx` — a core test may not import a plugin. No full App shell: the generated
 * registry is a build artifact whose fixture policy varies (it excludes `demo` after a production
 * build), so the claims are constructed here from the same manifests.
 *
 * `claim.tab` is inert since `plugin-settings-pages` — `settings-section` claims render only on the
 * owning plugin's page — so the scenario's "general → DemoSettings, servers → 0" is asserted as the
 * current contract: DemoSettings renders once inside the demo boundary and in no other tab/plugin boundary.
 * See change: decouple-plugins-from-core.
 */
import {
  createSlotRegistry,
  PluginContextProvider,
  SettingsSectionByPluginSlot,
  SettingsSectionSlot,
} from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { withUiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime/test-support";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DemoSettings } from "../../../demo-plugin/src/client.js";

afterEach(() => cleanup());

const demoRegistry = () => {
  const registry = createSlotRegistry();
  registry.addClaim({ pluginId: "demo", priority: 100, slot: "settings-section", tab: "general", Component: DemoSettings } as never);
  return registry;
};

describe("populated registry: demo settings claim (tab general)", () => {
  const mount = (registry: ReturnType<typeof createSlotRegistry>, body: React.ReactNode) =>
    render(
      withUiPrimitiveProvider(
        { [UI_PRIMITIVE_KEYS.oauthFlow]: () => null },
        <PluginContextProvider registry={registry} sessions={[]} send={vi.fn()}>
          {body}
        </PluginContextProvider>,
      ),
    );

  it("DemoSettings renders once inside the demo boundary", () => {
    const { container } = mount(demoRegistry(), <SettingsSectionByPluginSlot pluginId="demo" />);
    expect(container.querySelectorAll("[data-testid=demo-settings]")).toHaveLength(1);
  });

  it("co-tenancy: 0 DemoSettings in any other plugin's boundary and in the inert per-tab slot (general, servers)", () => {
    const registry = demoRegistry();
    for (const other of ["flows", "servers", "goal"]) {
      const { container, unmount } = mount(registry, <SettingsSectionByPluginSlot pluginId={other} />);
      expect(container.querySelectorAll("[data-testid=demo-settings]"), other).toHaveLength(0);
      unmount();
    }
    for (const tab of ["general", "servers"]) {
      const { container, unmount } = mount(registry, <SettingsSectionSlot tab={tab} />);
      expect(container.querySelectorAll("[data-testid=demo-settings]"), tab).toHaveLength(0);
      unmount();
    }
  });
});
