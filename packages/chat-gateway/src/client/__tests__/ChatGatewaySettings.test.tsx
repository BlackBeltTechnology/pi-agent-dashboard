// @vitest-environment jsdom
/**
 * ChatGatewaySettings (task 10.1) — renders the config fields and persists a
 * partial write through the HOST Save bar (a `plugin:chat-gateway` draft
 * source). Asserts the TOKEN safety invariants: a blank token field never
 * sends `token`, and a typed token never reaches a notice or "Copy details".
 *
 * See change: add-chat-gateway; retro-ux-plugin-settings-wave-2 (design D4).
 */
import {
  type RegisteredSource,
  SettingsDraftProvider,
  type SettingsDraftRegistry,
} from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.fn((_msg: unknown): Promise<void> => Promise.resolve());
let configValue: Record<string, unknown> = {};

vi.mock("@blackbelt-technology/dashboard-plugin-runtime/context", async (importOriginal) => ({
  // Keep the real module (the settings kit reads `useRuntimeT` from it) and
  // override only the hooks this suite drives.
  ...(await importOriginal<Record<string, unknown>>()),
  usePluginConfig: () => configValue,
  usePluginSend: () => sendMock,
  // The nested TeamControlsPanel subscribes to its own message types; a no-op
  // keeps this suite focused on the config fields it owns.
  usePluginMessage: () => {},
}));

import { ChatGatewaySettings } from "../ChatGatewaySettings.js";

const SOURCE_ID = "plugin:chat-gateway";
const sources = new Map<string, RegisteredSource>();
const registry: SettingsDraftRegistry = {
  upsert: (id, src) => sources.set(id, src),
  remove: (id) => {
    sources.delete(id);
  },
};

function ui() {
  return (
    <SettingsDraftProvider registry={registry}>
      <ChatGatewaySettings pluginContext={{} as never} />
    </SettingsDraftProvider>
  );
}

function renderPanel() {
  return render(ui());
}

const source = () => sources.get(SOURCE_ID) as RegisteredSource;

/** The host's Save click: run the registered source's `commit`. */
async function hostSave(): Promise<void> {
  await act(async () => {
    await source().commit();
  });
}

/**
 * Only the config-PERSISTENCE sends. The nested team-controls panel also asks
 * for its surface on mount, so a total call count is no longer one-to-one with
 * a config write.
 */
function configWrites(): Array<{ type?: string; id?: string; config: Record<string, unknown> }> {
  return sendMock.mock.calls
    .map((c) => c[0] as { type?: string; id?: string; config: Record<string, unknown> })
    .filter((m) => m?.type === "plugin_config_write");
}

function type(testId: string, value: string) {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

beforeEach(() => {
  sendMock.mockClear();
  sendMock.mockImplementation(() => Promise.resolve());
  sources.clear();
  configValue = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, status: 404 }) as unknown as Response),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ChatGatewaySettings (10.1)", () => {
  it("renders the config fields from the plugin config and no Save button of its own", () => {
    configValue = { allowedRoots: ["/repos"], allowlist: ["u1"] };
    renderPanel();
    expect(screen.getByTestId("chat-gateway-allowed-roots")).toBeTruthy();
    expect((screen.getByTestId("chat-gateway-allowlist") as HTMLInputElement).value).toBe("u1");
    expect(screen.getByTestId("chat-gateway-admins")).toBeTruthy();
    // test-plan #F4: the Save moved to the host bar.
    expect(screen.queryByTestId("chat-gateway-save")).toBeNull();
    expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();
  });

  it("persists an edited list and NEVER sends a blank token", async () => {
    configValue = { allowlist: ["u1"] };
    renderPanel();
    type("chat-gateway-allowlist", "u1, u2");
    await hostSave();

    expect(configWrites()).toHaveLength(1);
    const msg = configWrites()[0];
    expect(msg.type).toBe("plugin_config_write");
    expect(msg.id).toBe("chat-gateway");
    expect(msg.config.allowlist).toEqual(["u1", "u2"]);
    expect(msg.config).not.toHaveProperty("token");
  });

  it("sends the token ONLY when the operator typed one", async () => {
    renderPanel();
    type("chat-gateway-token", "  bot-secret  ");
    await hostSave();

    expect(configWrites()).toHaveLength(1);
    expect(configWrites()[0].config.token).toBe("bot-secret");
  });

  it("parses the fixed map from channelKey=cwd lines", async () => {
    renderPanel();
    type("chat-gateway-fixed-map", "discord:c1:-=/repos/proj\ndiscord:c2:-=/repos/other");
    await hostSave();

    expect(configWrites()).toHaveLength(1);
    expect(configWrites()[0].config.fixedMap).toEqual({
      "discord:c1:-": "/repos/proj",
      "discord:c2:-": "/repos/other",
    });
  });

  it("sends only the keys the operator edited (server merges the rest)", async () => {
    configValue = { allowedRoots: ["/repos"], steerPrefix: "!", teamControls: { disarmed: true } };
    renderPanel();
    type("chat-gateway-default-cwd", "/repos/app");
    await hostSave();

    expect(configWrites()).toHaveLength(1);
    expect(configWrites()[0].config).toEqual({ defaultCwd: "/repos/app" });
  });
});

