/**
 * `selectTsLoader` decision table + `resolveNativeTsLoader` locator.
 * Pure-helper harness as in `node-spawn.test.ts`.
 *
 * See change: fix-appimage-cold-boot-latency (test-plan E7).
 */
import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { resolveNativeTsLoader, selectTsLoader } from "../platform/ts-loader-select.mjs";

describe("selectTsLoader (E7)", () => {
  it.each([
    ["unset", {}, "native"],
    ["native", { PI_DASHBOARD_TS_LOADER: "native" }, "native"],
    ["empty", { PI_DASHBOARD_TS_LOADER: "" }, "native"],
    ["jiti", { PI_DASHBOARD_TS_LOADER: "jiti" }, "jiti"],
  ] as const)("%s → %s without warning", (_label, env, expected) => {
    const warn = vi.fn();
    expect(selectTsLoader(env, warn)).toBe(expected);
    expect(warn).not.toHaveBeenCalled();
  });

  it("tsx → native with exactly one warning naming the var and the value", () => {
    const warn = vi.fn();
    expect(selectTsLoader({ PI_DASHBOARD_TS_LOADER: "tsx" }, warn)).toBe("native");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("PI_DASHBOARD_TS_LOADER");
    expect(warn.mock.calls[0]![0]).toContain("tsx");
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
