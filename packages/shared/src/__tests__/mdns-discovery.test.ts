import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "node:os";
import { isLocalService, pickBestHost, type DiscoveredServer } from "../mdns-discovery.js";

describe("pickBestHost", () => {
  it("keeps a DNS-safe hostname unchanged", () => {
    const service = { host: "my-mac.local", addresses: ["192.168.1.5"] } as any;
    expect(pickBestHost(service)).toBe("my-mac.local");
  });

  it("keeps a bare DNS-safe hostname unchanged", () => {
    const service = { host: "macbook", addresses: ["192.168.1.5"] } as any;
    expect(pickBestHost(service)).toBe("macbook");
  });

  it("falls back to IPv4 address when host has a space", () => {
    const service = { host: "MacBook 242", addresses: ["192.168.16.242", "fe80::1"] } as any;
    expect(pickBestHost(service)).toBe("192.168.16.242");
  });

  it("falls back to IPv4 when host has invalid characters", () => {
    const service = { host: "my_mac@home", addresses: ["10.0.0.5"] } as any;
    expect(pickBestHost(service)).toBe("10.0.0.5");
  });

  it("prefers IPv4 over IPv6 when both are present", () => {
    const service = { host: "bad host", addresses: ["fe80::1", "192.168.1.7"] } as any;
    expect(pickBestHost(service)).toBe("192.168.1.7");
  });

  it("falls back to first address when only IPv6 is available", () => {
    const service = { host: "bad host", addresses: ["fe80::1"] } as any;
    expect(pickBestHost(service)).toBe("fe80::1");
  });

  it("returns the original host when no addresses available (best-effort)", () => {
    const service = { host: "bad host", addresses: [] } as any;
    expect(pickBestHost(service)).toBe("bad host");
  });

  it("returns 'unknown' when host is missing and no addresses", () => {
    const service = { host: undefined, addresses: [] } as any;
    expect(pickBestHost(service)).toBe("unknown");
  });

  it("rejects host starting with hyphen", () => {
    const service = { host: "-bad", addresses: ["10.0.0.1"] } as any;
    expect(pickBestHost(service)).toBe("10.0.0.1");
  });
});

// Test isLocalService with mock Service objects
describe("isLocalService", () => {
  it("returns true for localhost host", () => {
    const service = { host: "localhost", port: 8000, addresses: [] } as any;
    expect(isLocalService(service)).toBe(true);
  });

  it("returns true for matching hostname", () => {
    const hostname = os.hostname();
    const service = { host: hostname, port: 8000, addresses: [] } as any;
    expect(isLocalService(service)).toBe(true);
  });

  it("returns true for hostname.local", () => {
    const hostname = os.hostname();
    const service = { host: `${hostname}.local`, port: 8000, addresses: [] } as any;
    expect(isLocalService(service)).toBe(true);
  });

  it("returns true when service address matches 127.0.0.1", () => {
    const service = { host: "some-host", port: 8000, addresses: ["127.0.0.1"] } as any;
    expect(isLocalService(service)).toBe(true);
  });

  it("returns true when service address matches ::1", () => {
    const service = { host: "some-host", port: 8000, addresses: ["::1"] } as any;
    expect(isLocalService(service)).toBe(true);
  });

  it("returns false for remote host with different addresses", () => {
    const service = { host: "other-machine.local", port: 8000, addresses: ["10.99.99.99"] } as any;
    expect(isLocalService(service)).toBe(false);
  });
});

describe("discoverFallback", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns null when health check finds non-dashboard service", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: "nginx" }),
    });

    const { discoverFallback } = await import("../mdns-discovery.js");
    const result = await discoverFallback(9999);
    expect(result).toBeNull();
  });

  it("returns server when health check succeeds", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, pid: 1234 }),
    });

    const { discoverFallback } = await import("../mdns-discovery.js");
    const result = await discoverFallback(8000);
    expect(result).not.toBeNull();
    expect(result!.host).toBe("localhost");
    expect(result!.port).toBe(8000);
    expect(result!.pid).toBe(1234);
    expect(result!.source).toBe("fallback");
  });

  it("returns null when nothing is running", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const { discoverFallback } = await import("../mdns-discovery.js");
    const result = await discoverFallback(9999);
    expect(result).toBeNull();
  });
});
