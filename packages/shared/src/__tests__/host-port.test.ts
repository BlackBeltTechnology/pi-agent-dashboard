/**
 * Host-port helpers (test-plan #E8).
 * See change: stabilize-mdns-server-identity
 */
import { describe, expect, it } from "vitest";
import { formatHostPort, normalizeHostKey } from "../host-port.js";

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
