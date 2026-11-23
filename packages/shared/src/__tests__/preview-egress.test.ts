/**
 * canonicalHttpsOrigin (E3) + isUngrantableEgressOrigin (E4).
 * See change: improve-canvas-html-and-url-ux.
 */
import { describe, expect, it } from "vitest";
import { canonicalHttpsOrigin, isPublicUnicastAddress, isUngrantableEgressOrigin } from "../preview-egress.js";

describe("canonicalHttpsOrigin (E3)", () => {
  it("canonicalises case, trailing dot and default port", () => {
    expect(canonicalHttpsOrigin("https://CDN.Example.com.:443/x")).toBe("https://cdn.example.com");
  });
  it("keeps a non-default port", () => {
    expect(canonicalHttpsOrigin("https://cdn.example.com:8443/x")).toBe("https://cdn.example.com:8443");
  });
  it("rejects userinfo, http and junk", () => {
    expect(canonicalHttpsOrigin("https://u:p@cdn.example.com")).toBeNull();
    expect(canonicalHttpsOrigin("http://cdn.example.com")).toBeNull();
    expect(canonicalHttpsOrigin("not a url")).toBeNull();
  });
  it("punycodes IDNs", () => {
    expect(canonicalHttpsOrigin("https://bücher.example")).toBe("https://xn--bcher-kva.example");
  });
});

describe("isUngrantableEgressOrigin (E4)", () => {
  const own = ["https://dash.trycloudflare.com"];
  it.each([
    "https://localhost:8000",
    "https://app.localhost",
    "https://[::ffff:127.0.0.1]",
    "https://0x7f.1",
    "https://10.0.0.5",
    "https://100.64.0.1",
    "https://[fd00::1]",
    "https://[::1]",
    "https://[fe80::1]",
    "https://intranet",
    "https://x.local",
    "https://x.internal",
    "https://127-0-0-1.example.io",
    "https://10.0.0.5.example.io",
    "https://dash.trycloudflare.com",
    "http://cdn.jsdelivr.net",
    "https://u:p@cdn.jsdelivr.net",
  ])("refuses %s", (o) => expect(isUngrantableEgressOrigin(o, own)).toBe(true));
  it.each(["https://cdn.jsdelivr.net", "https://cdn.tailwindcss.com", "https://fonts.googleapis.com"])(
    "allows %s",
    (o) => expect(isUngrantableEgressOrigin(o, own)).toBe(false),
  );
});

describe("isPublicUnicastAddress (E33)", () => {
  it.each(["8.8.8.8", "1.1.1.1", "2606:4700::1111"])("accepts public %s", (ip) =>
    expect(isPublicUnicastAddress(ip)).toBe(true),
  );
  it.each([
    "10.0.0.1",
    "172.31.255.255",
    "192.168.0.1",
    "127.0.0.1",
    "0.0.0.0",
    "100.64.0.1",
    "169.254.169.254",
    "192.0.0.1",
    "192.0.2.1",
    "192.88.99.1",
    "198.18.0.1",
    "198.19.255.255",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "fc00::1",
    "fe80::1",
    "fec0::1",
    "ff02::1",
    "100::1",
    "2001::1",
    "2001:10::1",
    "2001:db8::1",
    "2002:c0a8::1",
    "64:ff9b::a00:1",
    "64:ff9b:1::1",
    "::ffff:10.0.0.1",
    "::ffff:8.8.8.8",
    "::ffff:0:a00:1",
    "::8.8.8.8",
    "fe80::1%eth0",
    "not-an-ip",
    "",
    "8.8.8",
    "8.8.8.8.8",
    "08.8.8.8",
    "256.1.1.1",
    "[2606:4700::1111]",
  ])("refuses %s (fail closed)", (ip) => expect(isPublicUnicastAddress(ip)).toBe(false));
  it("strips a zone id before classifying (public stays public)", () => {
    expect(isPublicUnicastAddress("2606:4700::1111%eth0")).toBe(true);
  });
});
