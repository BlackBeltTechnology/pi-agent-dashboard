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

// ── Identity-aware discovery, fqdn keying, freshness ──────────────────────
// See change: stabilize-mdns-server-identity (test-plan #E7 #E9 #E10 #F1 #F2 #X8)
import { EventEmitter } from "node:events";
import { createBrowser, serviceToServer, peerKey } from "../mdns-discovery.js";
import { formatHostPort } from "../host-port.js";

function svc(over: Record<string, unknown> = {}) {
  return {
    name: "pi-dashboard-aaaaaaaaaaaa-8000",
    fqdn: "pi-dashboard-aaaaaaaaaaaa-8000._pi-dashboard._tcp.local",
    host: "pi-dashboard-aaaaaaaaaaaa-8000.local",
    port: 8000,
    addresses: ["192.168.1.5"],
    txt: { version: "0.9.0", pid: "1", piPort: "9999", fp: "sha256:F", name: "Studio" },
    ...over,
  } as any;
}

describe("serviceToServer", () => {
  it("#E7 local peer host is a non-link-local IP literal, IPv4 preferred", () => {
    expect(serviceToServer(svc({ addresses: ["fe80::1", "192.168.1.5"] }), true).host).toBe("192.168.1.5");
    const v6 = serviceToServer(svc({ addresses: ["2001:db8::5"] }), true);
    expect(v6.host).toBe("2001:db8::5");
    expect(formatHostPort(v6.host, v6.port)).toBe("[2001:db8::5]:8000");
  });

  it("remote peers keep the advertised name", () => {
    expect(serviceToServer(svc(), false).host).toBe("pi-dashboard-aaaaaaaaaaaa-8000.local");
  });

  it("carries fingerprint, name, addresses and instance", () => {
    const s = serviceToServer(svc(), false);
    expect(s).toMatchObject({
      fingerprint: "sha256:F",
      name: "Studio",
      addresses: ["192.168.1.5"],
      instance: svc().fqdn,
    });
  });

  it("#E10 an older server without fp has no fingerprint key", () => {
    const s = serviceToServer(svc({ txt: { version: "0.8.0", pid: "2", piPort: "9999" } }), false);
    expect("fingerprint" in s).toBe(false);
    expect(s).toMatchObject({ version: "0.8.0", pid: 2, piPort: 9999 });
  });
});

describe("createBrowser", () => {
  function harness(initialSweep: any[][] = []) {
    const fake = new EventEmitter() as any;
    fake.stop = () => {};
    fake.update = () => {};
    const sweeps = [...initialSweep];
    let tick: () => void = () => {};
    const browser = createBrowser({
      createBonjour: () => ({ find: () => fake, destroy: () => {} }),
      sweepBrowse: async () => sweeps.shift() ?? [],
      schedule: (fn) => {
        tick = fn;
        return () => {};
      },
    });
    const events: Array<[string, any]> = [];
    for (const e of ["server-up", "server-down", "server-update"]) browser.on(e, (x) => events.push([e, x]));
    return { fake, browser, events, tick: () => tick() };
  }

  const other = (port: number) =>
    svc({
      port,
      name: `pi-dashboard-aaaaaaaaaaaa-${port}`,
      fqdn: `pi-dashboard-aaaaaaaaaaaa-${port}._pi-dashboard._tcp.local`,
      host: `pi-dashboard-aaaaaaaaaaaa-${port}.local`,
    });

  it("#E9 two servers sharing one fingerprint are two peers; down removes by fqdn", () => {
    const { fake, browser, events } = harness();
    fake.emit("up", other(8000));
    fake.emit("up", other(8001));
    expect(browser.servers.size).toBe(2);
    fake.emit("down", other(8000));
    expect(Array.from(browser.servers.values()).map((s) => s.port)).toEqual([8001]);
    expect(events.filter(([e]) => e === "server-down")).toHaveLength(1);
  });

  it("#F1 a peer missing from 3 consecutive sweeps is removed; reappearing is up again", async () => {
    const p = svc();
    const { fake, browser, events } = harness([[], [], [], [p]]);
    fake.emit("up", p);
    await browser.sweep();
    await browser.sweep();
    expect(browser.servers.size).toBe(1);
    await browser.sweep();
    expect(browser.servers.size).toBe(0);
    expect(events.filter(([e]) => e === "server-down")).toHaveLength(1);
    await browser.sweep();
    expect(events.filter(([e]) => e === "server-up")).toHaveLength(2);
  });

  it("#F2 changed addresses and a txt-update refresh the peer without down/up", async () => {
    const p = svc();
    const { fake, browser, events } = harness([[svc({ addresses: ["192.168.1.9"] })]]);
    fake.emit("up", p);
    await browser.sweep();
    expect(events.filter(([e]) => e === "server-update")).toHaveLength(1);
    expect(browser.servers.get(peerKey({ instance: p.fqdn, host: "", port: 0 }))?.addresses).toEqual([
      "192.168.1.9",
    ]);
    // peer without fp gains one
    const q = svc({ fqdn: "x._pi-dashboard._tcp.local", txt: { version: "1", pid: "1", piPort: "9999" } });
    fake.emit("up", q);
    fake.emit("txt-update", svc({ fqdn: "x._pi-dashboard._tcp.local" }), q);
    expect(browser.servers.get("x._pi-dashboard._tcp.local")?.fingerprint).toBe("sha256:F");
    expect(events.filter(([e]) => e === "server-down")).toHaveLength(0);
  });

  it("#X8 old-format and new-format peers from one machine are two peers", async () => {
    const old = svc({
      name: "pi-dashboard-Roberts-Mac-8000",
      fqdn: "pi-dashboard-Roberts-Mac-8000._pi-dashboard._tcp.local",
      host: "Roberts-Mac.local",
      txt: { version: "0.0.0", pid: "1", piPort: "9999" },
    });
    const fresh = svc();
    // old peer vanishes silently (no goodbye); new keeps answering
    const { fake, browser } = harness([[fresh], [fresh], [fresh]]);
    fake.emit("up", old);
    fake.emit("up", fresh);
    expect(browser.servers.size).toBe(2);
    await browser.sweep();
    await browser.sweep();
    expect(browser.servers.size).toBe(2);
    await browser.sweep();
    expect(Array.from(browser.servers.keys())).toEqual([fresh.fqdn]);
  });
});
