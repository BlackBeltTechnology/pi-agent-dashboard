/**
 * Plugin-spawn-scope env projection: `scope.extensionConfig[name][key]` →
 * namespaced env `PI_EXT_<NAME>_<KEY>` on the headless mechanism, driven
 * through the real `pluginSpawnToSessionOptions` mapper into `buildSpawnEnv`.
 *
 * Covers E9 (config → env), E10 (name/key normalization), E11 (absent ⇒ env
 * untouched), X3 (NUL-bearing value dropped). The mapper sanitizes NUL values
 * before they reach `buildSpawnEnv`, so the full mapper→env path is exercised
 * here rather than `buildSpawnEnv` in isolation.
 *
 * A separate source-order lint (X5) asserts the hook maps BEFORE it enqueues
 * an `automationRun` stamp — a mapper failure must not strand a stale stamp
 * keyed by `cwd`.
 *
 * See change: add-plugin-spawn-scope.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pluginSpawnToSessionOptions } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { describe, expect, it } from "vitest";
import { buildSpawnEnv } from "../spawn-process/process-manager.js";

/** Keys this capability introduces on top of the base env. */
function piExtKeys(env: NodeJS.ProcessEnv): string[] {
  return Object.keys(env).filter((k) => k.startsWith("PI_EXT_"));
}

/** Base env with zero PI_EXT_* so additions are attributable to the mapper. */
function cleanBaseEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of piExtKeys(env)) delete env[k];
  return env;
}

describe("plugin-spawn-scope env projection", () => {
  it("E9: extensionConfig → PI_EXT_<NAME>_<KEY>; no argv element derived", () => {
    const mapped = pluginSpawnToSessionOptions({ cwd: "/w", scope: { extensionConfig: { myext: { token: "abc" } } } });
    const env = buildSpawnEnv(cleanBaseEnv(), { extensionConfig: mapped.extensionConfig });
    expect(env.PI_EXT_MYEXT_TOKEN).toBe("abc");
  });

  it("E10: name/key are uppercased with non-[A-Z0-9_] → _", () => {
    const mapped = pluginSpawnToSessionOptions({ cwd: "/w", scope: { extensionConfig: { "my-ext": { "api.key": "v" } } } });
    const env = buildSpawnEnv(cleanBaseEnv(), { extensionConfig: mapped.extensionConfig });
    expect(env.PI_EXT_MY_EXT_API_KEY).toBe("v");
  });

  it("E11: extensionConfig absent ⇒ env carries no PI_EXT_* from this capability", () => {
    const mapped = pluginSpawnToSessionOptions({ cwd: "/w", model: "m" });
    const env = buildSpawnEnv(cleanBaseEnv(), { extensionConfig: mapped.extensionConfig });
    expect(piExtKeys(env)).toEqual([]);
  });

  it("X3: a NUL-bearing config value is dropped; siblings survive; no crash", () => {
    const opts = {
      cwd: "/w",
      scope: { extensionConfig: { myext: { token: "a\u0000b", ok: "v" } } },
    } as unknown as Parameters<typeof pluginSpawnToSessionOptions>[0];
    const mapped = pluginSpawnToSessionOptions(opts);
    const env = buildSpawnEnv(cleanBaseEnv(), { extensionConfig: mapped.extensionConfig });
    expect(env.PI_EXT_MYEXT_OK).toBe("v");
    expect(env.PI_EXT_MYEXT_TOKEN).toBeUndefined();
  });

  it("E15: array value round-trips losslessly via JSON; sibling scalar stays verbatim", () => {
    const allowedRoots = ["/a", "/b,c", " /d "];
    const mapped = pluginSpawnToSessionOptions({
      cwd: "/w",
      scope: { extensionConfig: { guard: { allowedRoots, token: "abc" } } },
    });
    const env = buildSpawnEnv(cleanBaseEnv(), { extensionConfig: mapped.extensionConfig });
    // Array key: JSON-encoded, parses back deep-equal to the original.
    expect(JSON.parse(env.PI_EXT_GUARD_ALLOWED_ROOTS as string)).toEqual(allowedRoots);
    // Sibling scalar key: still projected verbatim (no JSON quoting).
    expect(env.PI_EXT_GUARD_TOKEN).toBe("abc");
  });
});

describe("plugin-spawn-scope hook ordering (X5)", () => {
  it("maps options BEFORE enqueuing an automationRun stamp", () => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const source = fs.readFileSync(path.resolve(__dirname, "..", "server.ts"), "utf8");
    const mapIdx = source.indexOf("pluginSpawnToSessionOptions(opts)");
    const enqueueIdx = source.indexOf("pendingAutomationRunRegistry.enqueue(opts.cwd");
    expect(mapIdx, "pluginSpawnToSessionOptions(opts) call must be present").toBeGreaterThan(-1);
    expect(enqueueIdx, "pendingAutomationRunRegistry.enqueue(opts.cwd, ...) must be present").toBeGreaterThan(-1);
    expect(
      mapIdx,
      "the total mapper must run BEFORE the automationRun enqueue so a sanitized/rejected input cannot strand a stale stamp keyed by cwd (design D7)",
    ).toBeLessThan(enqueueIdx);
  });
});
