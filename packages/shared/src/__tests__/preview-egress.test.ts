/**
 * canonicalHttpsOrigin (E3) + isUngrantableEgressOrigin (E4).
 * See change: improve-canvas-html-and-url-ux.
 */
import { describe, expect, it } from "vitest";
import { canonicalHttpsOrigin, isUngrantableEgressOrigin } from "../preview-egress.js";

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
