/**
 * Host-port helpers (test-plan #E8).
 * See change: stabilize-mdns-server-identity
 */
import { describe, expect, it } from "vitest";
import { formatHostPort, isValidHost, normalizeHostKey } from "../host-port.js";

describe("normalizeHostKey / formatHostPort", () => {
  it("normalizes case, trailing dot and brackets", () => {
    expect(normalizeHostKey("Home.LOCAL.")).toBe(normalizeHostKey("home.local"));
    expect(normalizeHostKey("[::1]")).toBe(normalizeHostKey("::1"));
    expect(normalizeHostKey("192.168.1.5")).toBe("192.168.1.5");
  });

  it("formats host:port, bracketing IPv6 literals", () => {
    expect(formatHostPort("home.local", 8000)).toBe("home.local:8000");
    expect(formatHostPort("Home.LOCAL.", 8000)).toBe("home.local:8000");
    expect(formatHostPort("::1", 8000)).toBe("[::1]:8000");
    expect(formatHostPort("[::1]", 8000)).toBe("[::1]:8000");
    expect(formatHostPort("192.168.1.5", 8000)).toBe("192.168.1.5:8000");
  });
});

describe("isValidHost", () => {
  it.each(["home.local", "Home.LOCAL.", "192.168.1.5", "[::1]", "2001:db8::5", "my_host", "a-b.c"])("accepts %s", (h) => {
    expect(isValidHost(h)).toBe(true);
  });

  it.each(["", "evil.com#@x", "user@host", "a/b", "h?x=1", "a b", "-lead.local", "trail-.local", "a..b", "x".repeat(64) + ".local", "::g", "[::1"])(
    "rejects %j",
    (h) => {
      expect(isValidHost(h)).toBe(false);
    },
  );

  it("normalizes a long run of trailing dots without backtracking", () => {
    const t0 = Date.now();
    expect(normalizeHostKey("a" + ".".repeat(100_000))).toBe("a");
    expect(Date.now() - t0).toBeLessThan(200);
  });
});
