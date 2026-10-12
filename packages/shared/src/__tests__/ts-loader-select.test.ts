/**
 * `legacyTsLoaderEnvWarning` decision table + `resolveNativeTsLoader` locator.
 * Pure-helper harness as in `node-spawn.test.ts`.
 *
 * See change: fix-appimage-cold-boot-latency (test-plan E7);
 * strip-only-native-ts-loader (test-plan #E14).
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { legacyTsLoaderEnvWarning, resolveNativeTsLoader } from "../platform/ts-loader-select.mjs";

// #E14 — the jiti server loader is gone; PI_DASHBOARD_TS_LOADER is ignored.
// Empty / "native" stay silent; any other value yields exactly one warning
// string for the SERVER process to log. The helper never touches the env.
describe("legacyTsLoaderEnvWarning (#E14)", () => {
  it.each([
    ["unset", {}],
    ["empty", { PI_DASHBOARD_TS_LOADER: "" }],
    ["native", { PI_DASHBOARD_TS_LOADER: "native" }],
  ] as const)("%s → no warning", (_label, env) => {
    expect(legacyTsLoaderEnvWarning(env)).toBeNull();
  });

  it.each(["jiti", "tsx", "garbage"])("%s → one warning naming the variable", (value) => {
    const env = { PI_DASHBOARD_TS_LOADER: value };
    const msg = legacyTsLoaderEnvWarning(env);
    expect(msg).toContain("PI_DASHBOARD_TS_LOADER is no longer supported");
    expect(msg).toContain("native loader");
    expect(env).toEqual({ PI_DASHBOARD_TS_LOADER: value }); // not mutated
  });
});

describe("resolveNativeTsLoader", () => {
  it("returns a file:// URL of an existing platform/native-ts-register.mjs", () => {
    const url = resolveNativeTsLoader();
    expect(url.startsWith("file://")).toBe(true);
    expect(url).toMatch(/\/platform\/native-ts-register\.mjs$/);
    expect(existsSync(fileURLToPath(url))).toBe(true);
  });

  it("resolves by package specifier from an anchor inside the repo", () => {
    const anchor = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../server/src/cli.ts");
    const url = resolveNativeTsLoader({ anchor });
    expect(url).toMatch(/\/platform\/native-ts-register\.mjs$/);
    expect(existsSync(fileURLToPath(url))).toBe(true);
  });

  it("falls back to the sibling copy for an anchor that cannot see the package", () => {
    expect(resolveNativeTsLoader({ anchor: "/x/cli.ts" })).toBe(resolveNativeTsLoader());
  });
});

// A bundler (Vite, for Electron main) rewrites a literal
// `new URL("./x", import.meta.url)` into an inlined `data:` URL, so a bundled
// caller taking the sibling fallback got a register whose relative
// `./native-ts-hooks.mjs` cannot resolve. The fallback must stay opaque to
// that static analysis. See change: fix-appimage-cold-boot-latency.
describe("resolveNativeTsLoader is bundler-safe", () => {
  it("never builds the sibling URL from a string literal next to import.meta.url", () => {
    const src = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../platform/ts-loader-select.mjs"), "utf-8");
    expect(src).not.toMatch(/new URL\(\s*["'`]/);
  });
});
