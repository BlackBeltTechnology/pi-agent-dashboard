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
