/**
 * Framing verdict follows the browser's precedence (E35, decision table headers × status).
 * Pure function — no network. See change: rich-chat-links (design D12.5).
 */
import { describe, expect, it } from "vitest";
import { computeFrameVerdict } from "../lib/frame-policy-verdict.js";

const TARGET = "https://example.com";
const DASH = "https://dash.example.org";

const verdict = (status: number, headers: Record<string, string | string[]>, dash = DASH, target = TARGET) =>
  computeFrameVerdict({ status, headers, targetOrigin: target, dashboardOrigin: dash });

describe("computeFrameVerdict (E35)", () => {
  it.each([
    ["XFO deny", 200, { "x-frame-options": "deny" }, "refused"],
    ["XFO SAMEORIGIN + CSP frame-ancestors https: (CSP decides)", 200, { "x-frame-options": "SAMEORIGIN", "content-security-policy": "frame-ancestors https:" }, "allowed"],
    ["frame-ancestors 'none'", 200, { "content-security-policy": "frame-ancestors 'none'" }, "refused"],
    ["two CSP headers (https: and 'self') intersect", 200, { "content-security-policy": ["frame-ancestors https:", "frame-ancestors 'self'"] }, "refused"],
    ["two CSP policies joined by a comma intersect", 200, { "content-security-policy": "frame-ancestors https:, frame-ancestors 'self'" }, "refused"],
    ["XFO DENY, SAMEORIGIN (conflict)", 200, { "x-frame-options": "DENY, SAMEORIGIN" }, "refused"],
    ["XFO ALLOW-FROM (conservative)", 200, { "x-frame-options": "ALLOW-FROM https://x" }, "refused"],
    ["XFO garbage (single value ignored)", 200, { "x-frame-options": "garbage" }, "allowed"],
    ["no headers", 200, {}, "allowed"],
    ["403 no headers", 403, {}, "undetermined"],
    ["304", 304, {}, "undetermined"],
    ["405", 405, {}, "undetermined"],
    ["501", 501, {}, "undetermined"],
    ["301 without Location is not a 2xx", 301, {}, "undetermined"],
    ["204 is a final 2xx", 204, {}, "allowed"],
    ["403 with XFO deny is still undetermined (only a 2xx counts)", 403, { "x-frame-options": "deny" }, "undetermined"],
  ] as const)("%s", (_name, status, headers, expected) => {
    expect(verdict(status, headers as Record<string, string | string[]>)).toBe(expected);
  });
});

describe("computeFrameVerdict — frame-ancestors source matching", () => {
  const fa = (value: string, dash = DASH, target = TARGET) =>
    verdict(200, { "content-security-policy": `frame-ancestors ${value}` }, dash, target);

  it("'self' is relative to the TARGET, not the dashboard", () => {
    expect(fa("'self'", TARGET)).toBe("allowed");
    expect(fa("'self'", DASH)).toBe("refused");
  });
  it("an empty source list matches nothing", () => {
    expect(verdict(200, { "content-security-policy": "frame-ancestors ;" })).toBe("refused");
  });
  it("'none' is only meaningful alone: beside another source it is ignored (CSP3)", () => {
    expect(fa("'none' https://dash.example.org")).toBe("allowed");
    expect(fa("'none' https://other.example.org")).toBe("refused");
  });
  it("host sources: exact, wildcard sub-domain, scheme, port", () => {
    expect(fa("https://dash.example.org")).toBe("allowed");
    expect(fa("dash.example.org")).toBe("allowed");
    expect(fa("*.example.org")).toBe("allowed");
    expect(fa("*.example.org", "https://example.org")).toBe("refused");
    expect(fa("https://other.example.org")).toBe("refused");
    expect(fa("http://dash.example.org")).toBe("allowed"); // http: upgrades to https
    expect(fa("https://dash.example.org", "http://dash.example.org")).toBe("refused");
    expect(fa("https://dash.example.org:8443")).toBe("refused");
    expect(fa("https://dash.example.org:8443", "https://dash.example.org:8443")).toBe("allowed");
    expect(fa("https://dash.example.org:*", "https://dash.example.org:8443")).toBe("allowed");
  });
  it("scheme sources: http: also covers https, https: does not cover http", () => {
    expect(fa("http:", "http://127.0.0.1:8000")).toBe("allowed");
    expect(fa("http:")).toBe("allowed");
    expect(fa("https:", "http://127.0.0.1:8000")).toBe("refused");
  });
  it("'*' matches network schemes", () => {
    expect(fa("*", "http://127.0.0.1:8000")).toBe("allowed");
  });
  it("a repeated frame-ancestors directive in one policy: the first wins", () => {
    expect(verdict(200, { "content-security-policy": "frame-ancestors 'none'; frame-ancestors *" })).toBe("refused");
  });
  it("directive names are case-insensitive; report-only headers are ignored", () => {
    expect(verdict(200, { "content-security-policy": "Frame-Ancestors 'none'" })).toBe("refused");
    expect(verdict(200, { "content-security-policy-report-only": "frame-ancestors 'none'" })).toBe("allowed");
  });
  it("a policy without frame-ancestors falls back to X-Frame-Options", () => {
    expect(verdict(200, { "content-security-policy": "default-src 'self'", "x-frame-options": "DENY" })).toBe("refused");
  });
});
