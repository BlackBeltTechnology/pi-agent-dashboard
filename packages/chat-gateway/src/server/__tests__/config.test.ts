import { describe, expect, it } from "vitest";

import { CONFIG_DEFAULTS } from "../../shared/types.js";
import { isConfigured, redactToken, resolveConfig } from "../config.js";

describe("resolveConfig", () => {
  it("applies CONFIG_DEFAULTS on an empty config", () => {
    const cfg = resolveConfig({});
    expect(cfg.enabled).toBe(CONFIG_DEFAULTS.enabled);
    expect(cfg.steerPrefix).toBe("!");
    expect(cfg.editThrottleMs).toBe(CONFIG_DEFAULTS.editThrottleMs);
    expect(cfg.token).toBe("");
    expect(cfg.allowedRoots).toEqual([]);
    expect(cfg.allowlist).toEqual([]);
    expect(cfg.admins).toEqual([]);
    expect(cfg.groupChannels).toEqual([]);
    expect(cfg.fixedMap).toEqual({});
    expect(cfg.defaultCwd).toBeUndefined();
  });

  it("is total on undefined and non-object input", () => {
    expect(() => resolveConfig(undefined)).not.toThrow();
    // biome-ignore lint/suspicious/noExplicitAny: malformed-input probe
    expect(() => resolveConfig("nope" as any)).not.toThrow();
    // biome-ignore lint/suspicious/noExplicitAny: malformed-input probe
    expect(() => resolveConfig([] as any)).not.toThrow();
    // biome-ignore lint/suspicious/noExplicitAny: malformed-input probe
    expect(() => resolveConfig(null as any)).not.toThrow();
    // biome-ignore lint/suspicious/noExplicitAny: malformed-input probe
    expect(resolveConfig("nope" as any).steerPrefix).toBe("!");
  });

  it("normalizes arrays: drops non-strings and empties, de-dupes, preserves order", () => {
    const cfg = resolveConfig({
      // biome-ignore lint/suspicious/noExplicitAny: malformed-input probe
      allowlist: ["u2", 7, "u1", "", "u2", null, "  ", "u3"] as any,
      // biome-ignore lint/suspicious/noExplicitAny: malformed-input probe
      allowedRoots: ["/a", { x: 1 }, "/b", "/a"] as any,
    });
    expect(cfg.allowlist).toEqual(["u2", "u1", "u3"]);
    expect(cfg.allowedRoots).toEqual(["/a", "/b"]);
  });

  it("drops non-string fixedMap values", () => {
    // biome-ignore lint/suspicious/noExplicitAny: malformed-input probe
    const cfg = resolveConfig({ fixedMap: { a: "/repo", b: 3, c: "" } as any });
    expect(cfg.fixedMap).toEqual({ a: "/repo" });
  });

  it('falls back to the default for editThrottleMs:"abc" and negatives', () => {
    // biome-ignore lint/suspicious/noExplicitAny: malformed-input probe
    expect(resolveConfig({ editThrottleMs: "abc" as any }).editThrottleMs).toBe(1000);
    expect(resolveConfig({ editThrottleMs: -5 }).editThrottleMs).toBe(1000);
    expect(resolveConfig({ editThrottleMs: Number.NaN }).editThrottleMs).toBe(1000);
    expect(resolveConfig({ editThrottleMs: Number.POSITIVE_INFINITY }).editThrottleMs).toBe(1000);
    expect(resolveConfig({ editThrottleMs: 0 }).editThrottleMs).toBe(0);
    expect(resolveConfig({ editThrottleMs: 250 }).editThrottleMs).toBe(250);
  });

  it("falls back to the default steerPrefix on a non-string or empty value", () => {
    // biome-ignore lint/suspicious/noExplicitAny: malformed-input probe
    expect(resolveConfig({ steerPrefix: 5 as any }).steerPrefix).toBe("!");
    expect(resolveConfig({ steerPrefix: "" }).steerPrefix).toBe("!");
    expect(resolveConfig({ steerPrefix: ">>" }).steerPrefix).toBe(">>");
  });

  it("never mutates the raw input", () => {
    const raw = {
      allowlist: ["u1", "u1"],
      // biome-ignore lint/suspicious/noExplicitAny: malformed-input probe
      editThrottleMs: "abc" as any,
      fixedMap: { a: "/repo" },
    };
    const snapshot = JSON.parse(JSON.stringify(raw));
    resolveConfig(raw);
    expect(raw).toEqual(snapshot);
  });
});

describe("isConfigured", () => {
  it("X6/E14: false without a token — the gateway is inert", () => {
    expect(isConfigured(resolveConfig({}))).toBe(false);
    expect(isConfigured(resolveConfig({ enabled: true, token: "" }))).toBe(false);
    expect(isConfigured(resolveConfig({ enabled: true, token: "   " }))).toBe(false);
  });

  it("false when disabled even with a token", () => {
    expect(isConfigured(resolveConfig({ enabled: false, token: "t0k" }))).toBe(false);
  });

  it("true only when enabled and a token is present", () => {
    expect(isConfigured(resolveConfig({ enabled: true, token: "t0k" }))).toBe(true);
    expect(isConfigured(resolveConfig({ token: "t0k" }))).toBe(true); // enabled defaults true
  });
});

describe("redactToken (E14 config secrecy)", () => {
  it("leaks no character of the secret", () => {
    const secret = "MTIzNDU2Nzg5.Gh3kZ.s3cr3t-value";
    const out = redactToken(secret);
    expect(out).toBe("***");
    expect(out).not.toContain(secret);
    expect(secret.includes(out)).toBe(false);
    for (const part of secret.split(/[.\-]/)) {
      if (part.length > 0) expect(out).not.toContain(part);
    }
    // No prefix or suffix of the secret survives.
    for (let i = 1; i <= secret.length; i++) {
      expect(out).not.toContain(secret.slice(0, i));
      expect(out).not.toContain(secret.slice(-i));
    }
  });

  it("empty input -> empty string", () => {
    expect(redactToken("")).toBe("");
  });
});
