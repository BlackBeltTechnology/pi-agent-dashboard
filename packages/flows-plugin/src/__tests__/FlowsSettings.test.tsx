/**
 * FlowsSettings (settings consistency wave 2): kit switch with a short label and
 * a `t()` hint, no native checkbox; draft id `plugin:flows` commits via
 * `PUT /api/plugins/flows/edit-mode-default` (global pi settings), never
 * `plugin_config_write`. See change: retro-ux-plugin-settings-wave-2;
 * stop-flows-edit-mode-project-writes (D2; test-plan #F8, #X1).
 */
import { CurrentPluginLayer, createSlotRegistry, PluginContextProvider, type RegisteredSource, SettingsDraftProvider } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlowsSettings } from "../client/FlowsSettings.js";

type Reply = { status: number; body: unknown };
let getReply: Reply;
let putReply: Reply;
const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
  const r = init?.method === "PUT" ? putReply : getReply;
  return new Response(JSON.stringify(r.body), { status: r.status });
});
beforeEach(() => {
  getReply = { status: 200, body: { enabled: false } };
  putReply = { status: 200, body: { enabled: true } };
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const puts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT");

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

  it("toggling marks plugin:flows dirty; commit PUTs { enabled } once, no plugin_config_write (#F8)", async () => {
    const sources = new Map<string, RegisteredSource>();
    const { send } = renderSettings(sources);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/plugins/flows/edit-mode-default"));
    fireEvent.click(screen.getByTestId("flows-edit-mode-toggle"));
    await waitFor(() => expect(sources.get("plugin:flows")?.isDirty).toBe(true));
    await act(async () => {
      await sources.get("plugin:flows")?.commit();
    });
    expect(puts()).toHaveLength(1);
    expect(puts()[0][0]).toBe("/api/plugins/flows/edit-mode-default");
    expect(JSON.parse(String(puts()[0][1]?.body))).toEqual({ enabled: true });
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "plugin_config_write" }));
    await waitFor(() => expect(sources.get("plugin:flows")?.isDirty).toBe(false));
  });

  it("shows the global value from GET", async () => {
    getReply = { status: 200, body: { enabled: true } };
    renderSettings(new Map());
    await waitFor(() => expect(screen.getByTestId("flows-edit-mode-toggle").getAttribute("aria-checked")).toBe("true"));
  });

  it("a 400 parseError rejects the commit and is shown in the section (#X1)", async () => {
    putReply = { status: 400, body: { error: "unparseable settings", parseError: "Invalid JSON at line 1, column 10" } };
    const sources = new Map<string, RegisteredSource>();
    renderSettings(sources);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("flows-edit-mode-toggle"));
    await waitFor(() => expect(sources.get("plugin:flows")?.isDirty).toBe(true));
    await act(async () => {
      await expect(sources.get("plugin:flows")?.commit()).rejects.toThrow(/Invalid JSON/);
    });
    expect(screen.getByTestId("flows-edit-mode-error").textContent).toContain("Invalid JSON at line 1, column 10");
    expect(sources.get("plugin:flows")?.isDirty).toBe(true);
  });
});
