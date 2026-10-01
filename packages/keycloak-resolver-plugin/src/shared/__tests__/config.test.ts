import { describe, expect, it } from "vitest";
import {
  activeConfig,
  isActive,
  parseKeycloakResolverConfig,
} from "../config.js";

describe("parseKeycloakResolverConfig", () => {
  it("defaults to enabled with standard timeouts", () => {
    const c = parseKeycloakResolverConfig(undefined);
    expect(c.enabled).toBe(true);
    expect(c.clockSkewSeconds).toBe(30);
    expect(c.networkTimeoutMs).toBe(2000);
    expect(c.allowInsecureHttp).toBe(false);
    expect(c.issuer).toBeUndefined();
    expect(c.audience).toBeUndefined();
  });

  it("respects enabled:false and seeds strings/numbers", () => {
    const c = parseKeycloakResolverConfig({
      enabled: false,
      issuer: "https://kc/realms/app",
      audience: "dashboard",
      authorizedParty: "spa",
      jwksUri: "https://kc/certs",
      clockSkewSeconds: 5,
      networkTimeoutMs: 1000,
      allowInsecureHttp: true,
    });
    expect(c.enabled).toBe(false);
    expect(c.issuer).toBe("https://kc/realms/app");
    expect(c.audience).toBe("dashboard");
    expect(c.authorizedParty).toBe("spa");
    expect(c.clockSkewSeconds).toBe(5);
    expect(c.allowInsecureHttp).toBe(true);
  });
});

describe("activation predicate", () => {
  const full = {
    enabled: true,
    issuer: "https://kc/realms/app",
    audience: "dashboard",
  };

  it("is inert when disabled or missing issuer/audience", () => {
    expect(isActive(parseKeycloakResolverConfig({ ...full, enabled: false }))).toBe(false);
    expect(isActive(parseKeycloakResolverConfig({ audience: "dashboard" }))).toBe(false);
    expect(isActive(parseKeycloakResolverConfig({ issuer: "https://kc/realms/app" }))).toBe(false);
    expect(isActive(parseKeycloakResolverConfig({}))).toBe(false);
  });

  it("is active when enabled + issuer + audience over https", () => {
    const c = parseKeycloakResolverConfig(full);
    expect(isActive(c)).toBe(true);
    expect(activeConfig(c)?.issuer).toBe("https://kc/realms/app");
  });

  it("stays inert for an http: issuer unless allowInsecureHttp", () => {
    const http = { enabled: true, issuer: "http://keycloak:8080/realms/app", audience: "dashboard" };
    expect(isActive(parseKeycloakResolverConfig(http))).toBe(false);
    expect(isActive(parseKeycloakResolverConfig({ ...http, allowInsecureHttp: true }))).toBe(true);
  });

  it("stays inert for an http: jwksUri unless allowInsecureHttp", () => {
    const c = { ...full, jwksUri: "http://keycloak:8080/certs" };
    expect(isActive(parseKeycloakResolverConfig(c))).toBe(false);
    expect(isActive(parseKeycloakResolverConfig({ ...c, allowInsecureHttp: true }))).toBe(true);
  });

  it("rejects malformed/non-http provider URLs and clamps numeric bounds", () => {
    expect(isActive(parseKeycloakResolverConfig({ ...full, issuer: "file:///tmp/issuer" }))).toBe(false);
    const c = parseKeycloakResolverConfig({ ...full, clockSkewSeconds: 9999, networkTimeoutMs: -1 });
    expect(c.clockSkewSeconds).toBe(300);
    expect(c.networkTimeoutMs).toBe(100);
  });
});
