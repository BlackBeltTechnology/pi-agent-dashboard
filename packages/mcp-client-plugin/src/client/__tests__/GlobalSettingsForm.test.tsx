/**
 * Global settings form tests (change extract-mcp-client-plugin, task 7.6):
 * schema-driven adapter settings as a host draft source (fallback labels,
 * changed-keys-only commit, no local Save), the Dashboard plugin settings
 * group (`adapterLoadTimeoutMs`, range gate, partial-failure baselines), and
 * read-only disablement.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schemaDoc from "../../../schema/mcp-config.schema.json";
import type { AdapterVerdict } from "../../core/types.js";
import type { EffectiveResponse } from "../api.js";
import { GlobalSettingsForm } from "../GlobalSettingsForm.js";
import { invalidateEffective } from "../hooks.js";

const h = vi.hoisted(() => ({
  send: vi.fn(),
  pluginConfig: {} as Record<string, unknown>,
  source: null as null | { isDirty: boolean; commit: () => Promise<void>; reset: () => void },
}));

vi.mock("@blackbelt-technology/dashboard-plugin-runtime", () => ({
  useT: () => (_k: string, _p?: unknown, f?: string) => f ?? _k,
  usePluginConfig: () => h.pluginConfig,
  usePluginSend: () => h.send,
  useSettingsDraftSource: (source: unknown) => {
    h.source = source as typeof h.source;
  },
}));

const OK: AdapterVerdict = { kind: "ok", installed: "2.21.0", floor: "2.20.0" };

type SettingEntry = {
  value: unknown;
  source: "pi-global" | "shared" | "default";
  path?: string;
};

function view(settings: Record<string, SettingEntry> = {}): EffectiveResponse {
  return { cwd: "", servers: [], settings, layerErrors: [], adapter: OK };
}

function jsonOk(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function jsonErr(status: number, body: unknown): Response {
  return { ok: false, status, json: async () => body } as unknown as Response;
}

/** `/schema` always resolves; every other request goes to `handler`. */
function stubFetch(handler: (url: string, init?: RequestInit) => Response): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes("/schema")) return jsonOk(schemaDoc);
    return handler(String(url), init);
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

function source(): NonNullable<typeof h.source> {
  if (!h.source) throw new Error("no draft source registered");
  return h.source;
}

function isDisabled(testid: string): boolean {
  return (screen.getByTestId(testid) as HTMLInputElement).disabled;
}

async function commit(): Promise<unknown> {
  let failure: unknown = null;
  await act(async () => {
    try {
      await source().commit();
    } catch (e) {
      failure = e;
    }
  });
  return failure;
}

beforeEach(() => {
  h.send = vi.fn().mockResolvedValue(undefined);
  h.pluginConfig = {};
  h.source = null;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  invalidateEffective();
  h.source = null;
});

describe("adapter settings fallbacks", () => {
  it("shows the adapter default for an unset key with no lower layer", async () => {
    stubFetch(() => jsonOk({}));
    render(
      <GlobalSettingsForm
        view={view({ toolPrefix: { value: "server", source: "default" } })}
        readOnly={false}
      />,
    );
    await screen.findByTestId("mcp-setting-toolPrefix");
    expect((screen.getByTestId("mcp-setting-input-toolPrefix") as HTMLSelectElement).value).toBe(
      "server",
    );
    expect(screen.getByTestId("mcp-setting-inherited-toolPrefix").textContent).toContain("default");
  });

  it("shows a shared layer's value labelled with the layer and offers 'use inherited'", async () => {
    stubFetch(() => jsonOk({}));
    render(
      <GlobalSettingsForm
        view={view({
          idleTimeout: { value: 30, source: "shared", path: "/team/mcp.json" },
        })}
        readOnly={false}
      />,
    );
    await screen.findByTestId("mcp-setting-idleTimeout");
    expect((screen.getByTestId("mcp-setting-input-idleTimeout") as HTMLInputElement).value).toBe(
      "30",
    );
    expect(screen.getByTestId("mcp-setting-inherited-idleTimeout").textContent).toContain(
      "/team/mcp.json",
    );
    expect(screen.getByTestId("mcp-setting-clear-idleTimeout").textContent).toBe("use inherited");
  });
});

describe("draft source lifecycle", () => {
  it("tracks dirtiness and reports clean after a successful commit", async () => {
    stubFetch(() => jsonOk({}));
    render(<GlobalSettingsForm view={view()} readOnly={false} />);
    await screen.findByTestId("mcp-setting-showStatusIcon");
    expect(source().isDirty).toBe(false);

    fireEvent.click(screen.getByTestId("mcp-setting-input-showStatusIcon"));
    await waitFor(() => expect(source().isDirty).toBe(true));

    await commit();
    await waitFor(() => expect(source().isDirty).toBe(false));
  });
});

