/**
 * FlowsSettings (settings consistency wave 2): kit switch with a short label and
 * a `t()` hint, no native checkbox; draft id `plugin:flows` commits `editFlow`.
 * See change: retro-ux-plugin-settings-wave-2.
 */
import { CurrentPluginLayer, createSlotRegistry, PluginContextProvider, type RegisteredSource, SettingsDraftProvider } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FlowsSettings } from "../client/FlowsSettings.js";

afterEach(cleanup);

function renderSettings(sources: Map<string, RegisteredSource>, send = vi.fn()) {
  const draft = {
    upsert: (id: string, s: RegisteredSource) => void sources.set(id, s),
    remove: (id: string) => void sources.delete(id),
  };
  const view = render(
    <PluginContextProvider registry={createSlotRegistry()} send={send}>
      <SettingsDraftProvider registry={draft}>
        <CurrentPluginLayer pluginId="flows">
          <FlowsSettings />
        </CurrentPluginLayer>
      </SettingsDraftProvider>
    </PluginContextProvider>,
  );
  return { ...view, send };
}

describe("FlowsSettings", () => {
  it("renders a kit switch (no native checkbox) with a short label and the protected testid", () => {
    const { container } = renderSettings(new Map());
    expect(container.querySelector("input[type='checkbox']")).toBeNull();
    const sw = screen.getByTestId("flows-edit-mode-toggle");
    expect(sw.getAttribute("role")).toBe("switch");
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("switch", { name: "Edit mode" })).toBe(sw);
    // label and description are no longer jammed together with an em dash
    expect(container.textContent).not.toContain(" — ");
    expect(container.querySelector("code")?.textContent).toBe("flow_agents");
    expect(container.innerHTML).not.toMatch(/--text-muted|--text-tertiary/);
  });

  it("toggling marks plugin:flows dirty; commit writes { editFlow }", async () => {
    const sources = new Map<string, RegisteredSource>();
    const { send } = renderSettings(sources);
    fireEvent.click(screen.getByTestId("flows-edit-mode-toggle"));
    await waitFor(() => expect(sources.get("plugin:flows")?.isDirty).toBe(true));
    await act(async () => {
      await sources.get("plugin:flows")?.commit();
    });
    expect(send).toHaveBeenCalledWith({ type: "plugin_config_write", id: "flows", config: { editFlow: true } });
  });
});
