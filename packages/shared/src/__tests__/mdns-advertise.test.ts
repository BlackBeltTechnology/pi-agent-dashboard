import { beforeEach, describe, expect, it, vi } from "vitest";
import { advertiseDashboard, shouldAdvertise, stopAdvertising } from "../mdns-discovery.js";

/**
 * Honest advertisement (change: fix-bridge-mdns-migration-hijack, D4).
 *
 * A dashboard bound only to loopback used to advertise itself under the
 * machine's LAN hostname — a record every consumer resolves to an address the
 * server never answers on. That record is the poison the bridge-side
 * migration gate defends against; the server must not publish it in the first
 * place: bound to loopback, it advertises nothing.
 */

type PublishConfig = { name: string; type: string; port: number; txt: Record<string, string> };

describe("shouldAdvertise (bind-host gate)", () => {
  it.each([
    ["127.0.0.1"],
    ["::1"],
    // Spelled-out IPv6 loopback: identical address, different string — must
    // classify loopback like `::1`, not slip through as a LAN bind. (CodeRabbit
    // review, fix-bridge-mdns-migration-hijack.)
    ["0:0:0:0:0:0:0:1"],
    ["[::1]"],
    ["localhost"],
    ["LOCALHOST"],
    ["dashboard.localhost"],
  ])("does not advertise when bound to loopback (%s)", (bindHost) => {
    expect(shouldAdvertise(bindHost).advertise).toBe(false);
  });

  it.each([
    ["0.0.0.0", "all interfaces"],
    ["::", "all interfaces (IPv6)"],
    ["", "unset (server default listen)"],
    [undefined, "legacy caller that passes no bind host"],
    ["192.168.1.10", "a specific LAN address"],
    ["myhost.local", "a LAN hostname the server actually serves on"],
  ])("advertises when bound to %s (%s)", (bindHost, _label) => {
    expect(shouldAdvertise(bindHost).advertise).toBe(true);
  });

  it("names the bind host in the refusal reason", () => {
    const verdict = shouldAdvertise("127.0.0.1");
    expect(verdict.reason).toContain("127.0.0.1");
  });
});

describe("advertiseDashboard (loopback-bound server publishes nothing)", () => {
  let publish: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // The seam now must return a Service (the server installs the record override on it).
    publish = vi.fn((c: PublishConfig) => fakeService(c as never).svc);
    stopAdvertising();
  });

  it("4.3 never publishes a record when the server is bound only to loopback", () => {
    advertiseDashboard(8478, 9999, { bindHost: "127.0.0.1", publish: publish as any });
    expect(publish).not.toHaveBeenCalled();
    stopAdvertising();
  });

  it("publishes when the server is bound to all interfaces (unchanged behaviour)", () => {
    advertiseDashboard(8478, 9999, { bindHost: "0.0.0.0", addresses: ["192.168.1.2"], publish: publish as any });
    expect(publish).toHaveBeenCalledTimes(1);
    const cfg = publish.mock.calls[0][0] as PublishConfig;
    expect(cfg.port).toBe(8478);
    expect(cfg.txt.piPort).toBe("9999");
    stopAdvertising();
  });

  it("publishes when no bind host is given (back-compat for callers predating the gate)", () => {
    advertiseDashboard(8478, 9999, { addresses: ["192.168.1.2"], publish: publish as any });
    expect(publish).toHaveBeenCalledTimes(1);
    stopAdvertising();
  });

  it("the skip decision equals shouldAdvertise's verdict", () => {
    expect(shouldAdvertise("::1").advertise).toBe(false);
    advertiseDashboard(8478, 9999, { bindHost: "::1", publish: publish as any });
    expect(publish).not.toHaveBeenCalled();
    stopAdvertising();
  });

  it("returns the verdict so callers can log the skip honestly (CodeRabbit review)", () => {
    const skipped = advertiseDashboard(8478, 9999, { bindHost: "127.0.0.1", publish: publish as any });
    expect(skipped.advertise).toBe(false);
    expect(skipped.reason).toMatch(/loopback/i);
    stopAdvertising();
    const published = advertiseDashboard(8478, 9999, { bindHost: "0.0.0.0", addresses: ["192.168.1.2"], publish: publish as any });
    expect(published.advertise).toBe(true);
  });
});

