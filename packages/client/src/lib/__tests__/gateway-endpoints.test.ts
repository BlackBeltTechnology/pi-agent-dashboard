import type { TunnelEndpoint } from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";
import { describe, expect, it } from "vitest";
import {
  guardPairingUrls,
  isPairingEligible,
  splitEndpoints,
} from "../gateway/gateway-endpoints.js";

const eps: TunnelEndpoint[] = [
  { kind: "public", url: "https://kraken.tailnet-abc.ts.net", tls: true },
  { kind: "public", url: "https://x.share.zrok.io", tls: true },
  { kind: "mesh", url: "http://100.101.22.7:8000", tls: false },
  { kind: "magicdns", url: "http://kraken-mba:8000", tls: false },
  { kind: "lan", url: "http://192.168.1.44:8000", tls: false },
  { kind: "local", url: "http://127.0.0.1:8000", tls: false },
];

describe("isPairingEligible", () => {
  it("accepts https/wss regardless of tls tag drift", () => {
    expect(isPairingEligible({ kind: "public", url: "https://a.example", tls: true })).toBe(true);
    expect(isPairingEligible({ kind: "public", url: "wss://a.example", tls: true })).toBe(true);
    // A tls:true tag on a plain-http url is NOT trusted — scheme is authoritative.
    expect(isPairingEligible({ kind: "public", url: "http://a.example", tls: true })).toBe(false);
  });

  it("rejects plain http mesh/lan/local", () => {
    expect(isPairingEligible({ kind: "mesh", url: "http://100.101.22.7:8000", tls: false })).toBe(false);
    expect(isPairingEligible({ kind: "local", url: "http://127.0.0.1:8000", tls: false })).toBe(false);
  });
});

describe("splitEndpoints", () => {
  it("partitions TLS endpoints into pairing, no-TLS into link", () => {
    const { pairing, link } = splitEndpoints(eps);
    expect(pairing.map((e) => e.url)).toEqual([
      "https://kraken.tailnet-abc.ts.net",
      "https://x.share.zrok.io",
    ]);
    expect(link.map((e) => e.url)).toEqual([
      "http://100.101.22.7:8000",
      "http://kraken-mba:8000",
      "http://192.168.1.44:8000",
      "http://127.0.0.1:8000",
    ]);
  });
});

describe("guardPairingUrls", () => {
  it("passes a list of only-TLS urls through unchanged", () => {
    const urls = ["https://a.example", "wss://b.example"];
    expect(guardPairingUrls(urls)).toEqual(urls);
  });

  it("throws if any plain-http url would enter the pairing payload", () => {
    expect(() => guardPairingUrls(["https://a.example", "http://100.101.22.7:8000"])).toThrow(
      /non-TLS/i,
    );
  });
});
