// TypeScript-loader selection for every dashboard-server launch site.
//
// Plain `.mjs` because the pre-loader CLI wrapper (`bin/pi-dashboard.mjs`)
// runs before any TypeScript loader exists and must share this rule with
// `server-launcher.ts`, the bin wrapper, workers, and Doctor.
//
//   - `selectTsLoader(env)` → "native" unless PI_DASHBOARD_TS_LOADER === "jiti".
//     Unknown non-empty values warn once per call and fall back to "native".
//     A Node without `stripTypeScriptTypes({ mode: "transform" })` (Node 26
//     accepts only "strip", which rejects parameter properties) → "jiti".
//   - `resolveNativeTsLoader({ anchor })` → `file://` URL of
//     `native-ts-register.mjs`. With an anchor, resolve by package specifier
//     from it (D2); otherwise / on failure, the copy shipped beside this file.
//
// See change: fix-appimage-cold-boot-latency (design D1, D2).
import { existsSync } from "node:fs";
import nodeModule, { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

export const TS_LOADER_ENV = "PI_DASHBOARD_TS_LOADER";
const SIBLING_REGISTER = "./native-ts-register.mjs";
export const NATIVE_TS_REGISTER_SPECIFIER =
  "@blackbelt-technology/pi-dashboard-shared/platform/native-ts-register.mjs";

let transformSupportCache;

// Probe whether this Node's `stripTypeScriptTypes` accepts transform mode.
// Silences only the probe's ExperimentalWarning. Pass a module to test.
export function nativeTransformSupported(mod) {
  if (mod === undefined && transformSupportCache !== undefined) return transformSupportCache;
  const target = mod ?? nodeModule;
  let supported = false;
  if (typeof target.stripTypeScriptTypes === "function") {
    const originalEmitWarning = process.emitWarning;
    process.emitWarning = function emitWarning(warning, ...rest) {
      const msg = typeof warning === "string" ? warning : warning?.message;
      if (typeof msg === "string" && msg.startsWith("stripTypeScriptTypes is an experimental feature")) return;
      return originalEmitWarning.call(process, warning, ...rest);
    };
    try {
      target.stripTypeScriptTypes("", { mode: "transform" });
      supported = true;
    } catch {
      supported = false;
    } finally {
      process.emitWarning = originalEmitWarning;
    }
  }
  if (mod === undefined) transformSupportCache = supported;
  return supported;
}

export function selectTsLoader(env = process.env, warn = console.warn, transformSupported = nativeTransformSupported()) {
  const raw = env?.[TS_LOADER_ENV];
  if (raw === "jiti" || !transformSupported) return "jiti";
  if (raw !== undefined && raw !== "" && raw !== "native") {
    warn(`pi-dashboard: unknown ${TS_LOADER_ENV}=${JSON.stringify(raw)}; using the native TypeScript loader (valid: native, jiti).`);
  }
  return "native";
}

export function resolveNativeTsLoader(opts = {}) {
  if (opts.anchor) {
    try {
      return pathToFileURL(createRequire(opts.anchor).resolve(NATIVE_TS_REGISTER_SPECIFIER)).href;
    } catch {
      /* fall through to the sibling copy */
    }
  }
  // Sibling copy. The specifier is held in a variable on purpose: a bundler
  // (Vite, for Electron main) rewrites a URL built from a string literal plus `import.meta.url`
  // into an inlined `data:` URL, whose relative `./native-ts-hooks.mjs` cannot
  // resolve. Fail loudly instead of returning a path that does not exist.
  const url = new URL(SIBLING_REGISTER, import.meta.url);
  if (url.protocol !== "file:" || !existsSync(fileURLToPath(url))) {
    throw new Error(
      `pi-dashboard: cannot locate ${NATIVE_TS_REGISTER_SPECIFIER}` +
        (opts.anchor ? ` from ${opts.anchor}` : "") +
        `. Set ${TS_LOADER_ENV}=jiti to boot with the jiti loader.`,
    );
  }
  return url.href;
}