// ── Identity-derived names, TXT, address filter, conflict handling ─────────
// See change: stabilize-mdns-server-identity (test-plan #E1–#E6, #X2–#X4, #F3)
import os from "node:os";
import { afterEach } from "vitest";
import { Service } from "bonjour-service";
import {
  deriveAdvertisedNames,
  isLocalService,
  resolveAdvertisedAddresses,
  type AdvertisePublishConfig,
} from "../mdns-discovery.js";

const FP = "sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

/** A real bonjour Service whose lifecycle callbacks are inert. */
function fakeService(config: AdvertisePublishConfig, published = false) {
  const stop = vi.fn((cb?: () => void) => cb?.());
  const svc = new Service(config as never, () => {}, stop as never);
  svc.published = published;
  return { svc, stop };
}

const quiet = { log: () => {} };

describe("deriveAdvertisedNames (#E1 #E2)", () => {
  it.each([[1], [8000], [65535]])("derives a valid DNS label for port %i", (port) => {
    const n = deriveAdvertisedNames(FP, port);
    expect(n.instance).toMatch(/^pi-dashboard-[0-9a-f]{12}-\d+$/);
    expect(n.host).toBe(`${n.instance}.local`);
    expect(n.instance).toMatch(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/);
    expect(n.instance.length).toBeLessThanOrEqual(63);
  });

  it("separates two servers on one machine by port", () => {
    const a = deriveAdvertisedNames(FP, 8000);
    const b = deriveAdvertisedNames(FP, 8001);
    expect(a.instance).not.toBe(b.instance);
    expect(a.host).not.toBe(b.host);
  });
});

