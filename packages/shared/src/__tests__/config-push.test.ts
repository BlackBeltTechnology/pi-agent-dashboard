import { describe, it, expect } from "vitest";
import { parsePushConfig, DEFAULT_PUSH_CONFIG } from "../config.js";

describe("parsePushConfig", () => {
  it("returns defaults when raw is undefined", () => {
    expect(parsePushConfig(undefined)).toEqual({
      enabled: false,
      coalesceWindowMs: 30_000,
    });
  });

  it("returns defaults when raw is null", () => {
    expect(parsePushConfig(null)).toEqual(DEFAULT_PUSH_CONFIG);
  });

  it("returns defaults when raw is not an object", () => {
    expect(parsePushConfig("enabled")).toEqual(DEFAULT_PUSH_CONFIG);
    expect(parsePushConfig(42)).toEqual(DEFAULT_PUSH_CONFIG);
    expect(parsePushConfig([])).toEqual(DEFAULT_PUSH_CONFIG);
  });

  it("returns defaults when raw is empty object", () => {
    expect(parsePushConfig({})).toEqual({
      enabled: false,
      coalesceWindowMs: 30_000,
    });
  });

  it("parses enabled: true with contact email", () => {
    const result = parsePushConfig({
      enabled: true,
      webPush: { contactEmail: "user@example.com" },
    });
    expect(result.enabled).toBe(true);
    expect(result.coalesceWindowMs).toBe(30_000);
    expect(result.webPush).toEqual({ contactEmail: "user@example.com" });
    expect(result.errors).toBeUndefined();
  });

  it("sets errors when enabled: true and no contactEmail", () => {
    const result = parsePushConfig({ enabled: true });
    expect(result.enabled).toBe(true);
    expect(result.errors).toEqual(["missing contactEmail"]);
    expect(result.webPush).toBeUndefined();
  });

  it("sets errors when enabled: true and webPush is empty", () => {
    const result = parsePushConfig({ enabled: true, webPush: {} });
    expect(result.errors).toEqual(["missing contactEmail"]);
  });

  it("sets errors when enabled: true and contactEmail is not a string", () => {
    const result = parsePushConfig({
      enabled: true,
      webPush: { contactEmail: 123 },
    });
    expect(result.errors).toEqual(["missing contactEmail"]);
  });

  it("does not set errors when enabled: false and no contactEmail", () => {
    const result = parsePushConfig({ enabled: false });
    expect(result.enabled).toBe(false);
    expect(result.errors).toBeUndefined();
  });

  it("clamps coalesceWindowMs to min 5_000", () => {
    const result = parsePushConfig({ coalesceWindowMs: 1_000 });
    expect(result.coalesceWindowMs).toBe(5_000);
  });

  it("clamps coalesceWindowMs to max 300_000", () => {
    const result = parsePushConfig({ coalesceWindowMs: 999_999 });
    expect(result.coalesceWindowMs).toBe(300_000);
  });

  it("uses default coalesceWindowMs when not a number", () => {
    const result = parsePushConfig({ coalesceWindowMs: "fast" });
    expect(result.coalesceWindowMs).toBe(30_000);
  });

  it("uses custom coalesceWindowMs within range", () => {
    const result = parsePushConfig({ coalesceWindowMs: 60_000 });
    expect(result.coalesceWindowMs).toBe(60_000);
  });

  it("includes webPush when valid", () => {
    const result = parsePushConfig({
      enabled: false,
      webPush: { contactEmail: "admin@test.com" },
    });
    expect(result.webPush).toEqual({ contactEmail: "admin@test.com" });
    expect(result.errors).toBeUndefined();
  });
});
