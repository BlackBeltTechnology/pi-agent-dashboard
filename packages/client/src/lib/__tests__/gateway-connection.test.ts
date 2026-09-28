import { describe, expect, it } from "vitest";
import { gatewayIndicator, gatewayToggle, safeApprovalUrl } from "../gateway/gateway-connection.js";

describe("gatewayToggle — Setup Connect/Disconnect state", () => {
  it("offers Disconnect while this server holds any provider, listing them", () => {
    expect(gatewayToggle({ status: "active", url: "https://x", serverOs: "darwin", connectedProviders: ["zrok", "tailscale"] }, false))
      .toMatchObject({ action: "disconnect", connected: ["zrok", "tailscale"], disabledReason: null, rows: [] });
  });

  it("offers Connect when nothing is connected (even if an OS daemon is up)", () => {
    expect(gatewayToggle({ status: "inactive", serverOs: "darwin", connectedProviders: [] }, false).action).toBe("connect");
  });

  it("falls back to the zrok status when the server predates connectedProviders", () => {
    expect(gatewayToggle({ status: "active", url: "https://x", serverOs: "darwin" }, false))
      .toMatchObject({ action: "disconnect", connected: ["zrok"] });
  });

  it("blocks Connect while provider/mode edits are unsaved, and says why", () => {
    expect(gatewayToggle({ status: "inactive", serverOs: "darwin", connectedProviders: [] }, true).disabledReason)
      .toMatch(/save/i);
  });

  it("an unknown status (load failed) still offers Connect", () => {
    expect(gatewayToggle(null, false)).toEqual({ action: "connect", connected: [], disabledReason: null, rows: [], partial: false });
  });
});

describe("safeApprovalUrl — the admin link is server-sourced CLI output, so it is allowlisted", () => {
  it("accepts the tailscale admin approval link", () => {
    expect(safeApprovalUrl("https://login.tailscale.com/f/serve?node=X")).toBe("https://login.tailscale.com/f/serve?node=X");
  });
  it("rejects anything else (other hosts, non-https, javascript:)", () => {
    expect(safeApprovalUrl("https://evil.example/f/serve")).toBeNull();
    expect(safeApprovalUrl("http://login.tailscale.com/f/serve")).toBeNull();
    expect(safeApprovalUrl("javascript:alert(1)")).toBeNull();
    expect(safeApprovalUrl(undefined)).toBeNull();
  });
});

describe("gatewayToggle rows — per-provider result", () => {
  const detail = {
    status: "inactive" as const,
    serverOs: "darwin",
    connectedProviders: ["tailscale"],
    providers: [
      { provider: "zrok", primary: true, state: "failed" as const, error: "POST /share 500 shareInternalServerError" },
      { provider: "tailscale", primary: false, state: "connected" as const },
    ],
  };

  it("carries every planned provider with its state and reason", () => {
    expect(gatewayToggle(detail, false).rows).toEqual(detail.providers);
  });

  it("partial: some connected, some not → still offers Disconnect, flags partial", () => {
    expect(gatewayToggle(detail, false)).toMatchObject({ action: "disconnect", partial: true });
  });

  it("a failed-only gateway offers Connect again (retry)", () => {
    const failed = { ...detail, connectedProviders: [], providers: [detail.providers[0]] };
    expect(gatewayToggle(failed, false)).toMatchObject({ action: "connect", partial: false });
  });
});

describe("gatewayIndicator — toolbar colour/title across ALL providers", () => {
  it("all planned connected → ok", () => {
    expect(gatewayIndicator({ status: "active", url: "https://x", serverOs: "d", gateway: { connected: 2, expected: 2 } }))
      .toMatchObject({ tone: "ok", title: "Gateway: 2/2 connected (click to open)" });
  });
  it("some connected → partial", () => {
    expect(gatewayIndicator({ status: "inactive", serverOs: "d", gateway: { connected: 1, expected: 2 } }))
      .toMatchObject({ tone: "partial", title: "Gateway: 1/2 connected (click to open)" });
  });
  it("none connected → off", () => {
    expect(gatewayIndicator({ status: "inactive", serverOs: "d", gateway: { connected: 0, expected: 2 } }).tone).toBe("off");
  });
  it("tailscale-only up while zrok binary is missing is still ok, not 'not set up'", () => {
    expect(gatewayIndicator({ status: "unavailable", serverOs: "d", gateway: { connected: 1, expected: 1 } }).tone).toBe("ok");
  });
  it("older server without counts falls back to the zrok status", () => {
    expect(gatewayIndicator({ status: "active", url: "https://x", serverOs: "d" }).tone).toBe("ok");
    expect(gatewayIndicator({ status: "unavailable", serverOs: "d" }).tone).toBe("unset");
    expect(gatewayIndicator(null).tone).toBe("unset");
  });
});
