/**
 * Registration and resolution tests for the `pi-ai` module-kind tool.
 *
 * Verifies:
 * - Registry resolves pi-ai when ~/.pi-dashboard/node_modules/@earendil-works/pi-ai/dist/index.js exists (managed)
 * - Falls back to npmGlobalStrategy when only globally installed
 * - Returns failed resolution with diagnostic trail when none match
 * - Override takes precedence
 *
 * Note: bareImportStrategy uses real module resolution (createRequire) and
 * cannot be injected via StrategyDeps.resolveModule in moduleDefWithAliases.
 * It is implicitly tested (fails gracefully when pi-ai isn't a project dep).
 *
 * See change: add-dashboard-model-proxy (task 2.1).
 */
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ToolRegistry,
  registerDefaultTools,
  OverridesStore,
} from "../index.js";

const HOME = os.homedir();
const MANAGED_PATH = path.join(
  HOME,
  ".pi-dashboard",
  "node_modules",
  "@earendil-works",
  "pi-ai",
  "dist",
  "index.js",
);

function freshRegistry(opts: {
  exists?: (p: string) => boolean;
  which?: (name: string) => string | null;
  npmRootGlobal?: () => string;
  overrides?: Record<string, string>;
}) {
  const store = new OverridesStore({
    filePath: path.join(os.tmpdir(), `pi-ai-test-${Math.random()}.json`),
    warn: () => {},
  });
  for (const [k, v] of Object.entries(opts.overrides ?? {})) store.set(k, v);

  const r = new ToolRegistry({
    overrides: store,
    platform: "linux",
  });
  registerDefaultTools(r, {
    exists: opts.exists ?? (() => false),
    which: opts.which ?? (() => null),
    npmRootGlobal: opts.npmRootGlobal ?? (() => ""),
    // Bare-import resolver returns null so the test's filesystem-fake
    // semantics are honoured; without this the new dir-walk fallback
    // in `defaultResolveModule` finds the package in the repo's real
    // node_modules and bypasses the managed/npm-global assertions.
    // See change: fix-node-resolution-under-electron (follow-up).
    resolveModule: () => null,
  });
  return r;
}

describe("pi-ai: module registration", () => {
  it("resolves via managed path when ~/.pi-dashboard/node_modules/@earendil-works/pi-ai exists", () => {
    const r = freshRegistry({
      exists: (p) => p === MANAGED_PATH,
    });
    const result = r.resolve("pi-ai");
    expect(result.ok).toBe(true);
    expect(result.path).toBe(MANAGED_PATH);
    expect(result.source).toBe("managed");
  });

  it("falls back to npm-global when only globally installed", () => {
    const globalRoot = "/usr/lib/node_modules";
    const globalPath = path.join(
      globalRoot,
      "@earendil-works",
      "pi-ai",
      "dist",
      "index.js",
    );
    const r = freshRegistry({
      exists: (p) => p === globalPath,
      npmRootGlobal: () => globalRoot,
    });
    const result = r.resolve("pi-ai");
    expect(result.ok).toBe(true);
    expect(result.path).toBe(globalPath);
    expect(result.source).toBe("npm-global");
  });

  it("returns failed resolution with diagnostic trail when none match", () => {
    const r = freshRegistry({});
    const result = r.resolve("pi-ai");
    expect(result.ok).toBe(false);
    expect(result.tried).toBeDefined();
    expect(result.tried!.length).toBeGreaterThan(0);
    // Should have tried override, bare-import, managed, npm-global
    const strategyNames = result.tried!.map((t) => t.strategy);
    expect(strategyNames).toContain("override");
    expect(strategyNames).toContain("bare-import");
    expect(strategyNames).toContain("managed");
    expect(strategyNames).toContain("npm-global");
  });

  it("override takes precedence over managed", () => {
    const overridePath = "/custom/pi-ai/dist/index.js";
    const r = freshRegistry({
      exists: (p) => p === overridePath || p === MANAGED_PATH,
      overrides: { "pi-ai": overridePath },
    });
    const result = r.resolve("pi-ai");
    expect(result.ok).toBe(true);
    expect(result.path).toBe(overridePath);
    expect(result.source).toBe("override");
  });

  it("is registered and resolvable by name", () => {
    const r = freshRegistry({
      exists: (p) => p === MANAGED_PATH,
    });
    const result = r.resolve("pi-ai");
    expect(result.name).toBe("pi-ai");
    expect(result.ok).toBe(true);
  });
});
