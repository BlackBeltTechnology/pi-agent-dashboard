import { describe, expect, it } from "vitest";
import {
  addTrustedNetwork,
  appendPublicBaseUrl,
  collectTrustedEntries,
  isSecureBaseUrl,
  isValidTrustEntry,
  removeTrustedNetwork,
  suggestTrustEntries,
  unreachableTrustedEntries,
} from "../gateway/gateway-config-ops.js";

describe("isSecureBaseUrl", () => {
  it("accepts https and wss only", () => {
    expect(isSecureBaseUrl("https://a.example")).toBe(true);
    expect(isSecureBaseUrl("wss://a.example")).toBe(true);
    expect(isSecureBaseUrl("http://a.example")).toBe(false);
    expect(isSecureBaseUrl("ws://a.example")).toBe(false);
    expect(isSecureBaseUrl("not a url")).toBe(false);
    expect(isSecureBaseUrl("")).toBe(false);
  });
});

describe("appendPublicBaseUrl", () => {
  it("appends a trimmed https url to a fresh config", () => {
    const next = appendPublicBaseUrl(undefined, "  https://a.example  ");
    expect(next.publicBaseUrls).toEqual(["https://a.example"]);
  });

  it("appends to the existing top-level list", () => {
    const next = appendPublicBaseUrl({ publicBaseUrls: ["https://a.example"] }, "wss://b.example");
    expect(next.publicBaseUrls).toEqual(["https://a.example", "wss://b.example"]);
  });

  // #G15 (client half): the first top-level write seeds from the legacy key,
  // else the operator's existing entries vanish from the QR.
  it("seeds the top-level list from the legacy pairing key on first write", () => {
    const next = appendPublicBaseUrl(
      { pairing: { publicBaseUrls: ["https://legacy.example"], enabled: true } },
      "https://new.example",
    );
    expect(next.publicBaseUrls).toEqual(["https://legacy.example", "https://new.example"]);
  });

  it("prefers the top-level list when both keys exist", () => {
    const next = appendPublicBaseUrl(
      { publicBaseUrls: ["https://top.example"], pairing: { publicBaseUrls: ["https://legacy.example"] } },
      "https://new.example",
    );
    expect(next.publicBaseUrls).toEqual(["https://top.example", "https://new.example"]);
  });

  it("dedupes and rejects non-secure entries", () => {
    expect(appendPublicBaseUrl({ publicBaseUrls: ["https://a.example"] }, "https://a.example").publicBaseUrls)
      .toEqual(["https://a.example"]);
    expect(() => appendPublicBaseUrl(undefined, "http://a.example")).toThrow(/https|wss/i);
  });

  // D12 task 10.7: the gateway action is the second writer and needs http://.
  it("admits an http gateway when the caller opts out of the UX gate", () => {
    expect(appendPublicBaseUrl(undefined, "http://10.4.0.9:8000", { allowInsecure: true }).publicBaseUrls)
      .toEqual(["http://10.4.0.9:8000"]);
  });
});

describe("trusted networks", () => {
  it("adds and dedupes", () => {
    expect(addTrustedNetwork(["127.0.0.1/8"], "10.147.20.55")).toEqual(["127.0.0.1/8", "10.147.20.55"]);
    expect(addTrustedNetwork(["10.147.20.55"], "10.147.20.55")).toEqual(["10.147.20.55"]);
    expect(addTrustedNetwork(undefined, "10.147.20.55")).toEqual(["10.147.20.55"]);
  });

  it("removes an entry", () => {
    expect(removeTrustedNetwork(["a", "b", "c"], "b")).toEqual(["a", "c"]);
    expect(removeTrustedNetwork(undefined, "b")).toEqual([]);
  });
});

describe("suggestTrustEntries", () => {
  it("offers exact /32 as the default plus a wider mesh subnet", () => {
    const s = suggestTrustEntries("10.147.20.55");
    expect(s[0]).toEqual({ value: "10.147.20.55", label: expect.stringMatching(/exact/i), wide: false });
    expect(s.some((e) => e.value === "10.0.0.0/8" && e.wide)).toBe(true);
  });

  it("suggests the tailnet CGNAT range for 100.64.0.0/10 addresses", () => {
    const s = suggestTrustEntries("100.101.22.7");
    expect(s.some((e) => e.value === "100.64.0.0/10" && e.wide)).toBe(true);
  });

  it("returns only the exact host for a plain LAN 192.168 address (no huge subnet)", () => {
    const s = suggestTrustEntries("192.168.1.44");
    expect(s.some((e) => e.value === "192.168.1.0/24" && e.wide)).toBe(true);
  });
});

