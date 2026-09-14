/**
 * Connect-flow pure helpers (change: add-browser-relay) — test-plan #E18.
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildConnectUrl,
  openChromeProfile,
  PLAYWRIGHT_EXTENSION_ID,
} from "../connect.js";

const GUID = "0123456789abcdef0123456789abcdef";

describe("buildConnectUrl (E18)", () => {
  it("targets the pinned extension with protocolVersion=2 and the loopback relay URL", () => {
    const url = new URL(buildConnectUrl({ port: 8000, guid: GUID }));
    expect(url.protocol).toBe("chrome-extension:");
    expect(url.hostname).toBe(PLAYWRIGHT_EXTENSION_ID);
    expect(url.pathname).toBe("/connect.html");
    expect(url.searchParams.get("mcpRelayUrl")).toBe(
      `ws://127.0.0.1:8000/ws/browser-ext/${GUID}`,
    );
    expect(url.searchParams.get("protocolVersion")).toBe("2");
    expect(JSON.parse(url.searchParams.get("client") ?? "{}")).toEqual({ name: "pi-dashboard" });
  });

  it("omits `token` by default so the extension shows its Allow dialog", () => {
    const url = new URL(buildConnectUrl({ port: 8000, guid: GUID, profileToken: "T" }));
    expect(url.searchParams.get("token")).toBeNull();
  });

  it("appends `token` only when zeroDialog is set (and a token exists)", () => {
    const withToken = new URL(
      buildConnectUrl({ port: 8000, guid: GUID, profileToken: "T", zeroDialog: true }),
    );
    expect(withToken.searchParams.get("token")).toBe("T");

    const zeroDialogNoToken = new URL(
      buildConnectUrl({ port: 8000, guid: GUID, zeroDialog: true }),
    );
    expect(zeroDialogNoToken.searchParams.get("token")).toBeNull();
  });
});

describe("openChromeProfile (E18)", () => {
  it("passes the profile directory and URL as separate argv elements", () => {
    const run = vi.fn();
    openChromeProfile("Profile 37", "chrome-extension://x/connect.html", { platform: "darwin", run });
    expect(run).toHaveBeenCalledWith("open", [
      "-na",
      "Google Chrome",
      "--args",
      "--profile-directory=Profile 37",
      "chrome-extension://x/connect.html",
    ]);
  });
});
