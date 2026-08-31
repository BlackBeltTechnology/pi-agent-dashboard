/**
 * Unit tests for `ensureTools` (design D4/D5).
 *
 * Report matrix (resolved against the folded scenarios — see the change's
 * tasks.md §8, the declared source of truth):
 *   present                                   → "present"      (ok contribution: yes)
 *   required missing, no hint                 → "blocked"      (8.15)
 *   required missing, hint, no autoInstall    → "recommended"  (8.29, still ok:false)
 *   required missing, autoInstall ran ok      → "installed"
 *   required missing, install denied/failed   → "blocked"      (8.31)
 *   optional missing (any path)               → "degraded"     (8.16)
 *   report.ok  ⇔ every required entry is present|installed     (8.15/8.17)
 *
 * The executed string is ALWAYS the registry definition's first-party
 * hint — never a manifest-supplied string (8.30).
 */
import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { ToolRegistry } from "../registry.js";
import { OverridesStore } from "../overrides.js";
import { ensureTools } from "../ensure.js";
import type { StrategyDeps } from "../strategies.js";
import type { ToolDefinition } from "../types.js";

/** Mutable fake env — the exec spy "installs" by setting a variable. */
const fakeEnv = new Map<string, string>();

function fixtureRegistry(): ToolRegistry {
  const store = new OverridesStore({
    filePath: path.join(os.tmpdir(), `ensure-tools-test-${Math.random()}.json`),
    warn: () => {},
  });
  const r = new ToolRegistry({ overrides: store, platform: "linux" });
  const envDef = (name: string): ToolDefinition => ({
    name,
    kind: "probe",
    strategies: [
      {
        name: "env",
        run: () =>
          fakeEnv.has(name)
            ? { ok: true, path: null }
            : { ok: false, reason: `env ${name} not set` },
      },
    ],
  });
  r.register(envDef("PRESENT_VAR"));
  r.register(envDef("MISSING_VAR"));
  r.register(envDef("INSTALLABLE_VAR"));
  r.register(envDef("CONFIRM_VAR"));
  // Required binary with a first-party brew hint that can never appear.
  r.register({
    name: "hinted-binary",
    kind: "binary",
    strategies: [{ name: "where", run: () => ({ ok: false, reason: "not found on PATH" }) }],
  });
  return r;
}

function baseDeps(): StrategyDeps {
  return {
    exists: () => false,
    which: (n) => (n === "brew" ? "/usr/bin/brew" : null),
    npmRootGlobal: () => "",
    resolveModule: () => null,
    readEnv: (n) => fakeEnv.get(n),
    readDir: () => [],
    requireModule: () => {
      throw new Error("nope");
    },
    dockerImageInspect: () => ({ ok: false, reason: "docker not available" }),
  };
}

/** Attach first-party hints to the fixture defs (post-registration). */
function withHints(r: ToolRegistry): void {
  const defs = [
    {
      name: "INSTALLABLE_VAR",
      installHints: { linux: { commands: { brew: "brew install installable-thing" } } },
    },
    {
      name: "CONFIRM_VAR",
      installHints: {
        linux: { commands: { brew: "brew install confirm-thing" }, requiresConfirm: true },
      },
    },
    {
      name: "hinted-binary",
      installHints: { linux: { commands: { brew: "brew install hinted-thing" } } },
    },
  ];
  for (const { name, installHints } of defs) {
    const def = r.list().find((t) => t.name === name);
    expect(def, name).toBeDefined();
    // Re-register with hints (register is last-wins by design).
    r.register({
      name,
      kind: name === "hinted-binary" ? "binary" : "probe",
      strategies:
        name === "hinted-binary"
          ? [{ name: "where", run: () => ({ ok: false, reason: "not found on PATH" }) }]
          : [
              {
                name: "env",
                run: () =>
                  fakeEnv.has(name)
                    ? { ok: true, path: null }
                    : { ok: false, reason: `env ${name} not set` },
              },
            ],
      installHints,
    });
  }
}

interface Ctx {
  r: ToolRegistry;
  execCalls: string[];
  exec: (command: string) => { ok: boolean };
}

