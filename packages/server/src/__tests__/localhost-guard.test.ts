import { describe, it, expect } from "vitest";
import { isLoopback, isBypassedHost, matchCidr, ipToNum, createNetworkGuard, netmaskToCidrBits, networkAddress } from "../localhost-guard.js";

describe("isLoopback", () => {
  it("should match loopback addresses", () => {
    expect(isLoopback("127.0.0.1")).toBe(true);
    expect(isLoopback("::1")).toBe(true);
    expect(isLoopback("::ffff:127.0.0.1")).toBe(true);
  });

  it("should reject non-loopback", () => {
    expect(isLoopback("192.168.1.1")).toBe(false);
    expect(isLoopback("10.0.0.1")).toBe(false);
  });
});

describe("isBypassedHost", () => {
  it("should match exact IP", () => {
    expect(isBypassedHost("192.168.1.42", ["192.168.1.42"])).toBe(true);
    expect(isBypassedHost("192.168.1.43", ["192.168.1.42"])).toBe(false);
  });

  it("should match wildcard", () => {
    expect(isBypassedHost("10.0.0.5", ["10.0.0.*"])).toBe(true);
    expect(isBypassedHost("10.0.1.5", ["10.0.0.*"])).toBe(false);
  });

  it("should match CIDR", () => {
    expect(isBypassedHost("192.168.1.42", ["192.168.1.0/24"])).toBe(true);
    expect(isBypassedHost("192.168.2.1", ["192.168.1.0/24"])).toBe(false);
  });

  it("should match wide CIDR", () => {
    expect(isBypassedHost("10.255.0.1", ["10.0.0.0/8"])).toBe(true);
    expect(isBypassedHost("11.0.0.1", ["10.0.0.0/8"])).toBe(false);
  });

  it("should return false for empty list", () => {
    expect(isBypassedHost("192.168.1.1", [])).toBe(false);
  });

  it("should match any entry in the list", () => {
    expect(isBypassedHost("10.0.0.5", ["192.168.1.0/24", "10.0.0.*"])).toBe(true);
  });

  it("should strip ::ffff: IPv4-mapped prefix", () => {
    expect(isBypassedHost("::ffff:192.168.1.42", ["192.168.1.0/24"])).toBe(true);
    expect(isBypassedHost("::ffff:10.0.0.5", ["10.0.0.*"])).toBe(true);
    expect(isBypassedHost("::ffff:10.0.0.5", ["10.0.0.5"])).toBe(true);
    expect(isBypassedHost("::ffff:192.168.2.1", ["192.168.1.0/24"])).toBe(false);
  });
});

describe("matchCidr", () => {
  it("should handle /32 (exact match)", () => {
    expect(matchCidr("10.0.0.1", "10.0.0.1/32")).toBe(true);
    expect(matchCidr("10.0.0.2", "10.0.0.1/32")).toBe(false);
  });

  it("should handle /0 (match all)", () => {
    expect(matchCidr("1.2.3.4", "0.0.0.0/0")).toBe(true);
  });

  it("should reject invalid CIDR bits", () => {
    expect(matchCidr("10.0.0.1", "10.0.0.0/33")).toBe(false);
    expect(matchCidr("10.0.0.1", "10.0.0.0/-1")).toBe(false);
  });
});

describe("ipToNum", () => {
  it("should convert valid IPv4", () => {
    expect(ipToNum("0.0.0.0")).toBe(0);
    expect(ipToNum("255.255.255.255")).toBe(0xFFFFFFFF);
    expect(ipToNum("192.168.1.1")).toBe((192 << 24 | 168 << 16 | 1 << 8 | 1) >>> 0);
  });

  it("should return null for invalid input", () => {
    expect(ipToNum("not-an-ip")).toBeNull();
    expect(ipToNum("::1")).toBeNull();
    expect(ipToNum("256.0.0.0")).toBeNull();
  });
});

describe("netmaskToCidrBits", () => {
  it("should convert common netmasks", () => {
    expect(netmaskToCidrBits("255.255.255.0")).toBe(24);
    expect(netmaskToCidrBits("255.255.0.0")).toBe(16);
    expect(netmaskToCidrBits("255.0.0.0")).toBe(8);
    expect(netmaskToCidrBits("255.255.255.255")).toBe(32);
    expect(netmaskToCidrBits("0.0.0.0")).toBe(0);
    expect(netmaskToCidrBits("255.255.255.128")).toBe(25);
  });
});

describe("networkAddress", () => {
  it("should compute network address", () => {
    expect(networkAddress("192.168.1.42", "255.255.255.0")).toBe("192.168.1.0");
    expect(networkAddress("10.0.5.100", "255.255.0.0")).toBe("10.0.0.0");
    expect(networkAddress("172.16.3.1", "255.0.0.0")).toBe("172.0.0.0");
  });
});

describe("createNetworkGuard", () => {
  function mockRequest(ip: string, isAuthenticated = false) {
    return { ip, isAuthenticated } as any;
  }

  function mockReply() {
    const r: any = { statusCode: 0, body: null };
    r.code = (c: number) => { r.statusCode = c; return r; };
    r.send = (b: any) => { r.body = b; return r; };
    return r;
  }

  it("should allow loopback", async () => {
    const guard = createNetworkGuard([]);
    const reply = mockReply();
    await guard(mockRequest("127.0.0.1"), reply);
    expect(reply.statusCode).toBe(0);
  });

  it("should allow trusted network CIDR", async () => {
    const guard = createNetworkGuard(["192.168.1.0/24"]);
    const reply = mockReply();
    await guard(mockRequest("192.168.1.42"), reply);
    expect(reply.statusCode).toBe(0);
  });

  it("should allow authenticated request", async () => {
    const guard = createNetworkGuard([]);
    const reply = mockReply();
    await guard(mockRequest("203.0.113.5", true), reply);
    expect(reply.statusCode).toBe(0);
  });

  it("should block untrusted unauthenticated request", async () => {
    const guard = createNetworkGuard(["192.168.1.0/24"]);
    const reply = mockReply();
    await guard(mockRequest("10.0.0.5", false), reply);
    expect(reply.statusCode).toBe(403);
  });

  it("should block when no trusted networks and not authenticated", async () => {
    const guard = createNetworkGuard([]);
    const reply = mockReply();
    await guard(mockRequest("192.168.1.5", false), reply);
    expect(reply.statusCode).toBe(403);
  });

  it("denial body is self-describing { success, error, reason, hint }", async () => {
    const guard = createNetworkGuard([]);
    const reply = mockReply();
    await guard(mockRequest("192.168.1.5", false), reply);
    expect(reply.statusCode).toBe(403);
    expect(reply.body.success).toBe(false);
    expect(reply.body.error).toBe("network_not_allowed");
    expect(typeof reply.body.reason).toBe("string");
    expect(reply.body.reason.length).toBeGreaterThan(0);
    expect(typeof reply.body.hint).toBe("string");
    // hint must name the remedy: trustedNetworks and/or sign in
    expect(reply.body.hint).toMatch(/trustedNetworks/i);
    expect(reply.body.hint).toMatch(/sign in/i);
  });

  it("does not emit the network_not_allowed body when authenticated", async () => {
    const guard = createNetworkGuard([]);
    const reply = mockReply();
    await guard(mockRequest("203.0.113.5", true), reply);
    expect(reply.statusCode).toBe(0);
    expect(reply.body).toBeNull();
  });
});
