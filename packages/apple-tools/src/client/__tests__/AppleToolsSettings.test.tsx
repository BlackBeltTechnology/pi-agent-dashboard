// @vitest-environment jsdom
/**
 * AppleToolsSettings (changes extract-mcp-client-plugin task 5.4,
 * retro-ux-plugin-settings-wave-2 tasks 4.1–4.4): the panel mounts while the
 * plugin is `enabled: true, loaded: false`, hides [Run installer] when the plugin
 * reports a missing `dependsOn`, links to the mcp-client manager, shows the
 * provisioning state as a word pill, and holds the path override as a draft on
 * the host Save bar (`plugin:apple-tools`) that commits only `imcpServerPath`.
 *
 * Harness mirrors `cost-estimator/src/client/__tests__/CostSettings.test.tsx`.
 */
import { applyPluginConfigUpdate, CurrentPluginLayer, createSlotRegistry, PluginContextProvider, type RegisteredSource, SettingsDraftProvider, type SettingsDraftRegistry } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppleToolsSettings } from "../AppleToolsSettings.js";

const DEFAULT_PATH = "/Applications/iMCP.app/Contents/MacOS/imcp-server";

function mount(config: Record<string, unknown> = {}) {
  const sources = new Map<string, RegisteredSource>();
  const registry: SettingsDraftRegistry = {
    upsert: (id, s) => sources.set(id, s),
    remove: (id) => {
      sources.delete(id);
    },
  };
  const send = vi.fn<(m: unknown) => Promise<void>>(() => Promise.resolve());
  act(() => {
    applyPluginConfigUpdate({ type: "plugin_config_update", id: "apple-tools", config });
  });
  const r = render(
    <SettingsDraftProvider registry={registry}>
      <PluginContextProvider registry={createSlotRegistry()} sessions={[]} send={send}>
        <CurrentPluginLayer pluginId="apple-tools">
          <AppleToolsSettings />
        </CurrentPluginLayer>
      </PluginContextProvider>
    </SettingsDraftProvider>,
  );
  const src = (): RegisteredSource => {
    const s = sources.get("plugin:apple-tools");
    if (!s) throw new Error("plugin:apple-tools never registered with the unified-Save registry");
    return s;
  };
  return { ...r, src, send };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function jsonOk(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

interface StatusOpts {
  state?: string;
  message?: string;
  platform?: string;
  appPresent?: boolean;
}

/** `/api/plugins` row + status mock. The plugin row is `enabled: true,
 *  loaded: false` — the state a `dependsOn` gap produces. */
function fetchFor(
  opts: { missingDeps?: string[]; status?: StatusOpts | "pending" | "http-404" } = {},
): ReturnType<typeof vi.fn> {
  return vi.fn((url: string) => {
    const u = String(url);
    if (u.includes("/api/plugins")) {
      return Promise.resolve(
        jsonOk({
          success: true,
          plugins: [
            {
              id: "apple-tools",
              status: { id: "apple-tools", enabled: true, loaded: false, missingDeps: opts.missingDeps ?? [] },
            },
          ],
        }),
      );
    }
    if (u.includes("/api/apple-tools/status")) {
      if (opts.status === "pending") return new Promise<Response>(() => {});
      if (opts.status === "http-404") {
        return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as unknown as Response);
      }
      const s = opts.status ?? {};
      return Promise.resolve(
        jsonOk({
          platform: s.platform ?? "darwin",
          state: s.state ?? "READY_PENDING_GRANTS",
          message: s.message ?? "provisioned",
          imcpServerPath: DEFAULT_PATH,
          appPresent: s.appPresent ?? true,
        }),
      );
    }
    return Promise.resolve(jsonOk({}));
  });
}

function setFetch(f: ReturnType<typeof vi.fn>): void {
  (globalThis as { fetch?: unknown }).fetch = f;
}

describe("AppleToolsSettings", () => {
  it("missing mcp-client dependency → banner + Enable link, no Run installer", async () => {
    setFetch(fetchFor({ missingDeps: ["mcp-client"] }));
    const { getByTestId, queryByTestId } = mount();
    await waitFor(() => expect(getByTestId("apple-tools-missing-deps")).toBeTruthy());
    const banner = getByTestId("apple-tools-missing-deps");
    expect(banner.textContent).toContain("mcp-client");
    expect(banner.querySelector("a")?.getAttribute("href")).toBe("/settings/plugins");
    expect(queryByTestId("apple-tools-run-installer")).toBeNull();
    // The section still mounts (enabled, not loaded).
    expect(getByTestId("apple-tools-settings")).toBeTruthy();
  });

  it("dependency satisfied + iMCP present → Run installer, no banner", async () => {
    setFetch(fetchFor({ missingDeps: [] }));
    const { getByTestId, queryByTestId } = mount();
    await waitFor(() => expect(getByTestId("apple-tools-run-installer")).toBeTruthy());
    expect(queryByTestId("apple-tools-missing-deps")).toBeNull();
  });

  it("links to the mcp-client plugin for enable/disable + direct tools", async () => {
    setFetch(fetchFor());
    const { getByTestId } = mount();
    await waitFor(() => expect(getByTestId("apple-tools-manage-mcp")).toBeTruthy());
    expect(getByTestId("apple-tools-manage-mcp").getAttribute("href")).toBe("/settings/plugins/mcp-client");
    expect(getByTestId("apple-tools-manage-mcp").textContent).toContain("Manage MCP servers");
  });

  // test-plan #E7: the host owns identity; the body repeats neither name nor id.
  it("E7: no 'Apple Tools' heading and no `apple-tools` body text", async () => {
    setFetch(fetchFor());
    const { getByTestId, container } = mount();
    await waitFor(() => expect(getByTestId("apple-tools-status").textContent).toBe("Installed"));
    for (const h of Array.from(container.querySelectorAll("h1,h2,h3,h4,h5,h6"))) {
      expect(h.textContent ?? "").not.toMatch(/Apple Tools/);
    }
    expect(container.textContent ?? "").not.toContain("Apple Tools");
    expect(container.textContent ?? "").not.toContain("apple-tools");
  });
});

// test-plan #E14: state × appPresent → pill word.
describe("AppleToolsSettings — state pill decision table (E14)", () => {
  const cases: {
    name: string;
    status: StatusOpts;
    pill: string;
    tone: string;
    raw: string;
    notice: boolean;
  }[] = [
    { name: "pending-grants, app absent", status: { appPresent: false }, pill: "Not installed", tone: "neutral", raw: "READY_PENDING_GRANTS", notice: true },
    { name: "pending-grants, app present", status: { appPresent: true }, pill: "Installed", tone: "success", raw: "READY_PENDING_GRANTS", notice: true },
    { name: "no install method wins over absent app", status: { state: "NO_INSTALL_METHOD", appPresent: false }, pill: "Can't install automatically", tone: "warning", raw: "NO_INSTALL_METHOD", notice: true },
    { name: "OS too old", status: { state: "OS_TOO_OLD", message: "macOS 14.6.1 is below the minimum supported 15.3. Please upgrade." }, pill: "macOS too old", tone: "warning", raw: "OS_TOO_OLD", notice: true },
    { name: "OS version unknown", status: { state: "OS_VERSION_UNKNOWN" }, pill: "macOS version unknown", tone: "warning", raw: "OS_VERSION_UNKNOWN", notice: true },
    { name: "unsupported platform", status: { state: "UNSUPPORTED_PLATFORM", platform: "linux" }, pill: "Unsupported platform", tone: "neutral", raw: "UNSUPPORTED_PLATFORM", notice: true },
    { name: "install failed", status: { state: "INSTALL_FAILED" }, pill: "Install failed", tone: "error", raw: "INSTALL_FAILED", notice: true },
    { name: "config unreadable", status: { state: "CONFIG_UNPARSEABLE" }, pill: "Config unreadable", tone: "error", raw: "CONFIG_UNPARSEABLE", notice: true },
    { name: "config not saved", status: { state: "CONFIG_WRITE_FAILED" }, pill: "Config not saved", tone: "error", raw: "CONFIG_WRITE_FAILED", notice: true },
  ];

  for (const c of cases) {
    it(`${c.name} → "${c.pill}", no raw token, fix-naming notice`, async () => {
      setFetch(fetchFor({ status: c.status }));
      const { getByTestId, queryByTestId, container } = mount();
      await waitFor(() => expect(getByTestId("apple-tools-status").textContent).toBe(c.pill));
      const pill = getByTestId("apple-tools-status");
      expect(pill.getAttribute("data-tone")).toBe(c.tone);
      expect(container.textContent ?? "").not.toContain(c.raw);
      expect(container.textContent ?? "").not.toContain("Ready");
      const notice = c.pill === "Unsupported platform" ? "apple-tools-unsupported" : c.pill === "Not installed" ? "apple-tools-needs-cli" : "apple-tools-notice";
      expect(queryByTestId(notice)).not.toBeNull();
    });
  }

  it("macOS too old names the minimum, the running version and the fix; no token", async () => {
    setFetch(
      fetchFor({
        status: { state: "OS_TOO_OLD", message: "macOS 14.6.1 is below the minimum supported 15.3. Please upgrade." },
      }),
    );
    const { getByTestId, container } = mount();
    await waitFor(() => expect(getByTestId("apple-tools-notice")).toBeTruthy());
    const n = getByTestId("apple-tools-notice");
    expect(n.getAttribute("data-tone")).toBe("warning");
    expect(n.textContent).toContain("macOS 15.3 or later");
    expect(n.textContent).toContain("14.6.1");
    expect(n.textContent?.toLowerCase()).toContain("update macos");
    expect(container.textContent).not.toContain("OS_TOO_OLD");
  });

  it("Not installed → info notice naming the command with Copy command + Check again", async () => {
    setFetch(fetchFor({ status: { appPresent: false } }));
    const { getByTestId, getByText, queryByTestId } = mount();
    await waitFor(() => expect(getByTestId("apple-tools-needs-cli")).toBeTruthy());
    const n = getByTestId("apple-tools-needs-cli");
    expect(n.getAttribute("data-tone")).toBe("info");
    expect(n.querySelector("code")?.textContent).toBe("pi-apple-tools-install");
    expect(n.textContent).not.toContain("`");
    expect(getByText("Copy command")).toBeTruthy();
    expect(getByText("Check again")).toBeTruthy();
    expect(queryByTestId("apple-tools-run-installer")).toBeNull();
  });

  it("Installed → info notice naming the menu-bar step; permissions guidance stays visible", async () => {
    setFetch(fetchFor({ status: { appPresent: true } }));
    const { getByTestId, container } = mount();
    await waitFor(() => expect(getByTestId("apple-tools-notice")).toBeTruthy());
    expect(getByTestId("apple-tools-notice").getAttribute("data-tone")).toBe("info");
    expect(getByTestId("apple-tools-notice").textContent).toMatch(/Calendar, Contacts/);
    expect(container.textContent).toMatch(/menu-bar app/);
    expect(container.textContent).toMatch(/cannot (change|do)/);
  });

  it("Checking while the request is pending → info pill, no run-installer", async () => {
    setFetch(fetchFor({ status: "pending" }));
    const { getByTestId, queryByTestId } = mount();
    expect(getByTestId("apple-tools-status").textContent).toBe("Checking");
    expect(getByTestId("apple-tools-status").getAttribute("data-tone")).toBe("info");
    expect(queryByTestId("apple-tools-run-installer")).toBeNull();
  });
});

describe("AppleToolsSettings — path draft on the host Save bar", () => {
  it("shows Default pill and no Reset on the default path; Reset restores into the draft", async () => {
    setFetch(fetchFor());
    const { getByTestId, queryByText, getByText, src } = mount({});
    const input = getByTestId("apple-tools-path") as HTMLInputElement;
    expect(input.value).toBe(DEFAULT_PATH);
    expect(getByText("Default")).toBeTruthy();
    expect(queryByText("Reset to default")).toBeNull();
    fireEvent.change(input, { target: { value: "/opt/imcp-server" } });
    await waitFor(() => expect(src().isDirty).toBe(true));
    fireEvent.click(getByText("Reset to default"));
    await waitFor(() => expect((getByTestId("apple-tools-path") as HTMLInputElement).value).toBe(DEFAULT_PATH));
    await waitFor(() => expect(src().isDirty).toBe(false));
  });

  it("blur writes nothing; editing marks the draft dirty", async () => {
    setFetch(fetchFor());
    const { getByTestId, send, src } = mount({});
    const input = getByTestId("apple-tools-path");
    fireEvent.change(input, { target: { value: "/opt/imcp-server" } });
    fireEvent.blur(input);
    expect(send).not.toHaveBeenCalled();
    await waitFor(() => expect(src().isDirty).toBe(true));
  });

  // test-plan #F2
  it("F2: commit sends only imcpServerPath; a broadcast discoveredAt is adopted, not overwritten", async () => {
    setFetch(fetchFor());
    const { getByTestId, send, src } = mount({ imcpServerPath: "/old/imcp-server" });
    fireEvent.change(getByTestId("apple-tools-path"), { target: { value: "/new/imcp-server" } });
    await waitFor(() => expect(src().isDirty).toBe(true));
    act(() => {
      applyPluginConfigUpdate({
        type: "plugin_config_update",
        id: "apple-tools",
        config: { imcpServerPath: "/old/imcp-server", discoveredAt: "2026-01-01" },
      });
    });
    // The edited key survives the broadcast.
    expect((getByTestId("apple-tools-path") as HTMLInputElement).value).toBe("/new/imcp-server");
    await src().commit();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toEqual({
      type: "plugin_config_write",
      id: "apple-tools",
      config: { imcpServerPath: "/new/imcp-server" },
    });
    // Server merge keeps the other keys: { ...existing, ...payload }.
    const payload = (send.mock.calls[0][0] as { config: Record<string, unknown> }).config;
    expect({ imcpServerPath: "/old/imcp-server", discoveredAt: "2026-01-01", ...payload }).toEqual({
      imcpServerPath: "/new/imcp-server",
      discoveredAt: "2026-01-01",
    });
  });

  // doubt-review 4.50 #1: an edit typed back to the stored value leaves no ghost
  // draft, so the installer reconciling the path is adopted, not reverted.
  it("an edit typed back to the stored path leaves no ghost: a later broadcast is adopted", async () => {
    setFetch(fetchFor());
    const { getByTestId, src } = mount({ imcpServerPath: "/a/imcp-server" });
    const input = getByTestId("apple-tools-path");
    fireEvent.change(input, { target: { value: "/b/imcp-server" } });
    await waitFor(() => expect(src().isDirty).toBe(true));
    fireEvent.change(input, { target: { value: "/a/imcp-server" } });
    await waitFor(() => expect(src().isDirty).toBe(false));
    act(() => {
      applyPluginConfigUpdate({ type: "plugin_config_update", id: "apple-tools", config: { imcpServerPath: "/c/imcp-server" } });
    });
    await waitFor(() => expect((getByTestId("apple-tools-path") as HTMLInputElement).value).toBe("/c/imcp-server"));
    expect(src().isDirty).toBe(false);
  });

  it("an emptied path shows a field error and blocks the commit", async () => {
    setFetch(fetchFor());
    const { getByTestId, queryByRole, send, src } = mount({});
    fireEvent.change(getByTestId("apple-tools-path"), { target: { value: "" } });
    await waitFor(() => expect(queryByRole("alert")).not.toBeNull());
    await expect(src().commit()).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
});

// test-plan #X3
describe("AppleToolsSettings — status unavailable (X3)", () => {
  it("X3: 404 → human sentence + Try again + Copy details; `404` only in copied text; path field rendered", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const f = fetchFor({ status: "http-404" });
    setFetch(f);
    const { getByTestId, getByText, queryByTestId } = mount();
    await waitFor(() => expect(getByTestId("apple-tools-error")).toBeTruthy());
    const err = getByTestId("apple-tools-error");
    expect(err.textContent).toContain("Could not check iMCP on this Mac. The dashboard server did not answer.");
    expect(err.textContent).not.toContain("404");
    expect(getByText("Try again")).toBeTruthy();
    expect(getByTestId("apple-tools-path")).toBeTruthy();
    expect(queryByTestId("apple-tools-status")).toBeNull();

    fireEvent.click(getByText("Copy details"));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect((writeText.mock.calls[0] as unknown as [string])[0]).toContain("404");

    // Try again recovers.
    setFetch(fetchFor({ status: {} }));
    fireEvent.click(getByText("Try again"));
    await waitFor(() => expect(queryByTestId("apple-tools-error")).toBeNull());
    expect(getByTestId("apple-tools-status").textContent).toBe("Installed");
  });
});

describe("AppleToolsSettings — run installer feedback", () => {
  it("busy while it runs, then a result notice", async () => {
    // present app + a state that offers the installer
    setFetch(fetchFor({ status: { state: "INSTALL_FAILED", appPresent: true } }));
    const { getByTestId, send } = mount();
    await waitFor(() => expect(getByTestId("apple-tools-run-installer")).toBeTruthy());
    fireEvent.click(getByTestId("apple-tools-run-installer"));
    await waitFor(() => expect((getByTestId("apple-tools-run-installer") as HTMLButtonElement).disabled).toBe(true));
    expect(send.mock.calls[0][0]).toMatchObject({ type: "plugin_action", action: "run-installer" });
    await waitFor(() => expect(getByTestId("apple-tools-install-result")).toBeTruthy(), { timeout: 3000 });
    expect((getByTestId("apple-tools-run-installer") as HTMLButtonElement).disabled).toBe(false);
  });
});
