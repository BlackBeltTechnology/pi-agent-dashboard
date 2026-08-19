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
