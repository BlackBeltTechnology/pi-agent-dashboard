import { describe, expect, it } from "vitest";
import {
  addTrustedNetwork,
  appendPublicBaseUrl,
  isSecureBaseUrl,
  removeTrustedNetwork,
  suggestTrustEntries,
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
