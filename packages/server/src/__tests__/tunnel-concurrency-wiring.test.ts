/**
 * Concurrency is WIRED, not merely a library — folded from test-plan.md
 * (add-zrok-custom-reserved-name): 7.2, 7.6, X13, plus the CORS reach of E25.
 *
 * `tunnel-concurrency.test.ts` covers `resolveTunnelPlan` as a pure function.
 * It would pass on a tree where nothing ever calls it — which is precisely the
 * failure mode these tests exist to close. Everything here goes through
 * `tunnel.ts`'s real exports, so deleting the wiring fails the suite.
 */
import type {
  ProviderEndpoints,
  TunnelEndpoint,
  TunnelMode,
  TunnelProvider,
} from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const connectSpy = vi.fn();
const disconnectSpy = vi.fn();

/** A daemon provider whose endpoints are controllable. */
function fakeProvider(id: string, url: string | null): TunnelProvider {
  let endpoints: TunnelEndpoint[] = [];
  return {
    id: id as TunnelProvider["id"],
    kind: "daemon",
    supportsMode: () => true,
    detectBinary: () => true,
    isEnrolled: () => true,
    async connect(port: number, mode: TunnelMode): Promise<ProviderEndpoints> {
      connectSpy(id, port, mode);
      endpoints = url ? [{ kind: "mesh", url, tls: url.startsWith("https") }] : [];
      return { endpoints };
    },
    async disconnect() {
      disconnectSpy(id);
      endpoints = [];
    },
    status: () => ({ active: endpoints.length > 0, endpoints }),
  };
}

let tunnel: typeof import("../tunnel/tunnel.js");

beforeEach(async () => {
  vi.resetModules();
  connectSpy.mockReset();
  disconnectSpy.mockReset();
  tunnel = await import("../tunnel/tunnel.js");
  tunnel._resetProviderSingletons();
  tunnel.setPrimaryProvider(undefined);
  // Replace EVERY singleton with a fake before any test can connect one.
  // Without this the suite shells out to whatever tunnelling CLIs happen to be
  // installed on the machine — a 30s `tailscale up` on one developer's laptop
  // and an instant failure on another, i.e. an environment-dependent test.
  for (const id of ["zrok", "ngrok", "tailscale", "zerotier"] as const) {
    tunnel._setProviderSingleton(id, fakeProvider(id, null));
  }
});

afterEach(() => {
  tunnel._resetProviderSingletons();
  tunnel.setPrimaryProvider(undefined);
});

describe("the resolver is actually reachable from the tunnel module", () => {
  it("connectResolvedProviders refuses when the plan refuses (primary mode unsupported)", async () => {
    const r = await tunnel.connectResolvedProviders({ provider: "zrok", mode: "private" }, 8000);
    expect(r.plan.refuseConnect).toBe(true);
    expect(r.connected).toEqual([]);
  });

  it("connects the primary AND each enabled extra, each in its OWN mode", async () => {
    const r = await tunnel.connectResolvedProviders(
      { provider: "zrok", mode: "public", zerotier: { enabled: true } },
      8000,
    );
    expect(r.plan.providers.map((p) => p.provider).sort()).toEqual(["zerotier", "zrok"]);
    // zerotier resolves to its SOLE mode, not the top-level `public`.
    expect(r.plan.providers.find((p) => p.provider === "zerotier")?.mode).toBe("private");
  });

  it("does not connect a provider that never opted in", async () => {
    const r = await tunnel.connectResolvedProviders({ provider: "zrok", mode: "public" }, 8000);
    expect(r.plan.providers.map((p) => p.provider)).toEqual(["zrok"]);
  });
});

