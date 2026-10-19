/**
 * Target tracker: the WS target origin the renderer is switched to, and the
 * `/api/health` instanceId main fetches from it (fake health).
 * See change: add-operator-browser-relay (D7).
 */
import { describe, expect, it, vi } from "vitest";
import { createTarget } from "../target.js";

const health = (body: unknown, ok = true) => vi.fn(async (_url: string) => ({ ok, json: async () => body }));

describe("target", () => {
  it("normalises the origin and fetches instanceId from <origin>/api/health", async () => {
    const f = health({ instanceId: "inst-1", version: "1" });
    const t = createTarget({ fetchImpl: f as never });
    t.set("http://192.168.16.204:8000/some/path?x=1");
    expect(t.origin()).toBe("http://192.168.16.204:8000");
    expect(await t.instanceId()).toBe("inst-1");
    expect(f.mock.calls[0]![0]).toBe("http://192.168.16.204:8000/api/health");
  });

  it("rejects non-http(s) origins and clears on bad input", () => {
    const t = createTarget({ fetchImpl: health({}) as never });
    t.set("http://localhost:8000");
    expect(() => t.set("file:///etc/passwd")).toThrow();
    expect(t.origin()).toBeUndefined();
    expect(() => t.set(42 as never)).toThrow();
  });

  it("throws without a target, on HTTP failure, on a missing/oversize instanceId, and on fetch rejection", async () => {
    const none = createTarget({ fetchImpl: health({ instanceId: "x" }) as never });
    await expect(none.instanceId()).rejects.toThrow();
    const set = (f: unknown) => {
      const t = createTarget({ fetchImpl: f as never });
      t.set("http://localhost:8000");
      return t;
    };
    await expect(set(health({ instanceId: "x" }, false)).instanceId()).rejects.toThrow();
    await expect(set(health({})).instanceId()).rejects.toThrow();
    await expect(set(health({ instanceId: "x".repeat(500) })).instanceId()).rejects.toThrow();
    await expect(set(vi.fn(async () => { throw new Error("boom"); })).instanceId()).rejects.toThrow();
  });

  it("clear() forgets the target", () => {
    const t = createTarget({ fetchImpl: health({}) as never });
    t.set("http://localhost:8000");
    t.clear();
    expect(t.origin()).toBeUndefined();
  });
});