describe("advertiseDashboard names and records", () => {
  afterEach(() => {
    stopAdvertising();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function advertiseWith(opts: Record<string, unknown> = {}) {
    const captured: { svc: Service; config: AdvertisePublishConfig }[] = [];
    const publish = (config: AdvertisePublishConfig) => {
      const { svc } = fakeService(config);
      captured.push({ svc, config });
      return svc;
    };
    const verdict = advertiseDashboard(8000, 9999, {
      fingerprint: FP,
      addresses: ["192.168.16.31"],
      version: "0.9.0",
      publish,
      ...quiet,
      ...opts,
    });
    return { captured, verdict };
  }

  it("#E3 same instance name and SRV target regardless of os.hostname()", () => {
    const seen: Array<{ name: string; target: string }> = [];
    for (const h of ["mac-1.local", "mac-2.local"]) {
      vi.spyOn(os, "hostname").mockReturnValue(h);
      const { captured } = advertiseWith();
      const srv = captured[0].svc.records().find((r: any) => r.type === "SRV") as any;
      seen.push({ name: captured[0].config.name, target: srv.data.target });
      stopAdvertising();
    }
    expect(seen[0]).toEqual(seen[1]);
  });

  it("#E4 never contests the OS hostname", () => {
    vi.spyOn(os, "hostname").mockReturnValue("Roberts-MacBook-Pro-8559.local");
    const { captured } = advertiseWith();
    const recs = captured[0].svc.records() as any[];
    const bad = ["Roberts-MacBook-Pro-8559", "Roberts-MacBook-Pro-8559.local"];
    for (const r of recs) {
      if (r.type === "A" || r.type === "AAAA") expect(bad).not.toContain(r.name);
      if (r.type === "SRV") expect(bad).not.toContain(r.data.target);
    }
  });

  it("#E6 TXT carries version, fp, pid, piPort and display name", () => {
    vi.spyOn(os, "hostname").mockReturnValue("home-imac-75340.local");
    let { captured } = advertiseWith({ name: "Studio" });
    expect(captured[0].config.txt).toMatchObject({
      version: "0.9.0",
      fp: FP,
      pid: String(process.pid),
      piPort: "9999",
      name: "Studio",
    });
    stopAdvertising();
    ({ captured } = advertiseWith());
    expect(captured[0].config.txt.name).toBe("home-imac-75340");
  });

  it("publishes with probe enabled and the derived host", () => {
    const { captured } = advertiseWith();
    const n = deriveAdvertisedNames(FP, 8000);
    expect(captured[0].config).toMatchObject({ probe: true, host: n.host, name: n.instance });
  });

  it("only the given addresses appear as A/AAAA records", () => {
    const { captured } = advertiseWith({ addresses: ["192.168.16.31", "2001:db8::5"] });
    const addr = (captured[0].svc.records() as any[]).filter((r) => r.type === "A" || r.type === "AAAA");
    expect(addr.map((r) => [r.type, r.data])).toEqual([
      ["A", "192.168.16.31"],
      ["AAAA", "2001:db8::5"],
    ]);
  });

  it("#X2 fails closed when the service already announced", () => {
    const stops: Array<ReturnType<typeof vi.fn>> = [];
    const publish = (config: AdvertisePublishConfig) => {
      const { svc, stop } = fakeService(config, true);
      stops.push(stop);
      return svc;
    };
    const logs: string[] = [];
    const v = advertiseDashboard(8000, 9999, {
      fingerprint: FP,
      addresses: ["192.168.16.31"],
      publish,
      log: (m) => logs.push(m),
    });
    expect(v.advertise).toBe(false);
    expect(stops[0]).toHaveBeenCalled();
    expect(logs.join("\n")).toMatch(/not advertising/);
  });

  it("#X3 retries a probe conflict 3 times 5 s apart, then warns", () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const publish = vi.fn((config: AdvertisePublishConfig) => fakeService(config).svc);
    advertiseDashboard(8000, 9999, { fingerprint: FP, addresses: ["192.168.16.31"], publish, ...quiet });
    expect(publish).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(publish).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(5000);
    expect(publish).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(10_000);
    expect(publish).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = String(warn.mock.calls[0][0]);
    expect(msg).toContain(deriveAdvertisedNames(FP, 8000).instance);
    expect(msg).toContain("identity.key");
  });

  it("#X3 a conflict that clears on attempt 2 does not warn", () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let n = 0;
    const publish = vi.fn((config: AdvertisePublishConfig) => {
      const { svc } = fakeService(config);
      n++;
      if (n === 2) setTimeout(() => (svc.published = true), 1000);
      return svc;
    });
    advertiseDashboard(8000, 9999, { fingerprint: FP, addresses: ["192.168.16.31"], publish, ...quiet });
    vi.advanceTimersByTime(30_000);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(warn).not.toHaveBeenCalled();
  });

  it("#X4 teardown goodbye carries derived names and only the overridden addresses", () => {
    const goodbye: any[][] = [];
    const publish = (config: AdvertisePublishConfig) => {
      const { svc } = fakeService(config);
      (svc as any).stop = (cb?: () => void) => {
        goodbye.push(svc.records().map((r: any) => ({ ...r, ttl: 0 })));
        cb?.();
      };
      return svc;
    };
    advertiseDashboard(8000, 9999, { fingerprint: FP, addresses: ["192.168.16.31"], publish, ...quiet });
    stopAdvertising();
    const n = deriveAdvertisedNames(FP, 8000);
    const recs = goodbye[0];
    expect(recs.every((r) => r.ttl === 0)).toBe(true);
    expect(recs.find((r) => r.type === "SRV").data.target).toBe(n.host);
    expect(recs.filter((r) => r.type === "A" || r.type === "AAAA").map((r) => r.data)).toEqual(["192.168.16.31"]);
  });

  it("#F3 re-advertises on address change and not when unchanged", async () => {
    let tick: () => void = () => {};
    const stops: Array<ReturnType<typeof vi.fn>> = [];
    const published: Service[] = [];
    const publish = (config: AdvertisePublishConfig) => {
      const { svc, stop } = fakeService(config);
      stops.push(stop);
      published.push(svc);
      return svc;
    };
    let next = ["192.168.16.40"];
    advertiseDashboard(8000, 9999, {
      fingerprint: FP,
      addresses: ["192.168.16.31"],
      publish,
      resolveAddresses: async () => next,
      schedule: (fn) => {
        tick = fn;
        return () => {};
      },
      ...quiet,
    });
    tick();
    await vi.waitFor(() => expect(published).toHaveLength(2));
    expect(stops[0]).toHaveBeenCalled();
    expect((published[1].records() as any[]).filter((r) => r.type === "A").map((r) => r.data)).toEqual([
      "192.168.16.40",
    ]);
    tick();
    await new Promise((r) => setTimeout(r, 20));
    expect(published).toHaveLength(2);
  });

  it("#F3 withdraws the advert when no address is left, and republishes when one returns", async () => {
    let tick: () => void = () => {};
    const stops: Array<ReturnType<typeof vi.fn>> = [];
    const published: Service[] = [];
    const publish = (config: AdvertisePublishConfig) => {
      const { svc, stop } = fakeService(config);
      stops.push(stop);
      published.push(svc);
      return svc;
    };
    let next: string[] = [];
    advertiseDashboard(8000, 9999, {
      fingerprint: FP,
      addresses: ["192.168.16.31"],
      publish,
      resolveAddresses: async () => next,
      schedule: (fn) => {
        tick = fn;
        return () => {};
      },
      ...quiet,
    });
    tick();
    await vi.waitFor(() => expect(stops[0]).toHaveBeenCalled());
    expect(published).toHaveLength(1);
    next = ["192.168.16.40"];
    tick();
    await vi.waitFor(() => expect(published).toHaveLength(2));
    expect((published[1].records() as any[]).filter((r) => r.type === "A").map((r) => r.data)).toEqual(["192.168.16.40"]);
  });
});

