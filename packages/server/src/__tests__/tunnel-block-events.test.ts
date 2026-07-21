import { describe, expect, it } from "vitest";
import { BlockEventBuffer } from "../tunnel/tunnel-block-events.js";
import { collectEndpoints, localEndpoints, manualEndpoints } from "../tunnel/tunnel-endpoints.js";

describe("block-event buffer — anti-poisoning (7.1)", () => {
  it("records a refused IP and surfaces it", () => {
    const b = new BlockEventBuffer();
    b.record("192.168.1.50", { proxied: false });
    const list = b.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ ip: "192.168.1.50", count: 1, trustable: true });
  });

  it("dedupes by IP (a flood coalesces, does not multiply entries)", () => {
    const b = new BlockEventBuffer();
    for (let i = 0; i < 100; i++) b.record("192.168.1.50", { proxied: false });
    expect(b.list()).toHaveLength(1);
    expect(b.list()[0].count).toBe(100);
  });

  it("caps distinct IPs so a spoofed flood cannot grow unbounded", () => {
    const b = new BlockEventBuffer(10);
    for (let i = 0; i < 500; i++) b.record(`10.0.0.${i}`, { proxied: false });
    expect(b.list().length).toBeLessThanOrEqual(10);
  });

  it("marks loopback + proxy-terminated peers non-trustable (never-trust-loopback)", () => {
    const b = new BlockEventBuffer();
    b.record("127.0.0.1", { proxied: false });
    b.record("100.64.0.9", { proxied: true }); // tunnel/proxy hop
    const byIp = Object.fromEntries(b.list().map((e) => [e.ip, e.trustable]));
    expect(byIp["127.0.0.1"]).toBe(false);
    expect(byIp["100.64.0.9"]).toBe(false);
  });

  it("a proxied hit never upgrades a genuine IP to trustable", () => {
    const b = new BlockEventBuffer();
    b.record("203.0.113.7", { proxied: true });
    expect(b.list()[0].trustable).toBe(false);
    b.record("203.0.113.7", { proxied: false }); // later genuine hit
    expect(b.list()[0].trustable).toBe(true);
  });
});

describe("endpoint enumeration (6.1)", () => {
  it("manual publicBaseUrls tagged public; tls from scheme only", () => {
    const eps = manualEndpoints(["https://me.example", "http://plain.example", "  "]);
    expect(eps).toEqual([
      { kind: "public", url: "https://me.example", tls: true },
      { kind: "public", url: "http://plain.example", tls: false },
    ]);
  });

  it("local endpoints include loopback + LAN, all no-TLS", () => {
    const eps = localEndpoints(8000, {
      lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true } as any],
      en0: [{ address: "192.168.1.20", family: "IPv4", internal: false } as any],
    });
    expect(eps.some((e) => e.kind === "local" && e.url === "http://localhost:8000")).toBe(true);
    expect(eps.some((e) => e.kind === "lan" && e.url === "http://192.168.1.20:8000")).toBe(true);
    expect(eps.every((e) => e.tls === false)).toBe(true);
  });

  it("collects all sources incl. a hand-added URL, deduped", () => {
    const eps = collectEndpoints({
      providerEndpoints: [{ kind: "public", url: "https://x.share.zrok.io", tls: true }],
      publicBaseUrls: ["https://my-proxy.example"],
      port: 8000,
      includeLocal: false,
    });
    expect(eps.map((e) => e.url)).toContain("https://my-proxy.example");
    expect(eps.map((e) => e.url)).toContain("https://x.share.zrok.io");
  });
});
