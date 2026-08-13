import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  deriveInterfaceSuggestions,
  interfaceLabel,
} from "@blackbelt-technology/pi-dashboard-shared/bind-reachability.js";
import { loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { suggestTrustEntries } from "../../../client/src/lib/gateway/gateway-config-ops.js";
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
