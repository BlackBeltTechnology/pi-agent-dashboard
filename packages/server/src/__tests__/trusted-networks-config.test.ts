import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  deriveInterfaceSuggestions,
  interfaceLabel,
  isLoopbackOnlyEntry,
} from "@blackbelt-technology/pi-dashboard-shared/bind-reachability.js";
import { loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { suggestTrustEntries } from "../../../client/src/lib/gateway/gateway-config-ops.js";
import { authorizeWsUpgrade } from "../auth/auth-plugin.js";
import { createNetworkGuard } from "../auth/localhost-guard.js";
import { admissionTrustedNetworks, effectiveTrustMode, resetTrustModeForTests } from "../auth/trust-mode.js";
import { decideBootTrustMode } from "../auth/trust-mode-boot.js";
import { writeConfigPartial } from "../config-api.js";
import { resetConfigSnapshot } from "../config-snapshot.js";
import { buildNetworkInterfaceList } from "../routes/network-interfaces.js";

describe("trustedNetworks config", () => {
  let testDir: string;
  let configFile: string;
  let origHome: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `test-trusted-nets-${Date.now()}`);
    fs.mkdirSync(path.join(testDir, ".pi", "dashboard"), { recursive: true });
    configFile = path.join(testDir, ".pi", "dashboard", "config.json");
    origHome = process.env.HOME!;
    process.env.HOME = testDir;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("should default to empty arrays when not configured", () => {
    fs.writeFileSync(configFile, JSON.stringify({ port: 8000 }));
    const config = loadConfig();
    expect(config.trustedNetworks).toEqual([]);
    expect(config.resolvedTrustedNetworks).toEqual([]);
  });

  it("should parse trustedNetworks", () => {
    fs.writeFileSync(configFile, JSON.stringify({
      trustedNetworks: ["192.168.1.0/24", "10.0.0.*"],
    }));
    const config = loadConfig();
    expect(config.trustedNetworks).toEqual(["192.168.1.0/24", "10.0.0.*"]);
    expect(config.resolvedTrustedNetworks).toEqual(["192.168.1.0/24", "10.0.0.*"]);
  });

  it("should merge trustedNetworks with auth.bypassHosts", () => {
    fs.writeFileSync(configFile, JSON.stringify({
      trustedNetworks: ["192.168.1.0/24"],
      auth: {
        secret: "s",
        providers: { github: { clientId: "a", clientSecret: "b" } },
        bypassHosts: ["10.0.0.0/8"],
      },
    }));
    const config = loadConfig();
    expect(config.resolvedTrustedNetworks).toContain("192.168.1.0/24");
    expect(config.resolvedTrustedNetworks).toContain("10.0.0.0/8");
  });

  // Companion to the test above. The archived trusted-networks spec scenario
  // "trustedNetworks merged with auth.bypassHosts" as written did NOT include
  // a `providers` field; the test above silently adds one to make it pass.
  // This second test exercises the literal spec scenario — it would have
  // failed pre-fix (parseAuthConfig nuked the whole auth block when
  // providers was absent) and demonstrates the scenario as written now holds.
  // See openspec/changes/fix-trusted-networks-no-oauth.
  it("should merge trustedNetworks with auth.bypassHosts (no providers configured)", () => {
    fs.writeFileSync(configFile, JSON.stringify({
      trustedNetworks: ["192.168.1.0/24"],
      auth: {
        bypassHosts: ["10.0.0.0/8"],
      },
    }));
    const config = loadConfig();
    expect(config.resolvedTrustedNetworks).toContain("192.168.1.0/24");
    expect(config.resolvedTrustedNetworks).toContain("10.0.0.0/8");
  });

  it("should deduplicate entries", () => {
    fs.writeFileSync(configFile, JSON.stringify({
      trustedNetworks: ["192.168.1.0/24"],
      auth: {
        secret: "s",
        providers: { github: { clientId: "a", clientSecret: "b" } },
        bypassHosts: ["192.168.1.0/24"],
      },
    }));
    const config = loadConfig();
    expect(config.resolvedTrustedNetworks).toEqual(["192.168.1.0/24"]);
  });

  it("should filter non-string entries", () => {
    fs.writeFileSync(configFile, JSON.stringify({
      trustedNetworks: ["192.168.1.0/24", 123, null, ""],
    }));
    const config = loadConfig();
    expect(config.trustedNetworks).toEqual(["192.168.1.0/24"]);
  });

  it("should handle trustedNetworks without auth", () => {
    fs.writeFileSync(configFile, JSON.stringify({
      trustedNetworks: ["10.0.0.0/8"],
    }));
    const config = loadConfig();
    expect(config.resolvedTrustedNetworks).toEqual(["10.0.0.0/8"]);
    expect(config.auth).toBeUndefined();
  });
});