describe("resolveAdvertisedAddresses (#E5)", () => {
  const ifaces = () => ({
    en0: [
      { address: "192.168.16.31", family: "IPv4", internal: false, mac: "aa:bb:cc:dd:ee:01" },
      { address: "fe80::1", family: "IPv6", internal: false, mac: "aa:bb:cc:dd:ee:01" },
    ],
    utun3: [{ address: "100.83.1.2", family: "IPv4", internal: false, mac: "00:00:00:00:00:01" }],
    docker0: [{ address: "172.17.0.1", family: "IPv4", internal: false, mac: "02:42:00:00:00:01" }],
    lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true, mac: "00:00:00:00:00:00" }],
  }) as never;

  const lookup = async (h: string) => {
    if (h === "dash.local") return ["192.168.16.31", "10.9.9.9"];
    throw new Error("ENOTFOUND");
  };

  it.each([
    ["192.168.16.31", ["192.168.16.31"]],
    ["0.0.0.0", ["192.168.16.31", "100.83.1.2"]],
    ["::", ["192.168.16.31", "100.83.1.2"]],
    ["dash.local", ["192.168.16.31"]],
    ["nohost.invalid", []],
    ["127.0.0.1", []],
  ])("bindHost %s → %j", async (bindHost, expected) => {
    expect(await resolveAdvertisedAddresses(bindHost, { interfaces: ifaces, lookup })).toEqual(expected);
  });
});

// ── TXT is a hint: only `fp` identifies, no address of another route leaks ──
// See change: group-servers-by-identity (test-plan #E13, task 4.5)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fingerprintFromPublicKeyB64 } from "../server-pinning.js";

