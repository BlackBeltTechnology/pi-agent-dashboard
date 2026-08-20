import { describe, expect, it } from "vitest";
import { normalizeTunnelConfig, validateTunnelForConnect } from "../config.js";

const defaults = {
  enabled: true,
  watchdog: { enabled: true, intervalMs: 60000, failureThreshold: 2, probeTimeoutMs: 10000 },
} as const;

describe("normalizeTunnelConfig — legacy back-compat", () => {
  it("bare reservedToken + no provider → zrok/public with token under zrok", () => {
    const out = normalizeTunnelConfig({ enabled: true, reservedToken: "tok123" }, defaults);
    expect(out.provider).toBe("zrok");
    expect(out.mode).toBe("public");
    expect(out.zrok?.reservedToken).toBe("tok123");
    // legacy top-level token preserved for downgrade safety
    expect(out.reservedToken).toBe("tok123");
  });

  it("is idempotent (running twice yields the same shape)", () => {
    const once = normalizeTunnelConfig({ enabled: true, reservedToken: "tok123" }, defaults);
    const twice = normalizeTunnelConfig(once, defaults);
    expect(twice).toEqual(once);
  });

  it("explicit provider wins over a stray legacy reservedToken", () => {
    const out = normalizeTunnelConfig(
      { enabled: true, provider: "ngrok", mode: "public", reservedToken: "legacy", ngrok: { authtoken: "a" } },
      defaults,
    );
    expect(out.provider).toBe("ngrok");
    expect(out.mode).toBe("public");
    expect(out.ngrok?.authtoken).toBe("a");
  });

  it("empty tunnel block leaves provider/mode unset (no silent default)", () => {
    const out = normalizeTunnelConfig({ enabled: true }, defaults);
    expect(out.provider).toBeUndefined();
    expect(out.mode).toBeUndefined();
  });

  it("preserves per-provider sub-configs", () => {
    const out = normalizeTunnelConfig(
      { enabled: true, provider: "tailscale", mode: "private", tailscale: { authKey: "tskey-auth-x" } },
      defaults,
    );
    expect(out.tailscale?.authKey).toBe("tskey-auth-x");
  });

  // support-zrok-v2 (E19/E20): v1 token preserved but NOT promoted; v2 fields.
  it("E19: legacy reservedToken preserved, NOT promoted to reservedName, idempotent", () => {
    const out = normalizeTunnelConfig({ tunnel: { reservedToken: "v1tok" } }.tunnel, defaults);
    expect(out.provider).toBe("zrok");
    expect(out.mode).toBe("public");
    expect(out.zrok?.reservedToken).toBe("v1tok");
    expect(out.zrok?.reservedName).toBeUndefined();
    // running again yields the same shape
    expect(normalizeTunnelConfig(out, defaults)).toEqual(out);
  });

  it("E20: fresh config → zrok.persistent defaults false, reservedName unset", () => {
    const out = normalizeTunnelConfig({ enabled: true }, defaults);
    expect(out.zrok?.persistent).toBe(false);
    expect(out.zrok?.reservedName).toBeUndefined();
  });

  it("surfaces an explicit v2 reservedName + persistent when present", () => {
    const out = normalizeTunnelConfig(
      { enabled: true, provider: "zrok", mode: "public", zrok: { reservedName: "pi-dash-abcd1234", persistent: true } },
      defaults,
    );
    expect(out.zrok?.reservedName).toBe("pi-dash-abcd1234");
    expect(out.zrok?.persistent).toBe(true);
  });
});

describe("validateTunnelForConnect — mode gating", () => {
  it("refuses when provider unset", () => {
    const r = validateTunnelForConnect({ ...defaults });
    expect(r.ok).toBe(false);
  });

  it("refuses when mode unset", () => {
    const r = validateTunnelForConnect({ ...defaults, provider: "zrok" });
    expect(r).toMatchObject({ ok: false, reason: "mode-unset" });
  });

  it("rejects ngrok/private and zrok/private (public-only)", () => {
    expect(validateTunnelForConnect({ ...defaults, provider: "ngrok", mode: "private" })).toMatchObject({
      ok: false,
      reason: "unsupported-mode",
    });
    expect(validateTunnelForConnect({ ...defaults, provider: "zrok", mode: "private" })).toMatchObject({
      ok: false,
      reason: "unsupported-mode",
    });
  });

  it("rejects zerotier/public (private-only)", () => {
    expect(validateTunnelForConnect({ ...defaults, provider: "zerotier", mode: "public" })).toMatchObject({
      ok: false,
      reason: "unsupported-mode",
    });
  });

  it("accepts valid pairings", () => {
    expect(validateTunnelForConnect({ ...defaults, provider: "zrok", mode: "public" }).ok).toBe(true);
    expect(validateTunnelForConnect({ ...defaults, provider: "tailscale", mode: "private" }).ok).toBe(true);
    expect(validateTunnelForConnect({ ...defaults, provider: "tailscale", mode: "public" }).ok).toBe(true);
    expect(validateTunnelForConnect({ ...defaults, provider: "zerotier", mode: "private" }).ok).toBe(true);
  });
});

/**
 * Per-provider `enabled`/`mode` (the concurrency layer, D3) must SURVIVE a load.
 *
 * `zrok` is not spread from raw like the other providers — it is RECONSTRUCTED
 * from reservedToken/reservedName/persistent. So the two keys the gateway UI
 * writes were dropped on the way back in: the config round-tripped to a
 * zrok that had never been enabled, and the operator's second tunnel simply
 * never connected, with nothing in the config to show why.
 */
describe("per-provider enabled/mode survive normalization", () => {
  const defaults = { enabled: false, zrok: { persistent: false }, watchdog: { enabled: true, intervalMs: 30_000 } };

  it("keeps zrok.enabled and zrok.mode", () => {
    const out = normalizeTunnelConfig({ zrok: { enabled: true, mode: "public", persistent: true } }, defaults as never);
    expect(out.zrok).toMatchObject({ enabled: true, mode: "public", persistent: true });
  });

  it("keeps enabled/mode for every other provider", () => {
    const out = normalizeTunnelConfig(
      {
        ngrok: { enabled: true, mode: "public" },
        tailscale: { enabled: true, mode: "private" },
        zerotier: { enabled: true, mode: "private", networkId: "abc" },
      },
      defaults as never,
    );
    expect(out.ngrok).toMatchObject({ enabled: true, mode: "public" });
    expect(out.tailscale).toMatchObject({ enabled: true, mode: "private" });
    expect(out.zerotier).toMatchObject({ enabled: true, mode: "private", networkId: "abc" });
  });

  it("drops junk rather than letting it reach the resolver", () => {
    const out = normalizeTunnelConfig(
      { zrok: { enabled: "yes", mode: "sideways" }, ngrok: { enabled: 1, mode: "nonsense" } },
      defaults as never,
    );
    expect(out.zrok?.enabled).toBeUndefined();
    expect(out.zrok?.mode).toBeUndefined();
    expect(out.ngrok?.enabled).toBeUndefined();
    expect(out.ngrok?.mode).toBeUndefined();
  });

  it("leaves an absent flag absent — absent means false, never true", () => {
    const out = normalizeTunnelConfig({ zrok: { persistent: false } }, defaults as never);
    expect(out.zrok?.enabled).toBeUndefined();
  });
});