// ── Interface suggestions (test-plan #E21–#E25, #E28–#E29) ─────────────
// `+ Add Local Network` used to compute offers by netmask arithmetic alone, so
// a Tailscale NIC offered `<self>/32` — an entry that trusts nobody new, since
// the host is already loopback-exempt. The offers now come from the shared
// well-known-range table, the same one the block-event banner reads.
// See change: warn-unreachable-trusted-networks.
describe("interface trust suggestions", () => {
  it("#E21 offers the containing CGNAT range for a Tailscale /32, never <self>/32", () => {
    const out = deriveInterfaceSuggestions({ address: "100.97.246.31", netmask: "255.255.255.255" });
    expect(out.pointToPoint).toBe(true);
    expect(out.suggestions).toEqual([
      { value: "100.64.0.0/10", label: "tailnet CGNAT range", wide: true },
    ]);
    expect(out.suggestions.some((s) => s.value === "100.97.246.31/32")).toBe(false);
  });

  it("#E22 offers the netmask-derived subnet for a broadcast interface, not wide", () => {
    const out = deriveInterfaceSuggestions({ address: "192.168.10.123", netmask: "255.255.255.0" });
    expect(out.pointToPoint).toBe(false);
    expect(out.suggestions).toHaveLength(1);
    expect(out.suggestions[0].value).toBe("192.168.10.0/24");
    expect(out.suggestions[0].wide).toBe(false);
  });

  it("#E23 offers nothing for a /32 outside every well-known range", () => {
    const out = deriveInterfaceSuggestions({ address: "203.0.113.7", netmask: "255.255.255.255" });
    expect(out.pointToPoint).toBe(true);
    expect(out.suggestions).toEqual([]);
  });

  it("#E24 offers the containing private range for other /32 addresses, marked wide", () => {
    const a = deriveInterfaceSuggestions({ address: "172.20.0.5", netmask: "255.255.255.255" });
    expect(a.suggestions).toEqual([{ value: "172.20.0.0/16", label: "private /16 subnet", wide: true }]);
    const b = deriveInterfaceSuggestions({ address: "10.9.9.9", netmask: "255.255.255.255" });
    expect(b.suggestions).toEqual([{ value: "10.0.0.0/8", label: "mesh /8 subnet", wide: true }]);
  });

  it("#E25 keeps one entry per address so the listen-interface picker stays complete", () => {
    // The endpoint must NOT dedupe: `ListenInterfaceField` keys its options on
    // `address`, so dropping en7 would make that bind address unselectable.
    const ifaces = [
      { name: "en0", address: "192.168.10.123", netmask: "255.255.255.0" },
      { name: "en7", address: "192.168.10.224", netmask: "255.255.255.0" },
    ];
    const built = ifaces.map((i) => ({ ...i, ...deriveInterfaceSuggestions(i) }));
    expect(built).toHaveLength(2);
    expect(built.map((e) => e.address)).toEqual(["192.168.10.123", "192.168.10.224"]);
  });

  it("#E28 falls back to the device name for an interface in no well-known range", () => {
    expect(interfaceLabel("en3", "203.0.113.7")).toBe("en3");
    expect(interfaceLabel("utun4", "100.97.246.31")).not.toBe("utun4");
  });

  it("#E29 derives the same containing range from the interface and block-event paths", () => {
    const fromInterface = deriveInterfaceSuggestions({
      address: "100.97.246.31",
      netmask: "255.255.255.255",
    }).suggestions[0].value;
    const fromBlockEvent = suggestTrustEntries("100.97.246.31").find((s) => s.wide)?.value;
    expect(fromInterface).toBe("100.64.0.0/10");
    expect(fromBlockEvent).toBe("100.64.0.0/10");
    expect(fromInterface).toBe(fromBlockEvent);
  });
});