describe("changed-keys-only commit", () => {
  it("issues exactly one settings PUT for a changed adapter setting", async () => {
    const fetchMock = stubFetch(() => jsonOk({}));
    render(<GlobalSettingsForm view={view()} readOnly={false} />);
    await screen.findByTestId("mcp-setting-showStatusIcon");

    fireEvent.click(screen.getByTestId("mcp-setting-input-showStatusIcon"));
    await commit();

    const puts = fetchMock.mock.calls.filter(([u, init]) => {
      return String(u).includes("/settings") && (init as RequestInit | undefined)?.method === "PUT";
    });
    expect(puts).toHaveLength(1);
    expect(JSON.parse(String((puts[0][1] as RequestInit).body))).toEqual({
      set: { showStatusIcon: true },
      unset: [],
    });
    expect(h.send).not.toHaveBeenCalled();
  });

  it("writes only the plugin config for a timeout-only change (no settings PUT)", async () => {
    const fetchMock = stubFetch(() => jsonOk({}));
    render(<GlobalSettingsForm view={view()} readOnly={false} />);
    await screen.findByTestId("mcp-adapter-timeout");

    fireEvent.change(screen.getByTestId("mcp-adapter-timeout"), { target: { value: "2500" } });
    await commit();

    expect(
      fetchMock.mock.calls.filter(([u]) => String(u).includes("/settings")),
    ).toHaveLength(0);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send).toHaveBeenCalledWith({
      type: "plugin_config_write",
      id: "mcp-client",
      config: { adapterLoadTimeoutMs: 2500 },
    });
  });
});

describe("timeout range gate", () => {
  it("flags an out-of-range value inline and refuses to commit without any write", async () => {
    const fetchMock = stubFetch(() => jsonOk({}));
    render(<GlobalSettingsForm view={view()} readOnly={false} />);
    await screen.findByTestId("mcp-adapter-timeout");

    fireEvent.change(screen.getByTestId("mcp-adapter-timeout"), { target: { value: "500" } });
    expect(screen.getByTestId("mcp-plugin-error").textContent).toContain("1000");

    const failure = await commit();
    expect(failure).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes("/settings"))).toHaveLength(0);
    expect(h.send).not.toHaveBeenCalled();
  });
});

describe("partial failure", () => {
  it("advances the plugin baseline and keeps the source dirty with the adapter error only", async () => {
    stubFetch((url) =>
      url.includes("/settings")
        ? jsonErr(400, { error: "unparseable", message: "target is unparseable" })
        : jsonOk({}),
    );
    render(<GlobalSettingsForm view={view()} readOnly={false} />);
    await screen.findByTestId("mcp-setting-showStatusIcon");

    fireEvent.change(screen.getByTestId("mcp-adapter-timeout"), { target: { value: "2500" } });
    fireEvent.click(screen.getByTestId("mcp-setting-input-showStatusIcon"));
    const failure = await commit();

    expect(failure).toBeTruthy();
    expect(screen.getByTestId("mcp-adapter-settings-error")).toBeTruthy();
    expect(screen.queryByTestId("mcp-plugin-error")).toBeNull();
    await waitFor(() => expect(source().isDirty).toBe(true));
    expect(h.send).toHaveBeenCalledTimes(1);

    // The plugin baseline advanced: a retry does not re-issue the plugin write.
    await commit();
    expect(h.send).toHaveBeenCalledTimes(1);
  });
});

describe("dashboard plugin settings group", () => {
  it("renders the timeout field with the stable id the 7.2 notice links to", async () => {
    stubFetch(() => jsonOk({}));
    render(<GlobalSettingsForm view={view()} readOnly={false} />);
    await screen.findByTestId("mcp-adapter-timeout");
    expect(document.getElementById("mcp-adapter-timeout")).not.toBeNull();
  });

  it("disables every input and the clear action when read-only", async () => {
    stubFetch(() => jsonOk({}));
    render(
      <GlobalSettingsForm
        view={view({ idleTimeout: { value: 30, source: "shared", path: "/team/mcp.json" } })}
        readOnly
      />,
    );
    await screen.findByTestId("mcp-setting-idleTimeout");
    expect(isDisabled("mcp-adapter-timeout")).toBe(true);
    expect(isDisabled("mcp-setting-input-idleTimeout")).toBe(true);
    expect(isDisabled("mcp-setting-clear-idleTimeout")).toBe(true);
  });
});