function setup(): Ctx {
  fakeEnv.clear();
  fakeEnv.set("PRESENT_VAR", "x"); // the always-present fixture tool
  const r = fixtureRegistry();
  withHints(r);
  const execCalls: string[] = [];
  const exec = (command: string) => {
    execCalls.push(command);
    // Simulate a successful first-party install for the env-var tools.
    if (command.includes("installable-thing")) fakeEnv.set("INSTALLABLE_VAR", "1");
    if (command.includes("confirm-thing")) fakeEnv.set("CONFIRM_VAR", "1");
    return { ok: true };
  };
  return { r, execCalls, exec };
}

async function run(ctx: ReturnType<typeof setup>, tools: Array<{ id: string; optional?: boolean }>, opts: Record<string, unknown> = {}) {
  return ensureTools(tools, {
    registry: ctx.r,
    deps: baseDeps(),
    exec: ctx.exec,
    ...opts,
  });
}

describe("ensureTools — report matrix", () => {
  it("required missing without hint → blocked, ok:false, NO throw (8.15)", async () => {
    const ctx = setup();
    const report = await run(ctx, [{ id: "MISSING_VAR" }]);
    expect(report.ok).toBe(false);
    const entry = report.tools.find((t) => t.name === "MISSING_VAR");
    expect(entry?.action).toBe("blocked");
    expect(entry?.optional).toBe(false);
    expect(ctx.execCalls).toEqual([]);
  });

  it("optional missing → degraded, does not fail ok (8.16)", async () => {
    const ctx = setup();
    const report = await run(ctx, [{ id: "MISSING_VAR", optional: true }]);
    expect(report.ok).toBe(true);
    expect(report.tools[0].action).toBe("degraded");
    expect(report.tools[0].optional).toBe(true);
  });

  it("all present → present, ok:true (8.17)", async () => {
    const ctx = setup();
    const report = await run(ctx, [{ id: "PRESENT_VAR" }]);
    expect(report.ok).toBe(true);
    expect(report.tools[0].action).toBe("present");
  });

  it("required missing with hint, no autoInstall → recommended, exec spy uncalled (8.29)", async () => {
    const ctx = setup();
    const report = await run(ctx, [{ id: "hinted-binary" }]);
    expect(report.ok).toBe(false);
    expect(report.tools[0].action).toBe("recommended");
    expect(ctx.execCalls).toEqual([]);
  });

  it("autoInstall executes ONLY the first-party hint string (8.30)", async () => {
    const ctx = setup();
    const report = await run(ctx, [{ id: "INSTALLABLE_VAR" }], { autoInstall: true });
    // The executed command originates from the registry definition.
    expect(ctx.execCalls).toEqual(["brew install installable-thing"]);
    // …and the install took effect (re-resolve succeeds → installed).
    expect(report.ok).toBe(true);
    expect(report.tools[0].action).toBe("installed");
  });

  it("requiresConfirm + confirm→false → command NOT executed (8.31)", async () => {
    const ctx = setup();
    const report = await run(ctx, [{ id: "CONFIRM_VAR" }], {
      autoInstall: true,
      confirm: () => false,
    });
    expect(ctx.execCalls).toEqual([]);
    expect(report.ok).toBe(false);
    expect(report.tools[0].action).toBe("blocked");
  });

  it("requiresConfirm + confirm→true → first-party command runs, installed", async () => {
    const ctx = setup();
    const report = await run(ctx, [{ id: "CONFIRM_VAR" }], {
      autoInstall: true,
      confirm: () => true,
    });
    expect(ctx.execCalls).toEqual(["brew install confirm-thing"]);
    expect(report.ok).toBe(true);
    expect(report.tools[0].action).toBe("installed");
  });

  it("autoInstall with no eligible hint for the host → blocked, nothing executed", async () => {
    const ctx = setup();
    const report = await run(ctx, [{ id: "MISSING_VAR" }], { autoInstall: true });
    expect(ctx.execCalls).toEqual([]);
    expect(report.tools[0].action).toBe("blocked");
  });

  it("mixed report: required failure fails ok, optional failure does not", async () => {
    const ctx = setup();
    const report = await run(ctx, [
      { id: "PRESENT_VAR" },
      { id: "MISSING_VAR" },
      { id: "MISSING_VAR", optional: true },
    ]);
    expect(report.ok).toBe(false);
    expect(report.tools.map((t) => t.action)).toEqual(["present", "blocked", "degraded"]);
  });
});