// ── Regression: an unusable netmask must never become a trust offer ────
// `netmaskBits` scores 0 both for a genuine /0 and for a netmask that does not
// parse, and the naive `${network}/${bits}` then rendered `<address>/0` — an
// entry granting unauthenticated access to the ENTIRE IPv4 space, one click
// away in the dropdown. Found by CodeRabbit on PR #483.
// See change: warn-unreachable-trusted-networks.
describe("unusable netmask", () => {
  it("offers nothing for a netmask that does not parse", () => {
    for (const netmask of ["", "not-a-mask", "255.255.255", "999.0.0.0"]) {
      const out = deriveInterfaceSuggestions({ address: "192.168.10.123", netmask });
      expect(out.suggestions).toEqual([]);
      expect(out.suggestions.some((s) => s.value.endsWith("/0"))).toBe(false);
    }
  });

  it("offers nothing for a genuine 0.0.0.0 netmask", () => {
    expect(deriveInterfaceSuggestions({ address: "192.168.10.123", netmask: "0.0.0.0" }).suggestions)
      .toEqual([]);
  });

  it("drops such an interface from the endpoint payload rather than publishing <address>/0", () => {
    const out = buildNetworkInterfaceList(() => ({
      bogus: [{ address: "192.168.10.123", netmask: "not-a-mask", family: "IPv4", internal: false, mac: "", cidr: null } as never],
      en0: [{ address: "192.168.10.123", netmask: "255.255.255.0", family: "IPv4", internal: false, mac: "", cidr: null } as never],
    }));
    expect(out.success).toBe(true);
    const data = out.success === true ? out.data : [];
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe("en0");
    expect(data.some((e) => e.cidr.endsWith("/0"))).toBe(false);
  });
});

