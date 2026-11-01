/**
 * FlowsSettings (settings consistency wave 2): kit switch with a short label and
 * a `t()` hint, no native checkbox; draft id `plugin:flows` commits via
 * `PUT /api/plugins/flows/edit-mode-default` (global pi settings), never
 * `plugin_config_write`. See change: retro-ux-plugin-settings-wave-2;
 * stop-flows-edit-mode-project-writes (D2; test-plan #F8, #X1).
 */
import { CurrentPluginLayer, createSlotRegistry, initPluginConfigs, PluginContextProvider, type RegisteredSource, SettingsDraftProvider } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readCatalogTimings } from "../catalog-timings.js";
import { FlowsSettings } from "../client/FlowsSettings.js";
import { registerFlowCatalog } from "../server/flow-catalog.js";

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

// ── Catalog timings (Advanced) ───────────────────────────────────────────────
// See change: flows-dock-chip-and-panel-actions (test-plan E30–E33).
describe("catalog timing settings", () => {
  const configWrites = (send: ReturnType<typeof vi.fn>) =>
    send.mock.calls.map(([m]) => m as { type: string; config?: Record<string, unknown> }).filter((m) => m.type === "plugin_config_write");
  beforeEach(() => initPluginConfigs({ flows: {} }));

  async function save(key: string, value: number) {
    const sources = new Map<string, RegisteredSource>();
    const { send } = renderSettings(sources);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.change(screen.getByTestId(`flows-timing-${key}`), { target: { value: String(value) } });
    await waitFor(() => expect(sources.get("plugin:flows")?.isDirty).toBe(true));
    let error: unknown = null;
    await act(async () => {
      try {
        await sources.get("plugin:flows")?.commit();
      } catch (e) {
        error = e;
      }
    });
    return { send, error: error as Error | null };
  }

  it.each([
    [0, false],
    [1, true],
    [60, true],
    [61, false],
  ])("E30: re-ask attempts %s → accepted=%s (range 1–60)", async (value, ok) => {
    const { send, error } = await save("catalogReaskAttempts", value);
    if (ok) {
      expect(error).toBeNull();
      expect(configWrites(send)).toEqual([{ type: "plugin_config_write", id: "flows", config: { catalogReaskAttempts: value } }]);
    } else {
      expect(error?.message).toContain("1–60");
      expect(screen.getByText("Enter a value in 1–60.")).toBeTruthy();
      expect(configWrites(send)).toHaveLength(0);
    }
    expect(puts()).toHaveLength(0);
  });

  it.each([
    [0.4, false],
    [0.5, true],
    [60, true],
    [61, false],
  ])("E31: ask limit %s s → accepted=%s (range 0.5–60 s)", async (value, ok) => {
    const { send, error } = await save("catalogAskLimitSec", value);
    if (ok) {
      expect(error).toBeNull();
      expect(configWrites(send)[0]?.config).toEqual({ catalogAskLimitSec: value });
    } else {
      expect(error?.message).toContain("0.5–60 s");
      expect(configWrites(send)).toHaveLength(0);
    }
  });

  it("E32: no stored values → defaults (ask limit 2 s, re-ask 5 s × 12, server start 5 s × 60 s)", () => {
    expect(readCatalogTimings({})).toEqual({
      askLimitMs: 2_000,
      reaskIntervalMs: 5_000,
      reaskAttempts: 12,
      serverStartIntervalMs: 5_000,
      serverStartWindowMs: 60_000,
    });
    // An out-of-range stored value falls back to its default rather than applying.
    expect(readCatalogTimings({ catalogReaskAttempts: 0 }).reaskAttempts).toBe(12);
    renderSettings(new Map());
    expect((screen.getByTestId("flows-timing-catalogAskLimitSec") as HTMLInputElement).value).toBe("2");
    expect((screen.getByTestId("flows-timing-catalogReaskAttempts") as HTMLInputElement).value).toBe("12");
  });

  it("E33: a saved ask limit applies to the server without restart", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      const config: Record<string, unknown> = {};
      const emit = vi.fn(() => true);
      const ctl = registerFlowCatalog({
        onEvent: () => () => {},
        sessionManager: { listActive: () => [] },
        emitEventToSession: emit,
        getPluginConfig: () => config,
        store: { getState: () => undefined, setFlows: () => {}, clearSession: () => {} },
      });
      ctl.requestCatalog("S");
      config.catalogAskLimitSec = 10; // the save
      vi.setSystemTime(5_000);
      ctl.requestCatalog("S");
      expect(emit).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
