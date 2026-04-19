/**
 * Tests for ToolRegistry (packages/shared/src/tool-registry/registry.ts).
 *
 * Covered scenarios (from `specs/tool-registry/spec.md`):
 *   - Resolve a registered binary
 *   - Resolve an unregistered name throws UnknownToolError
 *   - Cached Resolution is referentially equal on second resolve()
 *   - rescan(name) invalidates one; rescan() invalidates all
 *   - First strategy wins; subsequent strategies not executed
 *   - Failing strategies recorded in tried[] and iteration continues
 *   - All-fail produces ok:false with full tried[] trail
 *   - resolveModule: caches loaded module; throws ModuleResolutionError on fail
 *   - setOverride / clearOverride invalidate cached Resolution
 */
import { describe, it, expect } from "vitest";
import {
  ToolRegistry,
  UnknownToolError,
  ModuleResolutionError,
  type Strategy,
  type ToolDefinition,
} from "../tool-registry/index.js";
import { OverridesStore } from "../tool-registry/overrides.js";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// ── Test helpers ────────────────────────────────────────────────────────────

/** Make a strategy that always returns the given path. */
function fixedOk(name: string, p: string): Strategy {
  return { name, run: () => ({ ok: true, path: p }) };
}

/** Make a strategy that records its invocation for "not executed" assertions. */
function spyOk(name: string, p: string, tag: { called: boolean }): Strategy {
  return {
    name,
    run: () => {
      tag.called = true;
      return { ok: true, path: p };
    },
  };
}

/** Make a strategy that always fails with the given reason. */
function fail(name: string, reason: string): Strategy {
  return { name, run: () => ({ ok: false, reason }) };
}