// ── retire-trusted-networks-bypass: network trust mode (test-plan E1–E5, E8) ──
// The boot decision is made ONCE, persisted, and never re-derived from the list.
// See change: retire-trusted-networks-bypass (design D2).
describe("network trust mode: boot decision and live reads", () => {
  let home: string;
  let configPath: string;
  let origHome: string | undefined;
  let spies: Array<{ mockRestore: () => void }>;

  const tn = (spy: ReturnType<typeof vi.spyOn>) =>
    spy.mock.calls.filter((c: unknown[]) => String(c[0]).includes("[trusted-networks]"));
  const seed = (cfg: unknown) => fs.writeFileSync(configPath, typeof cfg === "string" ? cfg : JSON.stringify(cfg));
  const stored = () => JSON.parse(fs.readFileSync(configPath, "utf-8"));

  let warn: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-trust-mode-"));
    fs.mkdirSync(path.join(home, ".pi", "dashboard"), { recursive: true });
    configPath = path.join(home, ".pi", "dashboard", "config.json");
    origHome = process.env.HOME;
    process.env.HOME = home;
    resetConfigSnapshot();
    resetTrustModeForTests();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    error = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    spies = [warn, error, log];
  });

  afterEach(() => {
    for (const s of spies) s.mockRestore();
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    resetConfigSnapshot();
    resetTrustModeForTests();
    fs.rmSync(home, { recursive: true, force: true });
  });

  /** A guard over `admissionTrustedNetworks`, exactly as `server.ts` wires it. */
  async function guardedGet(ip: string): Promise<number> {
    const app = Fastify({ logger: false });
    app.get("/api/sessions", { preHandler: createNetworkGuard(() => admissionTrustedNetworks()) }, async () => ({ ok: true }));
    try {
      return (await app.inject({ method: "GET", url: "/api/sessions", remoteAddress: ip })).statusCode;
    } finally {
      await app.close();
    }
  }

  const wsOk = (ip: string) =>
    authorizeWsUpgrade({
      remoteAddress: ip,
      secret: "s".repeat(32),
      headers: {},
      trustedNetworks: admissionTrustedNetworks(),
    }).ok;

  // E1 — decision table.
  const table: Array<[string[], "pair" | "legacy"]> = [
    [[], "pair"],
    [["192.168.16.0/24"], "legacy"],
    [["0.0.0.0/0"], "legacy"],
    [["*.*.*.*"], "legacy"],
    [["127.0.0.1", "127.0.0.4/30"], "pair"],
    [["::1"], "pair"],
    [["localhost"], "legacy"],
    [["nas.local"], "legacy"],
  ];
  for (const [list, expected] of table) {
    it(`#E1 no stored mode, list ${JSON.stringify(list)} → writes ${expected} with origin upgrade`, () => {
      seed({ port: 8000, trustedNetworks: list });
      const decision = decideBootTrustMode();
      expect(decision).toEqual({ mode: expected, persisted: true });
      expect(stored().network).toEqual({ trustMode: expected, trustModeOrigin: "upgrade" });
      expect(stored().trustedNetworks).toEqual(list); // list untouched
      expect(effectiveTrustMode()).toEqual({ mode: expected, origin: "upgrade" });
    });
  }

  it("#E1 a fresh install (no config.json at all) decides pair and creates the file", () => {
    expect(fs.existsSync(configPath)).toBe(false);
    expect(decideBootTrustMode()).toEqual({ mode: "pair", persisted: true });
    expect(stored().network).toEqual({ trustMode: "pair", trustModeOrigin: "upgrade" });
  });

  it("#E1 decides over auth.bypassHosts too (merged list), and does not wire through createServer", () => {
    seed({ auth: { bypassHosts: ["192.168.16.0/24"] } });
    expect(decideBootTrustMode().mode).toBe("legacy");
    // `decideBootTrustMode` is a pure module-level function taking injectable
    // `write`/`load`: no `createServer` is needed to exercise it. The single
    // wiring site is asserted structurally: it is the first statement of createServer.
    const src = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "server.ts"), "utf-8");
    const body = src.slice(src.indexOf("export async function createServer(")).split("\n").slice(1);
    const firstStatement = body.map((l) => l.trim()).find((l) => l !== "" && !l.startsWith("//"));
    expect(firstStatement).toBe("decideBootTrustMode();");
  });

  it("#E1 a stored mode is never re-decided (no write)", () => {
    seed({ trustedNetworks: ["192.168.16.0/24"], network: { trustMode: "pair", trustModeOrigin: "operator" } });
    const write = vi.fn();
    expect(decideBootTrustMode({ write })).toEqual({ mode: null, persisted: false });
    expect(write).not.toHaveBeenCalled();
  });

  // E2 — never re-derived.
  it("#E2 stored pair + a bypass host added later + re-decide → still pair, listed peer denied", async () => {
    seed({ network: { trustMode: "pair", trustModeOrigin: "upgrade" } });
    decideBootTrustMode();
    seed({
      network: { trustMode: "pair", trustModeOrigin: "upgrade" },
      auth: { bypassHosts: ["198.51.100.23"] },
    });
    const before = fs.readFileSync(configPath, "utf-8");
    expect(decideBootTrustMode()).toEqual({ mode: null, persisted: false }); // "reboot"
    expect(fs.readFileSync(configPath, "utf-8")).toBe(before);
    expect(effectiveTrustMode().mode).toBe("pair");
    expect(admissionTrustedNetworks()).toEqual([]);
    expect(await guardedGet("198.51.100.23")).toBe(403);
    expect(wsOk("198.51.100.23")).toBe(false);
  });

  // E3 — unrecognised value fails closed, warns once, never rewrites.
  it('#E3 stored trustMode "open" → effective pair, origin null, one warning, bytes unchanged', () => {
    seed({ trustedNetworks: ["192.168.16.0/24"], network: { trustMode: "open" } });
    const before = fs.readFileSync(configPath, "utf-8");
    const write = vi.fn();
    expect(decideBootTrustMode({ write })).toEqual({ mode: null, persisted: false });
    for (let i = 0; i < 100; i++) {
      expect(effectiveTrustMode()).toEqual({ mode: "pair", origin: null });
      expect(admissionTrustedNetworks()).toEqual([]);
    }
    const warnings = tn(warn);
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0][0])).toContain('"open"');
    expect(tn(error)).toHaveLength(0);
    expect(write).not.toHaveBeenCalled();
    expect(fs.readFileSync(configPath, "utf-8")).toBe(before);
  });

  it("#E3 a different unrecognised value warns again (once per value)", () => {
    seed({ network: { trustMode: "open" } });
    effectiveTrustMode();
    seed({ network: { trustMode: "wide-open" } });
    effectiveTrustMode();
    effectiveTrustMode();
    const warnings = tn(warn).map((c: unknown[]) => String(c[0]));
    expect(warnings).toHaveLength(2);
    expect(warnings[1]).toContain('"wide-open"');
  });

  // E4 — unparseable file is never decided or written.
  it("#E4 invalid-JSON config.json → bytes unchanged, effective legacy, one error", () => {
    seed('{"auth":');
    const write = vi.fn();
    const decision = decideBootTrustMode({ write });
    expect(decision).toEqual({ mode: "legacy", persisted: false });
    expect(write).not.toHaveBeenCalled();
    expect(fs.readFileSync(configPath, "utf-8")).toBe('{"auth":');
    expect(effectiveTrustMode().mode).toBe("legacy");
    expect(effectiveTrustMode().origin).toBeNull();
    expect(tn(error)).toHaveLength(1);
  });

  // E5 — write failure fallback.
  it("#E5 persist failure → process fallback applies at the guard and the WS, then a stored value wins live", async () => {
    seed({ port: 8000 }); // empty list ⇒ decided pair
    const decision = decideBootTrustMode({
      write: () => {
        throw new Error("EROFS: read-only file system");
      },
    });
    expect(decision).toEqual({ mode: "pair", persisted: false });
    expect(tn(error)).toHaveLength(1);
    expect(String(tn(error)[0][0])).toContain("EROFS");
    expect(stored()).toEqual({ port: 8000 }); // nothing written

    expect(effectiveTrustMode()).toEqual({ mode: "pair", origin: null });
    expect(await guardedGet("192.168.16.20")).toBe(403);
    expect(wsOk("192.168.16.20")).toBe(false);

    // Operator saves legacy + a list: applies on the next request, no restart.
    const res = writeConfigPartial({ network: { trustMode: "legacy" }, trustedNetworks: ["192.168.16.0/24"] });
    expect(res.success).toBe(true);
    expect(effectiveTrustMode()).toEqual({ mode: "legacy", origin: "operator" });
    expect(await guardedGet("192.168.16.20")).toBe(200);
    expect(wsOk("192.168.16.20")).toBe(true);
    expect(tn(error)).toHaveLength(1); // still just the one boot error
  });

  it("#E5 a write that reports { success: false } is handled like a throw", () => {
    seed({ port: 8000 });
    const decision = decideBootTrustMode({ write: () => ({ success: false, error: "disk full" }) });
    expect(decision).toEqual({ mode: "pair", persisted: false });
    expect(tn(error)).toHaveLength(1);
    expect(effectiveTrustMode().mode).toBe("pair");
  });

  it("#E5 a fallback never overrides a recognised stored value", () => {
    seed({ port: 8000, trustedNetworks: ["192.168.16.0/24"] });
    decideBootTrustMode({ write: () => ({ success: false, error: "x" }) }); // fallback legacy
    expect(effectiveTrustMode().mode).toBe("legacy");
    seed({ port: 8000, trustedNetworks: ["192.168.16.0/24"], network: { trustMode: "pair" } });
    expect(effectiveTrustMode().mode).toBe("pair");
  });
});

// E8 — loopback-only classification feeds the boot decision (design D2).
describe("isLoopbackOnlyEntry (E8)", () => {
  it.each(["127.0.0.1", "127.0.0.4/30", "::1"])("#E8 %s is loopback-only", (entry) => {
    expect(isLoopbackOnlyEntry(entry)).toBe(true);
  });

  it.each(["0.0.0.0/0", "*.*.*.*", "::/0", "192.168.16.0/24", "localhost", "nas.local"])(
    "#E8 %s is NOT loopback-only",
    (entry) => {
      expect(isLoopbackOnlyEntry(entry)).toBe(false);
    },
  );

  it("#E8 also accepts the IPv4-mapped loopback and ::1/128, and refuses wider IPv6 / out-of-range masks", () => {
    expect(isLoopbackOnlyEntry("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackOnlyEntry("::1/128")).toBe(true);
    expect(isLoopbackOnlyEntry("::1/64")).toBe(false);
    expect(isLoopbackOnlyEntry("fe80::/10")).toBe(false);
    expect(isLoopbackOnlyEntry("::ffff:192.168.1.1")).toBe(false);
    expect(isLoopbackOnlyEntry("127.0.0.0/7")).toBe(false);
  });
});