describe("kit adoption + naming (#E6, #E8)", () => {
  it("uses kit switches, no native checkbox, and names the master switch for what it does", () => {
    renderPanel();
    expect(document.querySelectorAll('input[type="checkbox"]').length).toBe(0);
    expect(document.querySelectorAll("select").length).toBe(1); // the kit SelectField only
    expect(screen.getByRole("switch", { name: "Answer Discord messages" })).toBeTruthy();
    // protected testids stay on the controls
    for (const id of [
      "chat-gateway-enabled",
      "chat-gateway-thread-per-conversation",
      "chat-gateway-mirror-dashboard-sessions",
    ]) {
      expect(screen.getByTestId(id).getAttribute("role")).toBe("switch");
    }
    expect(screen.queryByRole("switch", { name: /^(enabled?|on)$/i })).toBeNull();
  });

  it("does not repeat the plugin name or id as a heading in the body", () => {
    renderPanel();
    const body = screen.getByTestId("chat-gateway-settings");
    expect(body.querySelector("h1,h2,h3")).toBeNull();
    expect(body.textContent).not.toMatch(/Chat Gateway/);
  });
});

describe("map-line validation (#E9)", () => {
  it("names the bad line, marks the field invalid and refuses to commit", async () => {
    renderPanel();
    type("chat-gateway-fixed-map", "discord:1:-=/a\ndiscord:2 /b");

    const field = screen.getByTestId("chat-gateway-fixed-map");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    const alert = screen.getAllByRole("alert").find((a) => /Line 2/.test(a.textContent ?? ""));
    expect(alert).toBeTruthy();
    expect(alert?.textContent).not.toMatch(/Line 1/);

    await expect(act(async () => source().commit())).rejects.toThrow();
    expect(configWrites()).toHaveLength(0);
  });

  it("is valid again once every line has the channelKey=folder shape", () => {
    renderPanel();
    type("chat-gateway-fixed-map", "discord:1:-=/a\ndiscord:2 /b");
    type("chat-gateway-fixed-map", "discord:1:-=/a\ndiscord:2:-=/b");
    expect(screen.getByTestId("chat-gateway-fixed-map").getAttribute("aria-invalid")).toBeNull();
  });
});

describe("empty allowed folders (#E10)", () => {
  it("warns that no session can start, without a field error, and still allows the commit", async () => {
    configValue = { allowedRoots: ["/repos"] };
    renderPanel();
    type("chat-gateway-allowed-roots", "");

    const warning = screen.getByTestId("chat-gateway-allowed-roots-warning");
    expect(warning.getAttribute("data-tone")).toBe("warning");
    expect(warning.textContent).toMatch(/no session can start/i);
    expect(screen.getByTestId("chat-gateway-allowed-roots").getAttribute("aria-invalid")).toBeNull();

    await hostSave();
    expect(configWrites()).toHaveLength(1);
    expect(configWrites()[0].config.allowedRoots).toEqual([]);
  });
});

describe("host Save bar (#F4)", () => {
  it("marks plugin:chat-gateway dirty on edit and writes once on host Save", async () => {
    renderPanel();
    await waitFor(() => expect(sources.has(SOURCE_ID)).toBe(true));
    expect(source().isDirty).toBe(false);

    type("chat-gateway-default-cwd", "/repos/app");
    await waitFor(() => expect(source().isDirty).toBe(true));

    await hostSave();
    expect(configWrites()).toHaveLength(1);
    expect(configWrites()[0].config.defaultCwd).toBe("/repos/app");
  });

  it("goes clean again after a successful commit", async () => {
    renderPanel();
    type("chat-gateway-default-cwd", "/repos/app");
    await hostSave();
    await waitFor(() => expect(source().isDirty).toBe(false));
  });

  // doubt-review 4.50 #2: the saved value stays on screen even when the
  // `plugin_config_update` broadcast has not arrived (no revert-to-old flash).
  it("keeps showing the saved value when no broadcast follows the commit", async () => {
    configValue = { defaultCwd: "/old" };
    renderPanel();
    type("chat-gateway-default-cwd", "/repos/app");
    await hostSave();
    await waitFor(() => expect(source().isDirty).toBe(false));
    expect((screen.getByTestId("chat-gateway-default-cwd") as HTMLInputElement).value).toBe("/repos/app");
  });
});

