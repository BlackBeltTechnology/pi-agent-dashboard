/**
 * Live-server SSRF-guard validation. See change: improve-content-editor (§6).
 */
import { describe, it, expect } from "vitest";
import { validateLiveTarget, liveServerPath } from "../live-server.js";

describe("validateLiveTarget — SSRF boundary", () => {
  it("accepts loopback hosts", () => {
    for (const host of ["localhost", "127.0.0.1", "::1", "LOCALHOST", " 127.0.0.1 "]) {
      const r = validateLiveTarget({ host, port: 5173 });
      expect(r.ok, host).toBe(true);
    }
  });

  it("rejects cloud-metadata + remote + private hosts (SSRF)", () => {
    for (const host of ["169.254.169.254", "10.0.0.5", "192.168.1.2", "example.com", "0.0.0.0", "::"]) {
      const r = validateLiveTarget({ host, port: 80 });
      expect(r.ok, host).toBe(false);
    }
  });

  it("rejects out-of-range / non-integer ports", () => {
    for (const port of [0, -1, 65536, 3.5, Number.NaN]) {
      expect(validateLiveTarget({ host: "localhost", port }).ok).toBe(false);
    }
  });

  it("defaults the label to host:port when absent", () => {
    const r = validateLiveTarget({ host: "localhost", port: 5173 });
    expect(r.ok && r.label).toBe("localhost:5173");
  });

  it("rejects non-object input without throwing (hand-edited allowlist)", () => {
    for (const bad of [null, undefined, 42, "x", []]) {
      expect(validateLiveTarget(bad as unknown).ok, String(bad)).toBe(false);
    }
  });

  it("liveServerPath builds the proxied path", () => {
    expect(liveServerPath("abc")).toBe("/live/abc/");
  });
});