describe("7.2/X13: getTunnelUrl resolves the PRIMARY, and never auto-promotes", () => {
  it("defaults to zrok when no primary is configured (every pre-concurrency config)", () => {
    tunnel.setPrimaryProvider(undefined);
    expect(tunnel.getPrimaryProvider()).toBe("zrok");
  });

  it("returns the primary provider's URL when the primary is NOT zrok", async () => {
    const ts = fakeProvider("tailscale", "https://mac.tail1234.ts.net");
    await ts.connect(8000, "private");
    tunnel._setProviderSingleton("tailscale", ts);
    tunnel.setPrimaryProvider("tailscale");
    expect(tunnel.getTunnelUrl()).toBe("https://mac.tail1234.ts.net");
  });

  it("X13: a DOWN primary yields null even while a non-primary is live", async () => {
    // The sharp case: promoting the live one would move the OAuth sign-in
    // origin without the operator asking, bypassing the primary-switch confirm.
    const liveZerotier = fakeProvider("zerotier", "http://10.147.20.4:8000");
    await liveZerotier.connect(8000, "private");
    tunnel._setProviderSingleton("zerotier", liveZerotier);
    tunnel._setProviderSingleton("tailscale", fakeProvider("tailscale", null));
    tunnel.setPrimaryProvider("tailscale");

    expect(tunnel.getTunnelUrl()).toBeNull();
    // …while the live non-primary IS still CORS-readable. The two questions
    // have different answers, which is the whole of D4.
    expect(tunnel.liveTunnelOrigins()).toContain("http://10.147.20.4:8000");
  });

  it("7.6: the redirect base derives from the primary ONLY, with two tunnels live", async () => {
    const tsUrl = "https://mac.tail1234.ts.net";
    const ztUrl = "http://10.147.20.4:8000";
    const ts = fakeProvider("tailscale", tsUrl);
    const zt = fakeProvider("zerotier", ztUrl);
    await ts.connect(8000, "private");
    await zt.connect(8000, "private");
    tunnel._setProviderSingleton("tailscale", ts);
    tunnel._setProviderSingleton("zerotier", zt);
    tunnel.setPrimaryProvider("tailscale");

    expect(tunnel.getTunnelUrl()).toBe(tsUrl);
    const origins = tunnel.liveTunnelOrigins();
    expect(origins).toEqual(expect.arrayContaining([tsUrl, ztUrl]));
  });

  it("disconnectResolvedProviders brings the extras down, so they stop widening CORS", async () => {
    const zt = fakeProvider("zerotier", "http://10.147.20.4:8000");
    await zt.connect(8000, "private");
    tunnel._setProviderSingleton("zerotier", zt);
    expect(tunnel.liveTunnelOrigins()).toContain("http://10.147.20.4:8000");

    await tunnel.disconnectResolvedProviders(8000);
    expect(disconnectSpy).toHaveBeenCalledWith("zerotier");
    expect(tunnel.liveTunnelOrigins()).not.toContain("http://10.147.20.4:8000");
  });
});

describe("liveTunnelOrigins reflects real provider state", () => {
  it("is empty when nothing has connected", () => {
    // Re-seed rather than reset-and-hope: `_resetProviderSingletons()` alone
    // drops the fakes, so the next read would rebuild REAL providers and the
    // assertion would depend on which tunnelling CLIs the machine happens to
    // have running.
    for (const id of ["zrok", "ngrok", "tailscale", "zerotier"] as const) {
      tunnel._setProviderSingleton(id, fakeProvider(id, null));
    }
    expect(tunnel.liveTunnelOrigins()).toEqual([]);
  });

  it("reads the SAME singletons a connect populated, not fresh instances", () => {
    // A fresh instance per call has empty lastEndpoints by construction, which
    // is what made an earlier version of this feature inert.
    const a = tunnel.knownProviders();
    const b = tunnel.knownProviders();
    expect(a[0]).toBe(b[0]);
  });
});

/**
 * The connect route raises the PRIMARY through the existing `createTunnel`
 * path and the extras through `connectResolvedProviders`. Composing that by
 * blanking `provider` — `{...cfg, provider: undefined}` — is wrong in two
 * independent ways, and both are silent. These pin them.
 */