describe("broadcast adoption (#F3)", () => {
  it("a clean page adopts a plugin_config_update for its keys", () => {
    configValue = { steerPrefix: "!", defaultCwd: "/a" };
    const view = renderPanel();
    configValue = { steerPrefix: "$", defaultCwd: "/b" };
    view.rerender(ui());
    expect((screen.getByTestId("chat-gateway-steer-prefix") as HTMLInputElement).value).toBe("$");
    expect((screen.getByTestId("chat-gateway-default-cwd") as HTMLInputElement).value).toBe("/b");
  });

  it("a dirty page keeps the edited key and adopts the others", () => {
    configValue = { steerPrefix: "!", defaultCwd: "/a" };
    const view = renderPanel();
    type("chat-gateway-steer-prefix", "?");
    configValue = { steerPrefix: "$", defaultCwd: "/b" };
    view.rerender(ui());
    expect((screen.getByTestId("chat-gateway-steer-prefix") as HTMLInputElement).value).toBe("?");
    expect((screen.getByTestId("chat-gateway-default-cwd") as HTMLInputElement).value).toBe("/b");
  });
});

describe("bot token handling (#F6, #X10)", () => {
  let writeText: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  });

  it("Discard clears a typed token; a later commit omits it", async () => {
    renderPanel();
    type("chat-gateway-token", "abc");
    await waitFor(() => expect(source().isDirty).toBe(true));

    act(() => source().reset());
    expect((screen.getByTestId("chat-gateway-token") as HTMLInputElement).value).toBe("");
    await waitFor(() => expect(source().isDirty).toBe(false));

    type("chat-gateway-steer-prefix", "?");
    await hostSave();
    expect(configWrites()).toHaveLength(1);
    expect(configWrites()[0].config).not.toHaveProperty("token");
  });

  it("clears the typed token from the field after a successful commit", async () => {
    renderPanel();
    type("chat-gateway-token", "s3cr3t");
    await hostSave();
    expect(configWrites()[0].config.token).toBe("s3cr3t");
    expect((screen.getByTestId("chat-gateway-token") as HTMLInputElement).value).toBe("");
  });

  it("is write-only: the token input is a password field and never echoes server data", () => {
    configValue = { token: "from-server" };
    renderPanel();
    const input = screen.getByTestId("chat-gateway-token") as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(input.value).toBe("");
  });

  it("keeps the token out of the notice, the copied details and the thrown error when the save fails", async () => {
    sendMock.mockImplementation((msg: unknown) =>
      (msg as { type?: string })?.type === "plugin_config_write"
        ? Promise.reject(new Error('POST /api/config/plugins/chat-gateway failed: 500 bad token "s3cr3t"'))
        : Promise.resolve(),
    );
    renderPanel();
    type("chat-gateway-token", "s3cr3t");

    let thrown: unknown;
    await act(async () => {
      try {
        await source().commit();
      } catch (e) {
        thrown = e;
      }
    });
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).not.toContain("s3cr3t");

    const notice = screen.getByTestId("chat-gateway-notice");
    expect(notice.getAttribute("data-tone")).toBe("error");
    expect(notice.textContent).not.toContain("s3cr3t");
    expect(notice.textContent).not.toMatch(/500|POST/);

    fireEvent.click(screen.getByTestId("chat-gateway-notice-copy-details"));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = String(writeText.mock.calls[0][0]);
    expect(copied).not.toContain("s3cr3t");
    expect(copied).toContain("500");
    // a failed save keeps the typed token so the operator can retry
    expect((screen.getByTestId("chat-gateway-token") as HTMLInputElement).value).toBe("s3cr3t");
  });
});

describe("status pill (CG6)", () => {
  function stubBindings(body: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => body }) as unknown as Response),
    );
  }

  it("says Not set up while the gateway is unconfigured", () => {
    renderPanel();
    expect(screen.getByTestId("chat-gateway-status").textContent).toMatch(/Not set up/);
  });

  it("says Running with a saved token and a live gateway", async () => {
    stubBindings({ bindings: [], status: { running: true, boundChannels: 0, pendingSpawns: 0 } });
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("chat-gateway-status").textContent).toMatch(/Running/));
    expect(screen.getByTestId("chat-gateway-status").getAttribute("data-status")).toBe("running");
  });

  it("says Paused when the master switch is off", async () => {
    configValue = { enabled: false };
    stubBindings({ bindings: [], status: { running: false, boundChannels: 0, pendingSpawns: 0 } });
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("chat-gateway-status").textContent).toMatch(/Paused/));
  });
});