describe("advertised TXT carries only fp for identity (#E13)", () => {
  const TUNNEL = "https://k3x9p2.share.zrok.io";
  const PUBLIC = "https://dash.example.org";
  let home: string;
  let origHome: string | undefined;

  afterEach(() => {
    stopAdvertising();
    if (home) {
      process.env.HOME = origHome;
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  /** An identity as the challenge route proves it: fingerprint recomputed from the public key. */
  function identity() {
    const { publicKey } = crypto.generateKeyPairSync("ed25519");
    const b64 = (publicKey.export({ type: "spki", format: "der" }) as Buffer).toString("base64url");
    return fingerprintFromPublicKeyB64(b64) as string;
  }

  /** A config that names a tunnel and a public base URL; the advert must not read it. */
  function configureTunnelAndPublicUrl() {
    origHome = process.env.HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-mdns-txt-"));
    process.env.HOME = home;
    fs.mkdirSync(path.join(home, ".pi", "dashboard"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".pi", "dashboard", "config.json"),
      JSON.stringify({ publicBaseUrls: [PUBLIC], tunnel: { enabled: true, url: TUNNEL }, pairing: { publicBaseUrls: [TUNNEL] } }),
    );
  }

  function txtFor(opts: Record<string, unknown>) {
    const captured: AdvertisePublishConfig[] = [];
    advertiseDashboard(8000, 9999, {
      addresses: ["192.168.16.31"],
      version: "0.9.0",
      publish: (config: AdvertisePublishConfig) => {
        captured.push(config);
        return fakeService(config).svc;
      },
      ...quiet,
      ...opts,
    } as never);
    return captured[0].txt;
  }

  it("with an identity: keys are exactly version, pid, piPort, name, fp — and fp is the challenge fingerprint", () => {
    configureTunnelAndPublicUrl();
    const fp = identity();
    const txt = txtFor({ fingerprint: fp, name: "Studio", tunnelUrl: TUNNEL, publicBaseUrl: PUBLIC, publicBaseUrls: [PUBLIC, TUNNEL] });
    expect(Object.keys(txt).sort()).toEqual(["fp", "name", "piPort", "pid", "version"].sort());
    expect(txt.fp).toBe(fp);
    expect(txt.version).not.toBe("0.0.0");
  });

  it("without an identity: no fp key at all", () => {
    configureTunnelAndPublicUrl();
    const txt = txtFor({ name: "Studio", tunnelUrl: TUNNEL });
    expect(Object.keys(txt).sort()).toEqual(["name", "piPort", "pid", "version"].sort());
    expect("fp" in txt).toBe(false);
  });

  it("no value contains a tunnel or public URL", () => {
    configureTunnelAndPublicUrl();
    const txt = txtFor({ fingerprint: identity(), name: "Studio", tunnelUrl: TUNNEL, publicBaseUrl: PUBLIC });
    for (const value of Object.values(txt)) {
      expect(value).not.toMatch(/zrok|https?:\/\/|example\.org/i);
    }
  });
});

// ── virtual-bridge exclusion + locality by fingerprint ──
// See change: harden-peer-address-identity (test-plan #E9, #E10)
describe("resolveAdvertisedAddresses skips macOS virtual bridges (#E10)", () => {
  const ifaces = () =>
    ({
      en0: [{ address: "192.168.16.31", family: "IPv4", internal: false, mac: "aa:bb:cc:dd:ee:01" }],
      utun3: [{ address: "100.83.1.2", family: "IPv4", internal: false, mac: "00:00:00:00:00:01" }],
      docker0: [{ address: "172.17.0.1", family: "IPv4", internal: false, mac: "02:42:00:00:00:01" }],
      bridge102: [{ address: "192.168.64.1", family: "IPv4", internal: false, mac: "aa:bb:cc:dd:ee:02" }],
      vmnet1: [{ address: "172.16.184.1", family: "IPv4", internal: false, mac: "aa:bb:cc:dd:ee:03" }],
      vboxnet0: [{ address: "192.168.56.1", family: "IPv4", internal: false, mac: "0a:00:27:00:00:00" }],
    }) as never;

  it("advertises only en0 and utun", async () => {
    expect(await resolveAdvertisedAddresses("0.0.0.0", { interfaces: ifaces, lookup: async () => [] })).toEqual([
      "192.168.16.31",
      "100.83.1.2",
    ]);
  });
});

describe("isLocalService fingerprint veto (#E9)", () => {
  const LOCAL = "192.168.64.1";
  const own = (fp: string | undefined) => () => fp;
  const svc = (fp: string | undefined, addresses: string[]) =>
    ({ host: "peer.local", port: 8000, addresses, txt: fp ? { fp } : {} }) as never;

  beforeEach(() => {
    vi.spyOn(os, "networkInterfaces").mockReturnValue({
      bridge102: [{ address: LOCAL, family: "IPv4", internal: false, mac: "aa:bb:cc:dd:ee:02" }],
    } as never);
    vi.spyOn(os, "hostname").mockReturnValue("this-mac");
  });
  afterEach(() => vi.restoreAllMocks());

  it("a differing advert fp vetoes address overlap", () => {
    expect(isLocalService(svc("sha256:P", [LOCAL]), own("sha256:L"))).toBe(false);
  });
  it("a matching fp with no address overlap is not local (clone listed)", () => {
    expect(isLocalService(svc("sha256:L", ["10.1.1.1"]), own("sha256:L"))).toBe(false);
  });
  it("a matching fp with overlap is local", () => {
    expect(isLocalService(svc("sha256:L", [LOCAL]), own("sha256:L"))).toBe(true);
  });
  it("unknown own fp falls back to the address heuristic", () => {
    expect(isLocalService(svc("sha256:P", [LOCAL]), own(undefined))).toBe(true);
    expect(isLocalService(svc("sha256:P", [LOCAL]))).toBe(true);
  });
  it("an advert without fp falls back to the address heuristic", () => {
    expect(isLocalService(svc(undefined, [LOCAL]), own("sha256:L"))).toBe(true);
  });
});
