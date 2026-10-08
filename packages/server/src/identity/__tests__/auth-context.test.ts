import { describe, expect, it } from "vitest";
import { buildAuthContext, canonicalOrigin, type RequestLike } from "../auth-context.js";

const req = (over: Partial<RequestLike> = {}): RequestLike => ({
  method: "GET",
  url: "/api/sessions?x=1#frag",
  ip: "10.0.0.5",
  headers: { host: "raw-host:9999", authorization: "Bearer tok", cookie: "a=b", dpop: "proof" },
  isAuthenticated: false,
  ...over,
});

describe("canonicalOrigin (D6a)", () => {
  it("derives scheme+host from the configured public base, not the socket", () => {
    expect(canonicalOrigin("https://kc.example.com:8443/dash/")).toBe(
      "https://kc.example.com:8443",
    );
  });
  it("never trusts a raw Host header when no public base is configured", () => {
    expect(canonicalOrigin(null)).toBe("http://localhost");
  });
});

describe("buildAuthContext (§4.2 / D6)", () => {
  it("exposes only the curated allowlist", () => {
    const ctx = buildAuthContext(req(), "https://ext.example.com");
    expect(Object.keys(ctx).sort()).toEqual(
      ["authorization", "cookie", "dpop", "ip", "isAuthenticated", "method", "url"].sort(),
    );
  });

  it("builds canonical url = external origin + path, query/fragment stripped", () => {
    const ctx = buildAuthContext(req(), "https://ext.example.com");
    expect(ctx.url).toBe("https://ext.example.com/api/sessions");
  });

  it("carries method, ip, headers, and isAuthenticated through", () => {
    const ctx = buildAuthContext(req({ isAuthenticated: true }), null);
    expect(ctx.method).toBe("GET");
    expect(ctx.ip).toBe("10.0.0.5");
    expect(ctx.authorization).toBe("Bearer tok");
    expect(ctx.cookie).toBe("a=b");
    expect(ctx.dpop).toBe("proof");
    expect(ctx.isAuthenticated).toBe(true);
  });

  it("omits absent optional headers rather than setting undefined", () => {
    const ctx = buildAuthContext(req({ headers: { host: "h" } }), null);
    expect("authorization" in ctx).toBe(false);
    expect("cookie" in ctx).toBe(false);
    expect("dpop" in ctx).toBe(false);
  });
});