/** In-memory OverridesStore backed by a tmp file (for set/clear flow). */
function tmpOverridesStore(): OverridesStore {
  const fp = path.join(
    os.tmpdir(),
    `tool-overrides-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
  return new OverridesStore({ filePath: fp, warn: () => {} });
}

function binaryDef(name: string, strategies: Strategy[]): ToolDefinition {
  return { name, kind: "binary", strategies };
}

function moduleDef(name: string, strategies: Strategy[]): ToolDefinition {
  return { name, kind: "module", strategies };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("ToolRegistry.resolve", () => {
  it("returns a Resolution object for a registered binary", () => {
    const r = new ToolRegistry({ overrides: tmpOverridesStore() });
    r.register(binaryDef("pi", [fixedOk("where", "/usr/local/bin/pi")]));

    const res = r.resolve("pi");
    expect(res.name).toBe("pi");
    expect(res.ok).toBe(true);
    expect(res.path).toBe("/usr/local/bin/pi");
    expect(res.tried).toEqual([{ strategy: "where", result: "ok" }]);
    expect(typeof res.resolvedAt).toBe("number");
  });

  it("throws UnknownToolError for an unregistered name", () => {
    const r = new ToolRegistry({ overrides: tmpOverridesStore() });
    expect(() => r.resolve("nope")).toThrowError(UnknownToolError);
    try { r.resolve("nope"); } catch (e) {
      expect((e as UnknownToolError).tool).toBe("nope");
    }
  });

  it("returns the same cached Resolution on a second call (referentially equal)", () => {
    const r = new ToolRegistry({ overrides: tmpOverridesStore() });
    r.register(binaryDef("pi", [fixedOk("where", "/usr/bin/pi")]));

    const a = r.resolve("pi");
    const b = r.resolve("pi");
    expect(a).toBe(b);
  });
});

describe("ToolRegistry strategy chain", () => {
  it("first-successful-strategy wins and short-circuits the chain", () => {
    const second = { called: false };
    const r = new ToolRegistry({ overrides: tmpOverridesStore() });
    r.register(
      binaryDef("pi", [
        fixedOk("managed", "/managed/pi"),
        spyOk("where", "/usr/bin/pi", second),
      ]),
    );

    const res = r.resolve("pi");
    expect(res.ok).toBe(true);
    expect(res.path).toBe("/managed/pi");
    expect(res.source).toBe("managed");
    expect(res.tried).toEqual([{ strategy: "managed", result: "ok" }]);
    expect(second.called).toBe(false);
  });

  it("records failing strategies in tried[] and continues", () => {
    const r = new ToolRegistry({ overrides: tmpOverridesStore() });
    r.register(
      binaryDef("pi", [
        fail("override", "no override set"),
        fail("managed", "missing: /bad/path"),
        fixedOk("where", "/usr/bin/pi"),
      ]),
    );

    const res = r.resolve("pi");
    expect(res.ok).toBe(true);
    expect(res.source).toBe("system");
    expect(res.tried).toEqual([
      { strategy: "override", result: "no override set" },
      { strategy: "managed", result: "missing: /bad/path" },
      { strategy: "where", result: "ok" },
    ]);
  });

  it("produces ok:false with full trail when every strategy fails", () => {
    const r = new ToolRegistry({ overrides: tmpOverridesStore() });
    r.register(
      binaryDef("pi", [fail("a", "reason a"), fail("b", "reason b")]),
    );

    const res = r.resolve("pi");
    expect(res.ok).toBe(false);
    expect(res.path).toBeNull();
    expect(res.source).toBeNull();
    expect(res.tried).toEqual([
      { strategy: "a", result: "reason a" },
      { strategy: "b", result: "reason b" },
    ]);
  });

  it("validate() demotes strategy to failure with 'invalid: <reason>'", () => {
    const r = new ToolRegistry({ overrides: tmpOverridesStore() });
    r.register({
      ...binaryDef("pi", [fixedOk("override", "/bogus"), fixedOk("where", "/usr/bin/pi")]),
      validate: (p) =>
        p === "/bogus" ? { ok: false, reason: "not a file" } : { ok: true },
    });

    const res = r.resolve("pi");
    expect(res.ok).toBe(true);
    expect(res.path).toBe("/usr/bin/pi");
    expect(res.tried[0]).toEqual({ strategy: "override", result: "invalid: not a file" });
    expect(res.tried[1]).toEqual({ strategy: "where", result: "ok" });
  });
});

describe("ToolRegistry.rescan", () => {
  it("rescan(name) clears just that tool's cache", () => {
    let callCount = 0;
    const r = new ToolRegistry({ overrides: tmpOverridesStore() });
    r.register(
      binaryDef("pi", [
        {
          name: "where",
          run: () => ({ ok: true, path: `/usr/bin/pi${++callCount}` }),
        },
      ]),
    );

    const first = r.resolve("pi");
    expect(first.path).toBe("/usr/bin/pi1");

    r.rescan("pi");
    const second = r.resolve("pi");
    expect(second.path).toBe("/usr/bin/pi2");
    expect(second).not.toBe(first);
  });

  it("rescan() without arg clears everything", () => {
    let a = 0, b = 0;
    const r = new ToolRegistry({ overrides: tmpOverridesStore() });
    r.register(binaryDef("pi", [{ name: "where", run: () => ({ ok: true, path: `/pi${++a}` }) }]));
    r.register(binaryDef("git", [{ name: "where", run: () => ({ ok: true, path: `/git${++b}` }) }]));

    r.resolve("pi"); r.resolve("git");
    r.rescan();
    expect(r.resolve("pi").path).toBe("/pi2");
    expect(r.resolve("git").path).toBe("/git2");
  });
});

describe("ToolRegistry.resolveModule", () => {
  it("caches the loaded module and returns the same reference on second call", async () => {
    const fakeModule = { DefaultPackageManager: () => "dpm" };
    let importCalls = 0;
    const r = new ToolRegistry({
      overrides: tmpOverridesStore(),
      importModule: async () => {
        importCalls++;
        return fakeModule;
      },
    });
    r.register(moduleDef("pi-coding-agent", [fixedOk("managed", "/managed/pi/dist/index.js")]));

    const a = await r.resolveModule("pi-coding-agent");
    const b = await r.resolveModule("pi-coding-agent");
    expect(a.module).toBe(fakeModule);
    expect(b.module).toBe(fakeModule);
    expect(importCalls).toBe(1);
  });

  it("throws ModuleResolutionError with trail when every strategy fails", async () => {
    const r = new ToolRegistry({
      overrides: tmpOverridesStore(),
      importModule: async () => { throw new Error("should not import"); },
    });
    r.register(moduleDef("pi-coding-agent", [fail("a", "nope"), fail("b", "also nope")]));

    await expect(r.resolveModule("pi-coding-agent")).rejects.toBeInstanceOf(ModuleResolutionError);
    try {
      await r.resolveModule("pi-coding-agent");
    } catch (e) {
      const err = e as ModuleResolutionError;
      expect(err.resolution.tried).toEqual([
        { strategy: "a", result: "nope" },
        { strategy: "b", result: "also nope" },
      ]);
      expect(err.message).toContain("a: nope");
      expect(err.message).toContain("b: also nope");
    }
  });

  it("refuses to resolve a non-module tool", async () => {
    const r = new ToolRegistry({ overrides: tmpOverridesStore() });
    r.register(binaryDef("pi", [fixedOk("where", "/usr/bin/pi")]));
    await expect(r.resolveModule("pi")).rejects.toThrow(/not kind: "module"/);
  });

  it("rescan(name) drops the cached module so the next call re-imports", async () => {
    let importCalls = 0;
    const r = new ToolRegistry({
      overrides: tmpOverridesStore(),
      importModule: async () => ({ n: ++importCalls }),
    });
    r.register(moduleDef("pi-coding-agent", [fixedOk("managed", "/x/dist/index.js")]));

    const a = await r.resolveModule("pi-coding-agent");
    r.rescan("pi-coding-agent");
    const b = await r.resolveModule("pi-coding-agent");
    expect((a.module as { n: number }).n).toBe(1);
    expect((b.module as { n: number }).n).toBe(2);
  });
});

describe("ToolRegistry overrides", () => {
  it("setOverride invalidates cache and the next resolve() picks override source", () => {
    const store = tmpOverridesStore();
    const r = new ToolRegistry({ overrides: store });
    r.register(
      binaryDef("pi", [
        {
          name: "override",
          run: (ctx) => ctx.overrides["pi"]
            ? { ok: true, path: ctx.overrides["pi"] }
            : { ok: false, reason: "no override set" },
        },
        fixedOk("where", "/usr/bin/pi"),
      ]),
    );

    expect(r.resolve("pi").path).toBe("/usr/bin/pi");
    r.setOverride("pi", "/custom/pi");
    const next = r.resolve("pi");
    expect(next.path).toBe("/custom/pi");
    expect(next.source).toBe("override");
  });

  it("clearOverride removes the entry and falls back to next strategy", () => {
    const store = tmpOverridesStore();
    store.set("pi", "/custom/pi");
    const r = new ToolRegistry({ overrides: store });
    r.register(
      binaryDef("pi", [
        {
          name: "override",
          run: (ctx) => ctx.overrides["pi"]
            ? { ok: true, path: ctx.overrides["pi"] }
            : { ok: false, reason: "no override set" },
        },
        fixedOk("where", "/usr/bin/pi"),
      ]),
    );

    expect(r.resolve("pi").path).toBe("/custom/pi");
    r.clearOverride("pi");
    expect(r.resolve("pi").path).toBe("/usr/bin/pi");
  });

  it("setOverride throws UnknownToolError for unregistered names", () => {
    const r = new ToolRegistry({ overrides: tmpOverridesStore() });
    expect(() => r.setOverride("ghost", "/x")).toThrow(UnknownToolError);
  });
});

describe("ToolRegistry.list", () => {
  it("returns one Resolution per registered tool", () => {
    const r = new ToolRegistry({ overrides: tmpOverridesStore() });
    r.register(binaryDef("pi", [fixedOk("where", "/pi")]));
    r.register(binaryDef("git", [fail("where", "not found")]));

    const all = r.list();
    expect(all.map((x) => x.name).sort()).toEqual(["git", "pi"]);
    expect(all.find((x) => x.name === "pi")!.ok).toBe(true);
    expect(all.find((x) => x.name === "git")!.ok).toBe(false);
  });
});

// Clean up any stray tmp files the tmpOverridesStore helper might leave.
afterAll();
function afterAll() {
  try {
    for (const f of fs.readdirSync(os.tmpdir())) {
      if (f.startsWith("tool-overrides-test-")) {
        try { fs.unlinkSync(path.join(os.tmpdir(), f)); } catch {}
      }
    }
  } catch {}
}