describe("skipPrimary composition (the connect route's shape)", () => {
  it("does NOT reset the recorded primary — blanking `provider` would", async () => {
    await tunnel.connectResolvedProviders(
      { provider: "tailscale", mode: "private", zerotier: { enabled: true } },
      8000,
      { skipPrimary: true },
    );
    // With `{...cfg, provider: undefined}` this would read "zrok", silently
    // defeating every primary resolution downstream (getTunnelUrl, the OAuth
    // redirect base, the board's Primary badge).
    expect(tunnel.getPrimaryProvider()).toBe("tailscale");
  });

  it("does NOT connect the primary a second time when it also carries enabled:true", async () => {
    connectSpy.mockReset();
    await tunnel.connectResolvedProviders(
      // A primary that ALSO opted in as an extra — legal config, and the shape
      // that double-connects under a blanked `provider`.
      { provider: "zerotier", zerotier: { enabled: true } },
      8000,
      { skipPrimary: true },
    );
    const zerotierConnects = connectSpy.mock.calls.filter((c) => c[0] === "zerotier");
    expect(zerotierConnects).toHaveLength(0);
  });

  it("still connects the primary when skipPrimary is not set", async () => {
    const r = await tunnel.connectResolvedProviders({ provider: "zerotier" }, 8000);
    expect(r.plan.providers.some((p) => p.primary && p.provider === "zerotier")).toBe(true);
  });

  it("a refused plan connects nothing, even with extras enabled", async () => {
    connectSpy.mockReset();
    const r = await tunnel.connectResolvedProviders(
      { provider: "zrok", mode: "private", zerotier: { enabled: true } },
      8000,
      { skipPrimary: true },
    );
    expect(r.plan.refuseConnect).toBe(true);
    expect(r.connected).toEqual([]);
    expect(connectSpy).not.toHaveBeenCalled();
  });
});

describe("connectGateway — the Connect button's server half", () => {
  const zrokDeps = (activeUrl: string | null, created: string | null) => ({
    zrokActiveUrl: () => activeUrl,
    createZrok: vi.fn(async () => created),
  });

  it("a non-zrok primary never starts zrok and connects the primary itself", async () => {
    tunnel._setProviderSingleton("tailscale", fakeProvider("tailscale", "http://box.ts.net:8000"));
    const deps = zrokDeps(null, "https://x.shares.zrok.io");
    const r = await tunnel.connectGateway({ provider: "tailscale", mode: "private" }, 8000, deps);
    expect(deps.createZrok).not.toHaveBeenCalled();
    expect(connectSpy).toHaveBeenCalledWith("tailscale", 8000, "private");
    expect(r).toMatchObject({ ok: true, url: "http://box.ts.net:8000", zrokUrl: null });
  });

  it("zrok primary already active still brings up enabled extras (no early return)", async () => {
    const deps = zrokDeps("https://live.shares.zrok.io", null);
    const r = await tunnel.connectGateway(
      { provider: "zrok", tailscale: { enabled: true, mode: "private" } },
      8000,
      deps,
    );
    expect(deps.createZrok).not.toHaveBeenCalled();
    expect(connectSpy).toHaveBeenCalledWith("tailscale", 8000, "private");
    expect(connectSpy).not.toHaveBeenCalledWith("zrok", expect.anything(), expect.anything());
    expect(r).toMatchObject({ ok: true, url: "https://live.shares.zrok.io", zrokUrl: "https://live.shares.zrok.io" });
  });

  it("zrok primary inactive is created through the zrok path; its failure fails the connect", async () => {
    const deps = zrokDeps(null, null);
    const r = await tunnel.connectGateway({ provider: "zrok" }, 8000, deps);
    expect(deps.createZrok).toHaveBeenCalledOnce();
    expect(r.ok).toBe(false);
  });

  it("a refused plan reports the resolver's reason", async () => {
    const r = await tunnel.connectGateway({ provider: "tailscale" }, 8000, zrokDeps(null, null));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/set tunnel.mode/);
  });

  it("a failing extra does not fail a healthy primary", async () => {
    const bad = fakeProvider("tailscale", null);
    bad.connect = async () => { throw new Error("boom"); };
    tunnel._setProviderSingleton("tailscale", bad);
    const r = await tunnel.connectGateway(
      { provider: "zrok", tailscale: { enabled: true, mode: "private" } },
      8000,
      zrokDeps(null, "https://new.shares.zrok.io"),
    );
    expect(r).toMatchObject({ ok: true, url: "https://new.shares.zrok.io" });
    expect(r.failures).toEqual([{ provider: "tailscale", error: "boom" }]);
  });
});

