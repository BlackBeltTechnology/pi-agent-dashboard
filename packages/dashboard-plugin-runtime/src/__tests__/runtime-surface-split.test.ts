/**
 * Runtime root split (test-plan #E23, #E24; change: decouple-plugins-from-core).
 *
 * Export sets are read with the TypeScript checker (values AND types), so a type-only
 * re-export drifting out of `public.ts` is caught too. The Phase-5 import-map shim
 * (`runtime.ts`) does not exist yet; its "== public" leg lands with Phase 5.
 *
 * @structural-pin the surface split is a property of which names the barrel files export; the TS checker reads those source files to prove it
 */
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(import.meta.dirname, "..");
const OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  skipLibCheck: true,
  noEmit: true,
  allowImportingTsExtensions: true,
  strict: true,
  paths: { "@blackbelt-technology/pi-dashboard-shared/*": [path.resolve(SRC, "../../shared/src/*")] },
};

function exportNames(file: string): Set<string> {
  const program = ts.createProgram([path.join(SRC, file)], OPTIONS);
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(path.join(SRC, file));
  const sym = sf && checker.getSymbolAtLocation(sf);
  if (!sym) throw new Error(`no module symbol for ${file}`);
  return new Set(checker.getExportsOfModule(sym).map((s) => s.name));
}

const pub = exportNames("public.ts");
const host = exportNames("host.ts");
const root = exportNames("index.ts");
const testSupport = exportNames("test-support/index.ts");
const context = exportNames("plugin-context.tsx");

describe("runtime surface split (#E23)", () => {
  it("public ∩ host = ∅", () => {
    expect([...pub].filter((n) => host.has(n))).toEqual([]);
  });

  it("root ⊇ public and root ⊇ host (deprecated re-exports)", () => {
    expect([...pub].filter((n) => !root.has(n))).toEqual([]);
    expect([...host].filter((n) => !root.has(n))).toEqual([]);
  });

  it("root exports nothing beyond public + host", () => {
    expect([...root].filter((n) => !pub.has(n) && !host.has(n))).toEqual([]);
  });

  it("public holds the v1 members", () => {
    for (const n of [
      "useT",
      "SettingsGroup",
      "usePluginConfig",
      "useUiPrimitive",
      "usePluginLogger",
      "usePluginRouter",
      "useSessionEvents",
      "bumpSlotClaimsVersion",
      "PLUGIN_HOST_API_VERSION",
      "satisfiesHostApi",
      "lazyClaim",
    ]) {
      expect(pub.has(n), n).toBe(true);
    }
  });

  it("host holds the shell names", () => {
    for (const n of [
      "createSlotRegistry",
      "PluginContextProvider",
      "SlotErrorBoundary",
      "IntentRenderer",
      "useSlotRegistry",
      "useSlotRegistryOrNull",
      "initPluginConfigs",
      "applyPluginConfigUpdate",
      "setSender",
      "intentStore",
      "claimsToRouteDescriptors",
      "EmbeddedAppShellProvider",
    ]) {
      expect(host.has(n), n).toBe(true);
    }
    expect([...host].filter((n) => /Slot$/.test(n) && !/^(Anchored|Automation)/.test(n)).length).toBeGreaterThan(10);
  });

  it("__reset*ForTests live only in ./test-support", () => {
    const resets = [...testSupport].filter((n) => /^__reset.*ForTests$/.test(n));
    expect(resets.length).toBeGreaterThanOrEqual(3);
    for (const set of [pub, host, root]) expect([...set].filter((n) => /^__reset/.test(n))).toEqual([]);
  });
});

describe("deprecated root re-exports and ./context (#E24)", () => {
  it("root.createSlotRegistry is the host function and carries a deprecation diagnostic", async () => {
    const rootMod = await import("../index.js");
    const hostMod = await import("../host.js");
    expect(rootMod.createSlotRegistry).toBe(hostMod.createSlotRegistry);

    const file = path.join(SRC, "__tests__", "__virtual-deprecated-import__.ts");
    const text = [
      'import { createSlotRegistry, usePluginConfig } from "../index.js";',
      "export const a = createSlotRegistry();",
      "export const b = usePluginConfig;",
    ].join("\n");
    const lsHost: ts.LanguageServiceHost = {
      getCompilationSettings: () => OPTIONS,
      getScriptFileNames: () => [file],
      getScriptVersion: () => "1",
      getScriptSnapshot: (f) => {
        if (f === file) return ts.ScriptSnapshot.fromString(text);
        const content = ts.sys.readFile(f);
        return content === undefined ? undefined : ts.ScriptSnapshot.fromString(content);
      },
      getCurrentDirectory: () => SRC,
      getDefaultLibFileName: ts.getDefaultLibFilePath,
      fileExists: (f) => f === file || ts.sys.fileExists(f),
      readFile: (f) => (f === file ? text : ts.sys.readFile(f)),
    };
    const diags = ts.createLanguageService(lsHost).getSuggestionDiagnostics(file);
    const deprecated = diags.filter((d) => d.code === 6385).map((d) => text.slice(d.start, (d.start ?? 0) + (d.length ?? 0)));
    expect(deprecated).toContain("createSlotRegistry");
    expect(deprecated).not.toContain("usePluginConfig");
  });

  it("./context is the same module for public hooks and host shell names", async () => {
    const ctx = await import("../plugin-context.js");
    const rootMod = await import("../index.js");
    const hostMod = await import("../host.js");
    expect(ctx.usePluginConfig).toBe(rootMod.usePluginConfig);
    expect(ctx.PluginContextProvider).toBe(hostMod.PluginContextProvider);
    expect(pub.has("PluginContextProvider")).toBe(false);
    for (const n of ["useSlotRegistry", "useSlotRegistryOrNull", "applyPluginConfigUpdate", "initPluginConfigs"]) {
      expect(context.has(n), n).toBe(true);
      expect(host.has(n), n).toBe(true);
    }
  });
});