// ── Bind-vs-trust reachability predicate (test-plan #E1–#E16) ──────────
// See change: warn-unreachable-trusted-networks.
describe("unreachableTrustedEntries", () => {
  it("#E1 reports a LAN range as unreachable from a loopback bind", () => {
    expect(unreachableTrustedEntries("127.0.0.1", ["192.168.1.0/24"])).toEqual(["192.168.1.0/24"]);
  });

  it("#E2 reports a LAN range as unreachable from an unrelated specific NIC", () => {
    expect(unreachableTrustedEntries("10.0.0.5", ["192.168.1.0/24"])).toEqual(["192.168.1.0/24"]);
  });

  it("#E3 reports nothing when the bind host sits inside the range", () => {
    expect(unreachableTrustedEntries("192.168.1.42", ["192.168.1.0/24"])).toEqual([]);
  });

  it("#E4 accepts the network address as the lower boundary", () => {
    expect(unreachableTrustedEntries("192.168.1.0", ["192.168.1.0/24"])).toEqual([]);
  });

  it("#E5 accepts the broadcast address as the upper boundary", () => {
    expect(unreachableTrustedEntries("192.168.1.255", ["192.168.1.0/24"])).toEqual([]);
  });

  it("#E6 reports just outside the upper boundary as unreachable", () => {
    expect(unreachableTrustedEntries("192.168.2.1", ["192.168.1.0/24"])).toEqual(["192.168.1.0/24"]);
  });

  it("#E7 reports nothing at all for a 0.0.0.0 bind", () => {
    const entries = ["192.168.1.0/24", "10.0.0.*", "1.2.3.4"];
    expect(unreachableTrustedEntries("0.0.0.0", entries)).toEqual([]);
  });

  it("#E8 exempts a loopback entry before containment is consulted", () => {
    expect(unreachableTrustedEntries("10.0.0.5", ["127.0.0.1"])).toEqual([]);
  });

  it("#E9 exempts every loopback-only entry format", () => {
    const entries = ["127.0.0.1", "127.0.0.2", "127.0.0.*", "127.0.0.0/8"];
    expect(unreachableTrustedEntries("127.0.0.1", entries)).toEqual([]);
  });

  it("#E10 does NOT exempt 127.0.0.0/7 — it also covers 126.x", () => {
    expect(unreachableTrustedEntries("127.0.0.1", ["127.0.0.0/7"])).toEqual(["127.0.0.0/7"]);
  });

  it("#E11 fails open for a non-IPv4 bind literal", () => {
    expect(unreachableTrustedEntries("::", ["192.168.1.0/24"])).toEqual([]);
  });

  it("#E12 fails open for a hostname bind", () => {
    expect(unreachableTrustedEntries("myhost.local", ["192.168.1.0/24"])).toEqual([]);
  });

  it("#E13 reports only the entries that miss, keeping the ones that cover", () => {
    expect(unreachableTrustedEntries("10.0.0.5", ["10.0.*.*", "192.168.1.*"])).toEqual(["192.168.1.*"]);
  });

  it("#E14 returns [] and does not throw for empty or absent entry lists", () => {
    expect(unreachableTrustedEntries("127.0.0.1", [])).toEqual([]);
    expect(unreachableTrustedEntries("127.0.0.1", undefined)).toEqual([]);
  });

  it("#E15 skips malformed entries rather than reporting them unreachable", () => {
    const entries = ["not-an-ip", "999.1.1.1", "10.0.0.0/33"];
    expect(unreachableTrustedEntries("127.0.0.1", entries)).toEqual([]);
    expect(entries.every((e) => !isValidTrustEntry(e))).toBe(true);
  });

  it("#E16 evaluates the union of trustedNetworks and auth.bypassHosts", () => {
    const config = {
      trustedNetworks: ["192.168.1.0/24"],
      auth: { bypassHosts: ["10.0.0.0/8"] },
    };
    const entries = collectTrustedEntries(config);
    expect(entries).toEqual(["192.168.1.0/24", "10.0.0.0/8"]);
    expect(unreachableTrustedEntries("127.0.0.1", entries).sort()).toEqual(
      ["10.0.0.0/8", "192.168.1.0/24"],
    );
  });
});
