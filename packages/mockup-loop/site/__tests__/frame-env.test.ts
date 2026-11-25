/**
 * L1 — opaque-frame messaging, storage guards and base-aware dev paths of the mock site (D11 (3), (5), (9), (10)).
 * See change: serve-live-previews-on-capability-origin (test-plan #E188, #E191, F53-F56 unit halves).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

async function load(base?: string) {
  vi.resetModules();
  if (base) vi.stubEnv("BASE_URL", base);
  return { env: await import("../frame-env.ts"), fx: await import("../fixtures.ts") };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const loc = (origin: string, href = "https://dash.example.com/preview/AAAAAAAAAAAAAAAAAAAAAA/") => vi.stubGlobal("location", { origin, href });

describe("opaque vs real origin (F53, F55)", () => {
  it("`postTarget` is `*` only while opaque; `originOk` pairs with it", async () => {
    const { env } = await load();
    loc("null");
    expect(env.isOpaque()).toBe(true);
    expect(env.postTarget()).toBe("*");
    expect(env.originOk({ origin: "null" } as MessageEvent)).toBe(true);
    expect(env.originOk({ origin: "https://evil.example" } as MessageEvent)).toBe(false);
    loc("http://k7q4.localhost:8000");
    expect(env.isOpaque()).toBe(false);
    expect(env.postTarget()).toBe("http://k7q4.localhost:8000"); // never "*" in a real-origin frame
    expect(env.originOk({ origin: "http://k7q4.localhost:8000" } as MessageEvent)).toBe(true);
    expect(env.originOk({ origin: "null" } as MessageEvent)).toBe(false);
  });
  it("storage never throws: a SecurityError reads as null and a write is dropped", async () => {
    const { env } = await load();
    const boom = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("SecurityError"); } };
    vi.stubGlobal("localStorage", boom);
    vi.stubGlobal("sessionStorage", boom);
    expect(env.readStore("local", "mk-theme")).toBeNull();
    expect(() => env.writeStore("session", "mk-h:x", "5")).not.toThrow();
    const getter = { get localStorage(): never { throw new Error("SecurityError"); } };
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get: () => getter.localStorage });
    expect(env.readStore("local", "k")).toBeNull();
    Reflect.deleteProperty(globalThis, "localStorage");
  });
  it("storage works when available", async () => {
    const { env } = await load();
    const m = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) });
    env.writeStore("local", "mk-theme", "dark");
    expect(env.readStore("local", "mk-theme")).toBe("dark");
  });
  it("only a CHILD frame's window is accepted as a report source (F54)", async () => {
    const { env } = await load();
    const childWin = {};
    vi.stubGlobal("document", { querySelectorAll: () => [{ contentWindow: childWin }] });
    expect(env.fromChildFrame(childWin as MessageEventSource)).toBe(true);
    expect(env.fromChildFrame({} as MessageEventSource)).toBe(false); // a sibling / foreign window
    expect(env.fromChildFrame(null)).toBe(false);
  });
});

describe("base-aware dev paths (E188, E191)", () => {
  const u = (p: string) => new URL(p, "http://x.local");
  it("E188: under `/some/prefix/` the dev paths pass through; app routes are fixture-answered; the base is not in the missing path", async () => {
    const { fx, env } = await load("/some/prefix/");
    const f = { http: { "GET /api/roles": () => 1 } };
    for (const p of ["/some/prefix/@fs/Users/dev/app/src/main.tsx", "/some/prefix/@vite/client", "/some/prefix/@react-refresh", "/some/prefix/@id/x", "/some/prefix/node_modules/x.js", "/some/prefix/__mock/decisions"]) {
      expect(fx.resolveRequest(f, "GET", u(p), "http://x.local").kind, p).toBe("passthrough");
    }
    expect(fx.resolveRequest(f, "GET", u("/api/roles"), "http://x.local").kind).toBe("http");
    expect(fx.resolveRequest(f, "GET", u("/api/none"), "http://x.local").kind).toBe("missing");
    expect(env.stripBase("/some/prefix/api/none")).toBe("/api/none");
    expect(env.stripBase("/api/none")).toBe("/api/none"); // only paths under the base are stripped
    expect(env.BASE).toBe("/some/prefix/");
  });
  it("E191: base `/api/`: `/api/@vite/client` is a dev path, `/api/roles` is NOT (fixture on the raw path)", async () => {
    const { fx } = await load("/api/");
    expect(fx.resolveRequest({ http: { "GET /api/roles": () => 1 } }, "GET", u("/api/@vite/client"), "http://x.local").kind).toBe("passthrough");
    expect(fx.resolveRequest({ http: { "GET /api/roles": () => 1 } }, "GET", u("/api/roles"), "http://x.local").kind).toBe("http");
    expect(fx.resolveRequest({}, "GET", u("/api/roles"), "http://x.local").kind).toBe("missing");
  });
  it("no base: unchanged", async () => {
    const { fx, env } = await load();
    expect(env.BASE).toBe("/");
    expect(fx.resolveRequest({}, "GET", u("/@vite/client"), "http://x.local").kind).toBe("passthrough");
    expect(env.stripBase("/x")).toBe("/x");
  });
});
