/**
 * Owner slot: process-global, so it crosses module instances (pi loads each
 * extension through jiti with `moduleCache: false`).
 *
 * See change: add-supervised-tool-approval (test-plan #E27).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const SLOT = Symbol.for("pi-dashboard.toolGateOwner");

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[SLOT];
});

describe("tool-gate owner slot", () => {
  it("E27: crosses two fresh module instances; clear is visible; slot is a Map on globalThis", async () => {
    vi.resetModules();
    const a = await import("../owner.js");
    vi.resetModules();
    const b = await import("../owner.js");
    expect(a).not.toBe(b); // genuinely two module instances

    a.markToolGateOwner("s1", "chat-gateway");
    expect(b.toolGateOwner("s1")).toBe("chat-gateway");
    expect(b.toolGateOwner("s2")).toBeUndefined();

    const slot = (globalThis as Record<symbol, unknown>)[SLOT];
    expect(slot).toBeInstanceOf(Map);
    expect((slot as Map<string, string>).get("s1")).toBe("chat-gateway");

    a.clearToolGateOwner("s1");
    expect(b.toolGateOwner("s1")).toBeUndefined();
  });

  it("an unmarked session has no owner", async () => {
    const { toolGateOwner } = await import("../owner.js");
    expect(toolGateOwner("never-marked")).toBeUndefined();
  });
});
