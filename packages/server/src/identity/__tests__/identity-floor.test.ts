import { describe, expect, it } from "vitest";
import { identityFloorAllows } from "../identity-floor.js";

const base = { enforced: true, hasPrincipal: false, hasLocalToken: false, method: "GET" };

describe("identityFloorAllows — D24 signed-out floor", () => {
  it("is a no-op while identity is not enforced (inert plane unchanged)", () => {
    expect(identityFloorAllows({ ...base, enforced: false, path: "/api/config" })).toBe(true);
  });

  it("refuses every browser road without a principal while enforced — localhost included", () => {
    for (const path of ["/api/config", "/api/providers", "/api/sessions", "/editor/x", "/live/y", "/api/plugins/foo/data"]) {
      expect(identityFloorAllows({ ...base, path })).toBe(false);
    }
  });

  it("admits a signed-in principal", () => {
    expect(identityFloorAllows({ ...base, hasPrincipal: true, path: "/api/config" })).toBe(true);
  });

  it("admits a same-user process caller presenting the host-only local token (CLI, bridge)", () => {
    expect(identityFloorAllows({ ...base, hasLocalToken: true, path: "/api/restart", method: "POST" })).toBe(true);
  });

  it("keeps the pre-auth set reachable for GET/HEAD only", () => {
    expect(identityFloorAllows({ ...base, path: "/api/health" })).toBe(true);
    expect(identityFloorAllows({ ...base, path: "/api/identity/login-config" })).toBe(true);
    expect(identityFloorAllows({ ...base, path: "/api/health", method: "HEAD" })).toBe(true);
    expect(identityFloorAllows({ ...base, path: "/api/health", method: "POST" })).toBe(false);
  });

  it("does not govern non-browser namespaces (SPA shell, plugin login pages, WS upgrade path, model proxy)", () => {
    for (const path of ["/", "/settings", "/assets/index.js", "/identity-login/start", "/auth/status", "/ws", "/v1/chat/completions"]) {
      expect(identityFloorAllows({ ...base, path })).toBe(true);
    }
  });

  it("normalises the path before deciding (no dot-segment / encoding bypass of the pre-auth set)", () => {
    expect(identityFloorAllows({ ...base, path: "/api/health/../config" })).toBe(false);
    expect(identityFloorAllows({ ...base, path: "/api/%2e%2e/api/config" })).toBe(false);
    expect(identityFloorAllows({ ...base, path: "/api/health?x=1" })).toBe(true);
  });

  it.each([
    "//api/config",
    "/api//config",
    "/%61pi/config",
    "/api/health/..%2fconfig",
    "/api/health/%2e%2e/config",
    "/api/health;/../config",
    "/api/identity/login-config/../../config",
    "/api/health%00",
    "/api/health/",
    "/api/Health",
    "/api/health.json",
    "/editor/../api/config",
    "/live/%2e%2e/api/sessions",
  ])("no path trick reaches a protected road without a principal: %s", (path) => {
    expect(identityFloorAllows({ ...base, path })).toBe(false);
  });

  it.each(["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])("every method on a protected road is refused (%s /api/config)", (method) => {
    expect(identityFloorAllows({ ...base, method, path: "/api/config" })).toBe(false);
  });

  it.each(["POST", "PUT", "DELETE"])("the pre-auth set is read-only: %s /api/identity/login-config is refused", (method) => {
    expect(identityFloorAllows({ ...base, method, path: "/api/identity/login-config" })).toBe(false);
  });

  it("an unparseable target fails CLOSED", () => {
    expect(identityFloorAllows({ ...base, path: "/api/%E0%A4%A" })).toBe(false);
    expect(identityFloorAllows({ ...base, path: "/api/%zz" })).toBe(false);
  });
});
