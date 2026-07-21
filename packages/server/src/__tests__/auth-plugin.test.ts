import { describe, it, expect } from "vitest";
import { validateWsUpgrade, escapeHtml, isBypassed } from "../auth/auth-plugin.js";
import { isBypassedHost } from "../auth/localhost-guard.js";
import { signToken, COOKIE_NAME } from "../auth/auth.js";

const SECRET = "test-secret-for-ws-auth-testing";

describe("validateWsUpgrade", () => {
  it("should allow localhost without cookie", () => {
    expect(validateWsUpgrade(undefined, "127.0.0.1", SECRET)).toBe(true);
    expect(validateWsUpgrade(undefined, "::1", SECRET)).toBe(true);
    expect(validateWsUpgrade(undefined, "::ffff:127.0.0.1", SECRET)).toBe(true);
  });

  it("should reject external request without cookie", () => {
    expect(validateWsUpgrade(undefined, "1.2.3.4", SECRET)).toBe(false);
  });

  it("should reject external request with invalid cookie", () => {
    expect(validateWsUpgrade(`${COOKIE_NAME}=invalidtoken`, "1.2.3.4", SECRET)).toBe(false);
  });

  it("should allow external request with valid cookie", () => {
    const token = signToken({ sub: "user@example.com", name: "User", username: "user", provider: "github" }, SECRET);
    expect(validateWsUpgrade(`${COOKIE_NAME}=${token}`, "1.2.3.4", SECRET)).toBe(true);
  });

  it("should reject external request with wrong secret", () => {
    const token = signToken({ sub: "user@example.com", name: "User", username: "user", provider: "github" }, "other-secret");
    expect(validateWsUpgrade(`${COOKIE_NAME}=${token}`, "1.2.3.4", SECRET)).toBe(false);
  });
});

describe("isBypassed", () => {
  it("should return false for empty bypassUrls list", () => {
    expect(isBypassed("/api/sessions", [])).toBe(false);
  });

  it("should return true when URL starts with a bypass prefix", () => {
    expect(isBypassed("/webhooks/github", ["/webhooks/"])).toBe(true);
  });

  it("should return false when URL does not start with any bypass prefix", () => {
    expect(isBypassed("/api/sessions", ["/webhooks/"])).toBe(false);
  });

  it("should match multiple prefixes", () => {
    expect(isBypassed("/metrics", ["/webhooks/", "/metrics"])).toBe(true);
    expect(isBypassed("/healthz/ready", ["/healthz", "/metrics"])).toBe(true);
  });

  it("should match because startsWith is a prefix check (not word-boundary)", () => {
    // /api/public IS a prefix of /api/publications — this is expected, documented behaviour
    expect(isBypassed("/api/publications", ["/api/public"])).toBe(true);
  });

  it("should not match when prefix is only a substring in the middle", () => {
    expect(isBypassed("/v1/webhooks/data", ["/webhooks/"])).toBe(false);
  });

  it("should return false when no prefix matches", () => {
    expect(isBypassed("/secure/data", ["/webhooks/", "/metrics"])).toBe(false);
  });
});

describe("isBypassedHost", () => {
  it("should return false for empty bypass list", () => {
    expect(isBypassedHost("10.0.0.5", [])).toBe(false);
  });

  it("should match exact IP", () => {
    expect(isBypassedHost("10.0.0.5", ["10.0.0.5"])).toBe(true);
  });

  it("should match exact hostname", () => {
    expect(isBypassedHost("build-server.local", ["build-server.local"])).toBe(true);
  });

  it("should not match different IP", () => {
    expect(isBypassedHost("10.0.0.6", ["10.0.0.5"])).toBe(false);
  });

  it("should match CIDR notation", () => {
    expect(isBypassedHost("192.168.1.50", ["192.168.1.0/24"])).toBe(true);
    expect(isBypassedHost("192.168.2.50", ["192.168.1.0/24"])).toBe(false);
  });

  it("should match wildcard subnet", () => {
    expect(isBypassedHost("10.0.0.99", ["10.0.0.*"])).toBe(true);
    expect(isBypassedHost("10.0.1.99", ["10.0.0.*"])).toBe(false);
  });

  it("should match multiple entries", () => {
    expect(isBypassedHost("10.0.0.5", ["192.168.1.1", "10.0.0.5"])).toBe(true);
  });
});

describe("escapeHtml", () => {
  it("should escape all HTML special characters", () => {
    expect(escapeHtml('&<>"\'')).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("should escape script tags to prevent XSS", () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("should escape crafted email addresses", () => {
    expect(escapeHtml('<img onerror="alert(1)" src=x>@evil.com')).toBe(
      '&lt;img onerror=&quot;alert(1)&quot; src=x&gt;@evil.com',
    );
  });

  it("should pass through safe strings unchanged", () => {
    expect(escapeHtml("user@example.com")).toBe("user@example.com");
    expect(escapeHtml("hello world")).toBe("hello world");
  });
});
