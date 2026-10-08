import type { AuthContext, ResolverOutcome } from "@blackbelt-technology/pi-dashboard-shared/identity.js";
import { describe, expect, it } from "vitest";
import {
  BUNDLED_RESOLVER_PLUGIN_ID,
  ResolverDuplicateError,
  ResolverRegistry,
  ResolverTrustError,
} from "../resolver-registry.js";

const noop = async (_ctx: AuthContext): Promise<ResolverOutcome> => null;

describe("ResolverRegistry — trust grant (§3.2 / D4)", () => {
  it("always trusts the bundled keycloak-resolver, no config needed", () => {
    const reg = new ResolverRegistry([]);
    expect(reg.isTrusted(BUNDLED_RESOLVER_PLUGIN_ID)).toBe(true);
    expect(() => reg.register({ pluginId: BUNDLED_RESOLVER_PLUGIN_ID, priority: 100, resolve: noop })).not.toThrow();
    expect(reg.size).toBe(1);
  });

  it("rejects an untrusted plugin regardless of its self-declared priority", () => {
    const reg = new ResolverRegistry([]);
    expect(reg.isTrusted("rogue")).toBe(false);
    // A low priority number does NOT buy trust.
    expect(() => reg.register({ pluginId: "rogue", priority: 1, resolve: noop })).toThrow(ResolverTrustError);
    expect(reg.size).toBe(0);
  });

  it("trusts a plugin named in the operator trust list", () => {
    const reg = new ResolverRegistry(["corp-oidc"]);
    expect(() => reg.register({ pluginId: "corp-oidc", priority: 50, resolve: noop })).not.toThrow();
    expect(reg.hasResolver()).toBe(true);
    expect(reg.hasActiveResolver()).toBe(true);
  });

  it("distinguishes registered-but-unconfigured from active without a mode flag", () => {
    const reg = new ResolverRegistry([]);
    reg.register({
      pluginId: BUNDLED_RESOLVER_PLUGIN_ID,
      priority: 100,
      active: false,
      resolve: noop,
    });
    expect(reg.hasResolver()).toBe(true);
    expect(reg.hasActiveResolver()).toBe(false);
    expect(reg.ordered()).toEqual([]);
  });

  it("fails a duplicate registration from the same plugin", () => {
    const reg = new ResolverRegistry([]);
    reg.register({ pluginId: BUNDLED_RESOLVER_PLUGIN_ID, priority: 100, resolve: noop });
    expect(() => reg.register({ pluginId: BUNDLED_RESOLVER_PLUGIN_ID, priority: 100, resolve: noop })).toThrow(
      ResolverDuplicateError,
    );
  });
});

describe("ResolverRegistry — deterministic order (§3.1 / D4)", () => {
  it("orders by (priority ASC, pluginId ASC) — independent of registration order", () => {
    const reg = new ResolverRegistry(["b-plugin", "a-plugin", "z-plugin"]);
    // Register out of order; two share a priority to exercise the pluginId tie-break.
    reg.register({ pluginId: "z-plugin", priority: 200, resolve: noop });
    reg.register({ pluginId: "b-plugin", priority: 100, resolve: noop });
    reg.register({ pluginId: BUNDLED_RESOLVER_PLUGIN_ID, priority: 100, resolve: noop });
    reg.register({ pluginId: "a-plugin", priority: 100, resolve: noop });
    expect(reg.ordered().map((r) => r.pluginId)).toEqual([
      "a-plugin", // priority 100, first alphabetically
      "b-plugin",
      BUNDLED_RESOLVER_PLUGIN_ID, // "keycloak-resolver" > "b-plugin"
      "z-plugin", // priority 200 last
    ]);
  });

  it("override-by-disable: a disabled default simply never registers (§3.4)", () => {
    // The host does not register the bundled resolver when it is disabled;
    // only the trusted replacement is present, so only it can resolve.
    const reg = new ResolverRegistry(["replacement"]);
    reg.register({ pluginId: "replacement", priority: 100, resolve: noop });
    expect(reg.ordered().map((r) => r.pluginId)).toEqual(["replacement"]);
    expect(reg.isTrusted(BUNDLED_RESOLVER_PLUGIN_ID)).toBe(true); // still trusted…
    expect(reg.size).toBe(1); // …but never registered ⇒ never claims a token
  });

  it("unregister handle removes only its own registration", () => {
    const reg = new ResolverRegistry(["x"]);
    const off = reg.register({ pluginId: "x", priority: 10, resolve: noop });
    expect(reg.size).toBe(1);
    off();
    expect(reg.size).toBe(0);
    off(); // idempotent
    expect(reg.size).toBe(0);
  });
});
