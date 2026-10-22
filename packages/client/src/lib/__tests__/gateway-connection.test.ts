import { describe, expect, it } from "vitest";
import { gatewayToggle, remoteAccessIndicator, safeApprovalUrl } from "../gateway/gateway-connection.js";

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

describe("remoteAccessIndicator — toolbar dot + title (test-plan #E11)", () => {
  const counts = (connected: number, expected: number, status: "active" | "inactive" = "inactive") =>
    ({ status, ...(status === "active" ? { url: "https://x" } : {}), serverOs: "d", gateway: { connected, expected } }) as never;
  const failedDetail = {
    status: "active",
    url: "https://x",
    serverOs: "d",
    gateway: { connected: 1, expected: 2 },
    providers: [
      { provider: "zrok", primary: true, state: "connected" },
      { provider: "tailscale", primary: false, state: "failed", error: "boom" },
    ],
  } as never;

  it("precedence: failed > partial > internet > network > local", () => {
    expect(remoteAccessIndicator(failedDetail, "0.0.0.0").tone).toBe("failed");
    expect(remoteAccessIndicator(counts(1, 2), "127.0.0.1").tone).toBe("partial");
    expect(remoteAccessIndicator(counts(2, 2, "active"), "127.0.0.1").tone).toBe("internet");
    expect(remoteAccessIndicator(counts(0, 1), "0.0.0.0")).toEqual({ tone: "network", state: "listening on the network", title: "Remote access: listening on the network" });
    expect(remoteAccessIndicator(counts(0, 1), "127.0.0.1")).toEqual({ tone: "local", state: "this computer only", title: "Remote access: this computer only" });
  });

  it("an unreadable bind host is unknown, not 'this computer only'", () => {
    expect(remoteAccessIndicator(counts(0, 1), null)).toEqual({ tone: "local", state: "network status unknown", title: "Remote access: network status unknown" });
    // tunnel states still drive the dot while the bind is unknown
    expect(remoteAccessIndicator(counts(2, 2, "active"), null).title).toBe("Remote access: internet on");
  });

  it("a dropped provider is failed too; a tailscale-only gateway is internet", () => {
    const dropped = { ...(failedDetail as object), providers: [{ provider: "zrok", primary: true, state: "dropped" }] } as never;
    expect(remoteAccessIndicator(dropped, "127.0.0.1").tone).toBe("failed");
    expect(remoteAccessIndicator({ status: "unavailable", serverOs: "d", gateway: { connected: 1, expected: 1 } }, "127.0.0.1").tone).toBe("internet");
  });

  it("older servers without counts fall back to the zrok status", () => {
    expect(remoteAccessIndicator({ status: "active", url: "https://x", serverOs: "d" }, "127.0.0.1").tone).toBe("internet");
    expect(remoteAccessIndicator(null, "127.0.0.1").tone).toBe("local");
  });

  it("treats malformed 127.x hosts as non-loopback, like the step engine", () => {
    expect(remoteAccessIndicator(counts(0, 1), "127.999.999.999").tone).toBe("network");
    expect(remoteAccessIndicator(counts(0, 1), "127.0.0.2").tone).toBe("local");
  });

  it("appends the waiting-device count", () => {
    expect(remoteAccessIndicator(counts(0, 1), "127.0.0.1", 1).title).toBe("Remote access: this computer only, 1 device waiting");
    expect(remoteAccessIndicator(counts(0, 1), "127.0.0.1", 2).title).toBe("Remote access: this computer only, 2 devices waiting");
  });
});
