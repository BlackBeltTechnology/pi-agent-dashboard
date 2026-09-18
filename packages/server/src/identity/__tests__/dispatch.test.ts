import type { AuthContext, ResolverOutcome } from "@blackbelt-technology/pi-dashboard-shared/identity.js";
import { describe, expect, it, vi } from "vitest";
import { dispatchResolvers } from "../dispatch.js";
import type { ResolverRegistration } from "../resolver-registry.js";

const NOW = 1_700_000_000_000;
const future = NOW + 60_000;
const ctx: AuthContext = { method: "GET", url: "http://x/y", isAuthenticated: false, ip: "1.2.3.4" };

const reg = (pluginId: string, priority: number, resolve: ResolverRegistration["resolve"]): ResolverRegistration => ({
  pluginId,
  priority,
  resolve,
});

const claim = (sub: string): ResolverOutcome => ({ principal: { iss: "i", sub }, expiresAt: future });

describe("dispatchResolvers — three-valued walk (§4.3 / D5)", () => {
  const deps = (resolvers: ResolverRegistration[], over = {}) => ({
    resolvers,
    timeoutMs: 1000,
    skewSeconds: 30,
    now: () => NOW,
    ...over,
  });

  it("returns the first claim and stops the walk", async () => {
    const second = vi.fn(async () => claim("second"));
    const out = await dispatchResolvers(ctx, deps([
      reg("a", 100, async () => claim("first")),
      reg("b", 200, second),
    ]));
    expect(out).toEqual({ kind: "claim", resolution: { principal: { iss: "i", sub: "first" }, expiresAt: future }, pluginId: "a" });
    expect(second).not.toHaveBeenCalled();
  });

  it("falls through nulls to a later claim", async () => {
    const out = await dispatchResolvers(ctx, deps([
      reg("a", 100, async () => null),
      reg("b", 200, async () => claim("z")),
    ]));
    expect(out.kind).toBe("claim");
  });

  it("a reject stops the chain fail-closed", async () => {
    const later = vi.fn(async () => claim("nope"));
    const out = await dispatchResolvers(ctx, deps([
      reg("a", 100, async () => ({ reject: true, reason: "bad sig" })),
      reg("b", 200, later),
    ]));
    expect(out).toEqual({ kind: "reject", pluginId: "a" });
    expect(later).not.toHaveBeenCalled();
  });

  it("returns none when every resolver returns null", async () => {
    const out = await dispatchResolvers(ctx, deps([reg("a", 100, async () => null)]));
    expect(out).toEqual({ kind: "none" });
  });
});

describe("dispatchResolvers — fail-closed isolation (§4.4 / D5)", () => {
  const log = vi.fn();
  const deps = (resolvers: ResolverRegistration[], over = {}) => ({
    resolvers,
    timeoutMs: 50,
    skewSeconds: 30,
    now: () => NOW,
    log,
    ...over,
  });

  it("a throwing resolver is neutralized to null (never a reject, never a throw)", async () => {
    const out = await dispatchResolvers(ctx, deps([
      reg("boom", 100, async () => {
        throw new Error("kaboom");
      }),
      reg("ok", 200, async () => claim("z")),
    ]));
    expect(out.kind).toBe("claim");
    expect(log).toHaveBeenCalled();
  });

  it("a slow resolver is bounded by the timeout and treated as null", async () => {
    const out = await dispatchResolvers(ctx, deps([
      reg("slow", 100, () => new Promise((r) => setTimeout(() => r(claim("late")), 500))),
      reg("fast", 200, async () => claim("quick")),
    ]));
    expect(out).toMatchObject({ kind: "claim", pluginId: "fast" });
  });

  it("a malformed claim is discarded as null and the walk continues", async () => {
    const out = await dispatchResolvers(ctx, deps([
      reg("bad", 100, async () => ({ principal: { iss: "", sub: "s" }, expiresAt: future })),
      reg("good", 200, async () => claim("z")),
    ]));
    expect(out).toMatchObject({ kind: "claim", pluginId: "good" });
  });

  it("a hostile proxy outcome cannot escape as a 500", async () => {
    const hostile = new Proxy({}, {
      getPrototypeOf: () => { throw new Error("hostile trap"); },
      getOwnPropertyDescriptor: () => { throw new Error("hostile descriptor"); },
    });
    const out = await dispatchResolvers(ctx, deps([
      reg("hostile", 100, async () => hostile as never),
      reg("good", 200, async () => claim("z")),
    ]));
    expect(out).toMatchObject({ kind: "claim", pluginId: "good" });
  });
});
