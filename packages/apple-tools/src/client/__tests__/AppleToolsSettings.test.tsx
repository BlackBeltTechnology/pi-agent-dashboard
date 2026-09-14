/**
 * AppleToolsSettings (change extract-mcp-client-plugin, task 5.4): the panel
 * mounts while the plugin is `enabled: true, loaded: false` (the client
 * enabled-set keys on `enabled`), hides [Run installer] when the plugin reports
 * a missing `dependsOn`, and links to the mcp-client manager.
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const DEV_CTX = "@blackbelt-technology/dashboard-plugin-runtime/context";
void DEV_CTX; // documentation alias only — vi.mock needs a static literal
vi.mock("@blackbelt-technology/dashboard-plugin-runtime/context", () => ({
  usePluginConfig: () => ({}),
  usePluginSend: () => () => {},
}));

const { AppleToolsSettings } = await import("../index.js");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function jsonOk(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

/** `/api/plugins` row + status mock. The plugin row is `enabled: true,
 *  loaded: false` — the state a `dependsOn` gap produces. */
function fetchFor(opts: { missingDeps?: string[]; appPresent?: boolean } = {}): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("/api/plugins")) {
      return jsonOk({
        success: true,
        plugins: [
          {
            id: "apple-tools",
            status: { id: "apple-tools", enabled: true, loaded: false, missingDeps: opts.missingDeps ?? [] },
          },
        ],
      });
    }
    if (u.includes("/api/apple-tools/status")) {
      return jsonOk({
        platform: "darwin",
        state: "READY_PENDING_GRANTS",
        message: "provisioned",
        imcpServerPath: "/Applications/iMCP.app/Contents/MacOS/imcp-server",
        appPresent: opts.appPresent ?? true,
      });
    }
    return jsonOk({});
  });
}

describe("AppleToolsSettings", () => {
  it("missing mcp-client dependency → banner + Enable link, no Run installer", async () => {
    (globalThis as { fetch?: unknown }).fetch = fetchFor({ missingDeps: ["mcp-client"] });
    const { getByTestId, queryByTestId } = render(<AppleToolsSettings />);
    await waitFor(() => expect(getByTestId("apple-tools-missing-deps")).toBeTruthy());
    const banner = getByTestId("apple-tools-missing-deps");
    expect(banner.textContent).toContain("mcp-client");
    expect(banner.querySelector("a")?.getAttribute("href")).toBe("/settings/plugins");
    expect(queryByTestId("apple-tools-run-installer")).toBeNull();
    // The section still mounts (enabled, not loaded).
    expect(getByTestId("apple-tools-settings")).toBeTruthy();
  });

  it("dependency satisfied + iMCP present → Run installer, no banner", async () => {
    (globalThis as { fetch?: unknown }).fetch = fetchFor({ missingDeps: [] });
    const { getByTestId, queryByTestId } = render(<AppleToolsSettings />);
    await waitFor(() => expect(getByTestId("apple-tools-run-installer")).toBeTruthy());
    expect(queryByTestId("apple-tools-missing-deps")).toBeNull();
  });

  it("links to the mcp-client plugin for enable/disable + direct tools", async () => {
    (globalThis as { fetch?: unknown }).fetch = fetchFor();
    const { getByTestId } = render(<AppleToolsSettings />);
    await waitFor(() => expect(getByTestId("apple-tools-manage-mcp")).toBeTruthy());
    expect(getByTestId("apple-tools-manage-mcp").getAttribute("href")).toBe("/settings/plugins/mcp-client");
  });
});
