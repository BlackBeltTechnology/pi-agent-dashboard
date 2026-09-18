// @vitest-environment jsdom
/**
 * ChatGatewaySettings (task 10.1) — renders the config fields and persists a
 * partial write. Asserts the TOKEN safety invariant: a blank token field never
 * sends `token`, so a save cannot erase the stored secret.
 *
 * See change: add-chat-gateway.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.fn((_msg: unknown) => Promise.resolve());
let configValue: Record<string, unknown> = {};

vi.mock("@blackbelt-technology/dashboard-plugin-runtime/context", () => ({
  usePluginConfig: () => configValue,
  usePluginSend: () => sendMock,
}));

import { ChatGatewaySettings } from "../index.js";

function renderPanel() {
  return render(<ChatGatewaySettings pluginContext={{} as never} />);
}

beforeEach(() => {
  sendMock.mockClear();
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
  it("renders the config fields from the plugin config", () => {
    configValue = { allowedRoots: ["/repos"], allowlist: ["u1"] };
    renderPanel();
    expect(screen.getByTestId("chat-gateway-allowed-roots")).toBeTruthy();
    expect((screen.getByTestId("chat-gateway-allowlist") as HTMLInputElement).value).toBe("u1");
    expect(screen.getByTestId("chat-gateway-admins")).toBeTruthy();
    expect(screen.getByTestId("chat-gateway-save")).toBeTruthy();
  });

  it("persists an edited list and NEVER sends a blank token", async () => {
    configValue = { allowlist: ["u1"] };
    renderPanel();
    fireEvent.change(screen.getByTestId("chat-gateway-allowlist"), {
      target: { value: "u1, u2" },
    });
    fireEvent.click(screen.getByTestId("chat-gateway-save"));

    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1));
    const msg = sendMock.mock.calls[0][0] as unknown as {
      type: string;
      id: string;
      config: Record<string, unknown>;
    };
    expect(msg.type).toBe("plugin_config_write");
    expect(msg.id).toBe("chat-gateway");
    expect(msg.config.allowlist).toEqual(["u1", "u2"]);
    expect(msg.config).not.toHaveProperty("token");
  });

  it("sends the token ONLY when the operator typed one", async () => {
    renderPanel();
    fireEvent.change(screen.getByTestId("chat-gateway-token"), {
      target: { value: "  bot-secret  " },
    });
    fireEvent.click(screen.getByTestId("chat-gateway-save"));

    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1));
    const msg = sendMock.mock.calls[0][0] as unknown as { config: Record<string, unknown> };
    expect(msg.config.token).toBe("bot-secret");
  });

  it("parses the fixed map from channelKey=cwd lines", async () => {
    renderPanel();
    fireEvent.change(screen.getByTestId("chat-gateway-fixed-map"), {
      target: { value: "discord:c1:-=/repos/proj\ndiscord:c2:-=/repos/other" },
    });
    fireEvent.click(screen.getByTestId("chat-gateway-save"));

    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1));
    const msg = sendMock.mock.calls[0][0] as unknown as { config: { fixedMap: Record<string, string> } };
    expect(msg.config.fixedMap).toEqual({
      "discord:c1:-": "/repos/proj",
      "discord:c2:-": "/repos/other",
    });
  });
});
