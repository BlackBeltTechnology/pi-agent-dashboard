/**
 * Live-server SSRF-guard validation. See change: improve-content-editor (§6).
 */
import { describe, expect, it } from "vitest";
import { isLoopbackUrl, liveServerPath, validateLiveTarget } from "../live-server.js";

describe("isLoopbackUrl — UX router classifier", () => {
  it("returns true for http(s) loopback URLs", () => {
    for (const href of [
      "http://localhost:5173/x",
      "http://127.0.0.1:80",
      "https://localhost/x",
      "http://[::1]:3000",
      "http://LOCALHOST:5173/",
    ]) {
      expect(isLoopbackUrl(href), href).toBe(true);
    }
  });

  it("returns false for spoofing vectors, non-http(s), and non-loopback", () => {
    for (const href of [
      "http://localhost@evil.com/",
      "http://evil.com/localhost",
      "http://0.0.0.0:3000",
      "ftp://localhost/",
      "javascript:alert(1)",
      "",
      "http://192.168.1.5/",
      "http://localhost.evil.com/",
      "http://localhost./", // trailing-dot host
      "http://[::ffff:127.0.0.1]/", // IPv4-mapped IPv6
      "http://127.0.0.1.evil.com/", // suffix trick
      "http://l\u041ecalhost/", // cyrillic-O unicode spoof → punycode
    ]) {
      expect(isLoopbackUrl(href), href).toBe(false);
    }
  });
});

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