describe("connectedProviderIds — what the Connect/Disconnect toggle reflects", () => {
  it("lists only providers THIS process connected, and empties after disconnect", async () => {
    tunnel._setProviderSingleton("tailscale", fakeProvider("tailscale", "http://box.ts.net:8000"));
    expect(tunnel.connectedProviderIds()).toEqual([]);
    await tunnel.connectGateway({ provider: "tailscale", mode: "private" }, 8000, {
      zrokActiveUrl: () => null,
      createZrok: async () => null,
    });
    expect(tunnel.connectedProviderIds()).toEqual(["tailscale"]);
    await tunnel.disconnectResolvedProviders(8000);
    expect(tunnel.connectedProviderIds()).toEqual([]);
  });
});

describe("gatewayProviderStatus — per-provider connection state", () => {
  const cfg = { provider: "zrok" as const, tailscale: { enabled: true, mode: "private" as const } };

  it("idle for every planned provider before any connect", () => {
    expect(tunnel.gatewayProviderStatus(cfg)).toEqual([
      { provider: "zrok", primary: true, state: "idle" },
      { provider: "tailscale", primary: false, state: "idle" },
    ]);
  });

  it("partial connect: zrok failed WITH its reason, tailscale connected", async () => {
    tunnel._setProviderSingleton("tailscale", fakeProvider("tailscale", "http://box.ts.net:8000"));
    const r = await tunnel.connectGateway(cfg, 8000, {
      zrokActiveUrl: () => null,
      createZrok: async () => null,
      zrokLastError: () => "POST /share 500 shareInternalServerError",
    });
    expect(r.error).toBe("zrok: POST /share 500 shareInternalServerError");
    expect(tunnel.gatewayProviderStatus(cfg)).toEqual([
      { provider: "zrok", primary: true, state: "failed", error: "POST /share 500 shareInternalServerError" },
      { provider: "tailscale", primary: false, state: "connected" },
    ]);
  });

  it("an extra that threw is failed with its message", async () => {
    const bad = fakeProvider("tailscale", null);
    bad.connect = async () => { throw new Error("serve blocked"); };
    tunnel._setProviderSingleton("tailscale", bad);
    await tunnel.connectGateway(cfg, 8000, { zrokActiveUrl: () => null, createZrok: async () => "https://z.shares.zrok.io" });
    expect(tunnel.gatewayProviderStatus(cfg)[1]).toEqual({ provider: "tailscale", primary: false, state: "failed", error: "serve blocked" });
  });

  it("a provider that connected and later went away reads dropped, not connected", async () => {
    const ts = fakeProvider("tailscale", "http://box.ts.net:8000");
    tunnel._setProviderSingleton("tailscale", ts);
    await tunnel.connectGateway({ provider: "tailscale", mode: "private" }, 8000, { zrokActiveUrl: () => null, createZrok: async () => null });
    await ts.disconnect(8000); // dies behind our back
    expect(tunnel.gatewayProviderStatus({ provider: "tailscale", mode: "private" })).toEqual([
      { provider: "tailscale", primary: true, state: "dropped" },
    ]);
  });

  it("an operator Disconnect resets every provider to idle", async () => {
    tunnel._setProviderSingleton("tailscale", fakeProvider("tailscale", "http://box.ts.net:8000"));
    await tunnel.connectGateway({ provider: "tailscale", mode: "private" }, 8000, { zrokActiveUrl: () => null, createZrok: async () => null });
    await tunnel.disconnectResolvedProviders(8000);
    expect(tunnel.gatewayProviderStatus({ provider: "tailscale", mode: "private" })[0].state).toBe("idle");
  });
});
