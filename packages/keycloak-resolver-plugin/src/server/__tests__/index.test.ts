import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type { PrincipalResolverFn } from "@blackbelt-technology/pi-dashboard-shared/identity.js";
import { describe, expect, it, vi } from "vitest";
import { registerPlugin } from "../index.js";

function context(config: Record<string, unknown>) {
  const registered: Array<{
    resolve: PrincipalResolverFn;
    options?: { active?: boolean; clockSkewSeconds?: number };
  }> = [];
  const ctx = {
    getPluginConfig: () => config,
    registerPrincipalResolver: (
      resolve: PrincipalResolverFn,
      options?: { active?: boolean; clockSkewSeconds?: number },
    ) => {
      registered.push({ resolve, options });
      return () => {};
    },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as unknown as ServerPluginContext;
  return { ctx, registered };
}

describe("keycloak resolver plugin entry (§5.1)", () => {
  it("registers an inert null resolver when issuer/audience are absent", async () => {
    const { ctx, registered } = context({});
    await registerPlugin(ctx);
    expect(registered).toHaveLength(1);
    expect(registered[0]?.options).toEqual({ active: false });
    await expect(
      registered[0]?.resolve({ method: "GET", url: "http://x/", isAuthenticated: false, ip: "127.0.0.1" }),
    ).resolves.toBeNull();
  });

  it("registers an inert null resolver for http issuer without explicit opt-in", async () => {
    const { ctx, registered } = context({ issuer: "http://keycloak:8080/realms/app", audience: "dashboard" });
    await registerPlugin(ctx);
    expect(registered[0]?.options).toEqual({ active: false });
  });

  it("does not register when explicitly disabled", async () => {
    const { ctx, registered } = context({ enabled: false, issuer: "https://kc/realm", audience: "dashboard" });
    await registerPlugin(ctx);
    expect(registered).toHaveLength(0);
  });

  it("registers an active resolver when fully configured", async () => {
    const { ctx, registered } = context({ issuer: "https://kc/realm", audience: "dashboard" });
    await registerPlugin(ctx);
    expect(registered).toHaveLength(1);
    expect(registered[0]?.options).toEqual({ clockSkewSeconds: 30 });
    // Opaque bearer ownership check requires no network and falls through.
    await expect(
      registered[0]?.resolve({
        method: "GET",
        url: "https://dash/",
        authorization: "Bearer opaque",
        isAuthenticated: false,
        ip: "127.0.0.1",
      }),
    ).resolves.toBeNull();
  });
});
