import type { Principal } from "@blackbelt-technology/pi-dashboard-shared/identity.js";
import { describe, expect, it, vi } from "vitest";
import { parseFixturePolicyConfig } from "../config.js";
import { registerPlugin } from "../index.js";
import { createFixturePolicy } from "../policy.js";

const ISS = "https://kc.example/realms/app";
const anna: Principal = { iss: ISS, sub: "anna-sub" };
const bela: Principal = { iss: ISS, sub: "bela-sub" };
const res = { kind: "domain", pluginId: "p", eventType: "e" };

describe("parseFixturePolicyConfig (fixture, §11.2)", () => {
  it("defaults enabled true and empty allow; drops malformed entries", () => {
    expect(parseFixturePolicyConfig(null)).toEqual({ enabled: true, allow: [] });
    expect(parseFixturePolicyConfig({ allow: [{ actions: ["x"] }, 5, { sub: "s" }] })).toEqual({
      enabled: true,
      allow: [{ sub: "s" }],
    });
    expect(parseFixturePolicyConfig({ enabled: false }).enabled).toBe(false);
  });
});

describe("createFixturePolicy decision matrix (§11.2)", () => {
  it("grants only the listed principal+action; default-denies everyone else", async () => {
    // Anna may receive domain events; Béla is not in the allow-list.
    const policy = createFixturePolicy(
      parseFixturePolicyConfig({ allow: [{ iss: ISS, sub: "anna-sub", actions: ["domain.event"] }] }),
    );
    expect(await policy({ principal: anna, action: "domain.event", resource: res })).toBe(true);
    // Non-owner reaches none of the fan-out — the isolation guarantee.
    expect(await policy({ principal: bela, action: "domain.event", resource: res })).toBe(false);
    // Same principal, ungranted action ⇒ deny.
    expect(await policy({ principal: anna, action: "system.write", resource: { kind: "system" } })).toBe(false);
  });

  it("`*` and omitted actions grant all; iss pinning is enforced when set", async () => {
    const star = createFixturePolicy(parseFixturePolicyConfig({ allow: [{ sub: "anna-sub", actions: ["*"] }] }));
    expect(await star({ principal: anna, action: "anything.at.all", resource: res })).toBe(true);

    const omitted = createFixturePolicy(parseFixturePolicyConfig({ allow: [{ sub: "anna-sub" }] }));
    expect(await omitted({ principal: anna, action: "workspace.read", resource: { kind: "workspace" } })).toBe(true);

    // Entry pins a different issuer ⇒ no match even for the right sub.
    const pinned = createFixturePolicy(
      parseFixturePolicyConfig({ allow: [{ iss: "https://other/realms/x", sub: "anna-sub", actions: ["*"] }] }),
    );
    expect(await pinned({ principal: anna, action: "domain.event", resource: res })).toBe(false);
  });

  it("empty allow-list denies everything (default-deny)", async () => {
    const policy = createFixturePolicy(parseFixturePolicyConfig({ allow: [] }));
    expect(await policy({ principal: anna, action: "domain.event", resource: res })).toBe(false);
  });
});

describe("registerPlugin wiring (§11.2)", () => {
  const baseCtx = (over: Record<string, unknown>) => ({
    getPluginConfig: () => ({ allow: [{ sub: "anna-sub", actions: ["*"] }] }),
    logger: { info: vi.fn(), warn: vi.fn() },
    ...over,
  });

  it("registers the policy when enabled and the capability exists", async () => {
    const registerHostAccessPolicy = vi.fn(() => () => {});
    await registerPlugin(baseCtx({ registerHostAccessPolicy }) as never);
    expect(registerHostAccessPolicy).toHaveBeenCalledTimes(1);
  });

  it("registers nothing when disabled (inert)", async () => {
    const registerHostAccessPolicy = vi.fn(() => () => {});
    await registerPlugin(
      baseCtx({ registerHostAccessPolicy, getPluginConfig: () => ({ enabled: false }) }) as never,
    );
    expect(registerHostAccessPolicy).not.toHaveBeenCalled();
  });

  it("registers nothing when the host lacks the capability (inert)", async () => {
    // No registerHostAccessPolicy on ctx — must not throw.
    await expect(registerPlugin(baseCtx({}) as never)).resolves.toBeUndefined();
  });
});
