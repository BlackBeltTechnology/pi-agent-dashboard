/**
 * Plugin policy registry: ownership by manifest pattern, claimed-tool lookup,
 * identity sanitization, throw-safe delivery hooks.
 * See change: move-subagents-to-plugin (D3, D4, D10).
 */
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import { createPluginPolicyRegistry, sanitizeIdentityFields } from "../plugin-policy-registry.js";

const ev = (eventType: string, data: Record<string, unknown> = {}): DashboardEvent => ({ eventType, timestamp: 1, data });

describe("plugin policy registry", () => {
  it("resolves a store policy for owned types and claimed tool update/end only", () => {
    const r = createPluginPolicyRegistry();
    r.setOwnership("p", { eventTypes: ["thing_*"], tools: ["Claimed"] });
    const policy = {};
    r.registerStorePolicy("p", policy);
    expect(r.resolveStorePolicy(ev("thing_x"))).toBe(policy);
    expect(r.resolveStorePolicy(ev("tool_execution_end", { toolName: "Claimed" }))).toBe(policy);
    expect(r.resolveStorePolicy(ev("tool_execution_update", { toolName: "Claimed" }))).toBe(policy);
    expect(r.resolveStorePolicy(ev("tool_execution_start", { toolName: "Claimed" }))).toBeUndefined();
    expect(r.resolveStorePolicy(ev("tool_execution_end", { toolName: "bash" }))).toBeUndefined();
    expect(r.resolveStorePolicy(ev("other"))).toBeUndefined();
    expect(r.resolveToolStorePolicy("Claimed")).toBe(policy);
  });

  it("unregister removes only its own policy; ownership is per plugin", () => {
    const r = createPluginPolicyRegistry();
    r.setOwnership("p", { eventTypes: ["a_*"], tools: [] });
    const off = r.registerStorePolicy("p", {});
    off();
    expect(r.resolveStorePolicy(ev("a_1"))).toBeUndefined();
    expect(r.ownsEventType("p", "a_1")).toBe(true);
    expect(r.ownsEventType("q", "a_1")).toBe(false);
  });

  it("a delivery policy that throws gives no key and an unchanged frame", () => {
    const r = createPluginPolicyRegistry();
    r.setOwnership("p", { eventTypes: ["a_*"], tools: [] });
    r.registerDeliveryPolicy("p", {
      deferKey() {
        throw new Error("x");
      },
      project() {
        throw new Error("x");
      },
    });
    const e = ev("a_1");
    expect(r.deferKeyOf(e, "S")).toBeUndefined();
    expect(r.projectDeferred(e)).toBe(e);
  });

  it("sanitizeIdentityFields keeps scalar leaves only, strings cut to 256 B", () => {
    const out = sanitizeIdentityFields({
      id: "a1",
      long: "é".repeat(400),
      n: 3,
      bad: Number.NaN,
      arr: [1],
      nul: null,
      details: { status: "ok", nested: { x: [] }, empty: {} },
    });
    expect(out).toMatchObject({ id: "a1", n: 3, details: { status: "ok" } });
    expect(Buffer.byteLength(out!.long as string)).toBeLessThanOrEqual(256);
    expect(out).not.toHaveProperty("bad");
    expect(out).not.toHaveProperty("arr");
    expect(out).not.toHaveProperty("nul");
    expect((out!.details as Record<string, unknown>)).not.toHaveProperty("empty");
    expect(sanitizeIdentityFields({ arr: [1] })).toBeUndefined();
  });
});
