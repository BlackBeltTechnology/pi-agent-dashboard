/**
 * Unit tests for the unified token-keyed pending store
 * (`createPendingPluginRefRegistry`).
 *
 * Covers test-plan #E16 (relocate-goal-product-to-plugin): the
 * non-destructive `has(token)` probe — `has` never consumes, `resolve` does,
 * and TTL expiry drops the entry for both.
 *
 * See change: detach-automation-goal-from-core (registry),
 * relocate-goal-product-to-plugin (has()).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPendingPluginRefRegistry,
  PENDING_PLUGIN_REF_TTL_MS,
} from "../pending/pending-plugin-ref-registry.js";

describe("pending-plugin-ref-registry has()", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("E16: has → resolve → has — has is non-destructive, resolve consumes", () => {
    const registry = createPendingPluginRefRegistry();
    const lifecycle = { recover: false };
    expect(registry.file("tok-A", { goalId: "g1" }, "goal", lifecycle)).toBe(true);

    expect(registry.has("tok-A")).toBe(true);
    const resolved = registry.resolve("tok-A");
    expect(resolved).not.toBeNull();
    expect(resolved!.ref).toEqual({ goalId: "g1" });
    expect(resolved!.ownerId).toBe("goal");
    expect(resolved!.lifecycle).toEqual(lifecycle);
    // has() did not consume; resolve() did.
    expect(registry.has("tok-A")).toBe(false);
    expect(registry.resolve("tok-A")).toBeNull();
  });

  it("E16: has() reports false once PENDING_PLUGIN_REF_TTL_MS has elapsed", () => {
    const registry = createPendingPluginRefRegistry();
    registry.file("tok-A", { goalId: "g1" }, "goal");
    expect(registry.has("tok-A")).toBe(true);

    vi.advanceTimersByTime(PENDING_PLUGIN_REF_TTL_MS + 1);
    expect(registry.has("tok-A")).toBe(false);
    expect(registry.resolve("tok-A")).toBeNull();
  });

  it("E16: has() on an unknown / empty token is false", () => {
    const registry = createPendingPluginRefRegistry();
    expect(registry.has("tok-never-filed")).toBe(false);
    expect(registry.has("")).toBe(false);
  });
});
