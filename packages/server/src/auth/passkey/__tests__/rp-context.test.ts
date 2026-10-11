/**
 * RP ID resolution + stable-origin predicate.
 * See change: add-passkey-user-auth (D2; passkey-user-auth › Relying-party ID
 * is the primary domain, › Passkeys gated on a stable origin; task 3.4).
 */
import { describe, expect, it } from "vitest";
import { computeRpContext } from "../rp-context.js";

describe("computeRpContext", () => {
  it("override wins and is stable", () => {
    const ctx = computeRpContext({ base: "https://dash.example.com", source: "auth.redirectBaseUrl", primary: "tailscale" });
    expect(ctx).toEqual({ rpOrigin: "https://dash.example.com", rpId: "dash.example.com", stable: true });
  });

  it("Tailscale primary is stable; RP ID is its host", () => {
    const ctx = computeRpContext({ base: "https://host.tailnet.ts.net", source: "tunnel", primary: "tailscale" });
    expect(ctx.rpId).toBe("host.tailnet.ts.net");
    expect(ctx.stable).toBe(true);
  });

  it("reserved zrok primary is stable", () => {
    const ctx = computeRpContext({
      base: "https://mydash.shares.zrok.io",
      source: "tunnel",
      primary: "zrok",
      zrok: { reservedName: "mydash", persistent: true },
    });
    expect(ctx.stable).toBe(true);
    expect(ctx.rpId).toBe("mydash.shares.zrok.io");
  });

  it("ephemeral zrok primary is unstable", () => {
    const ctx = computeRpContext({ base: "https://a1b2c3.share.zrok.io", source: "tunnel", primary: "zrok" });
    expect(ctx).toMatchObject({ stable: false, reason: "ephemeral_tunnel" });
  });

  it("zrok serving a different name than the reserved one is unstable", () => {
    const ctx = computeRpContext({
      base: "https://xyz.shares.zrok.io",
      source: "tunnel",
      primary: "zrok",
      zrok: { reservedName: "mydash", persistent: true },
    });
    expect(ctx).toMatchObject({ stable: false, reason: "ephemeral_tunnel" });
  });

  it("non-tailscale/zrok tunnel providers are unstable (no stable flag yet)", () => {
    const ctx = computeRpContext({ base: "https://x.ngrok.app", source: "tunnel", primary: "ngrok" });
    expect(ctx).toMatchObject({ stable: false, reason: "ephemeral_tunnel" });
  });

  it.each([
    ["http://localhost:8000", "localhost", "no_public_origin"],
    ["https://localhost", "auth.redirectBaseUrl", "ip_or_localhost"],
    ["https://192.168.1.10", "auth.redirectBaseUrl", "ip_or_localhost"],
    ["https://[::1]", "auth.redirectBaseUrl", "ip_or_localhost"],
    ["http://dash.example.com", "auth.redirectBaseUrl", "not_https"],
    ["not a url", "auth.redirectBaseUrl", "invalid_origin"],
  ] as const)("%s (%s) is unstable: %s", (base, source, reason) => {
    const ctx = computeRpContext({ base, source, primary: "zrok" });
    expect(ctx.stable).toBe(false);
    expect(ctx.reason).toBe(reason);
  });

  it("origin is normalised (no path, lowercase host)", () => {
    const ctx = computeRpContext({ base: "https://Dash.Example.com/sub", source: "auth.redirectBaseUrl", primary: "zrok" });
    expect(ctx.rpOrigin).toBe("https://dash.example.com");
    expect(ctx.rpId).toBe("dash.example.com");
  });
});
