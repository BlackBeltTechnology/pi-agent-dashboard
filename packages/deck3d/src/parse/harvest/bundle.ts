/**
 * Builds and caches the browser bundle of `harness.ts` (mermaid + our harvest
 * logic). The bundle is produced once at package build time
 * (`scripts/build-harvest.ts` → `dist/harvest/harness.js`); in dev and tests it
 * is rebuilt on demand when missing or stale.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pkgRoot } from "../../util/paths.js";

/** Package root — correct both unbundled (src) and bundled (`dist/cli.js`). */
export const PACKAGE_ROOT = pkgRoot();
const HARNESS_DIR = join(PACKAGE_ROOT, "src", "parse", "harvest");
export const HARNESS_SRC = join(HARNESS_DIR, "harness.ts");
export const HARNESS_HTML = join(HARNESS_DIR, "harness.html");
export const BUNDLE_PATH = join(PACKAGE_ROOT, "dist", "harvest", "harness.js");

/** Bundle `harness.ts` to an IIFE string and write it to `dist/harvest/`. */
export async function buildHarnessBundle(): Promise<string> {
  const esbuild = await import("esbuild");
  const result = await esbuild.build({
    entryPoints: [HARNESS_SRC],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    write: false,
    logLevel: "silent",
    legalComments: "none",
  });
  const code = result.outputFiles[0].text;
  mkdirSync(dirname(BUNDLE_PATH), { recursive: true });
  writeFileSync(BUNDLE_PATH, code);
  return code;
}

/** The cached bundle, rebuilt when missing or older than the harness source. */
export async function getHarnessBundle(): Promise<string> {
  if (existsSync(BUNDLE_PATH) && statSync(BUNDLE_PATH).mtimeMs >= statSync(HARNESS_SRC).mtimeMs) {
    return readFileSync(BUNDLE_PATH, "utf8");
  }
  return buildHarnessBundle();
}

/** Read the HTML shell with `__BUNDLE__`/`__FONT__`/`__STALL__` substituted. */
export function renderHarnessHtml(bundle: string, fontBase64: string, stall: boolean): string {
  const template = readFileSync(HARNESS_HTML, "utf8");
  const safeBundle = bundle.replace(/<\/script/gi, "<\\/script");
  return template
    .split('"__BUNDLE__"')
    .join(safeBundle)
    .split("__FONT__")
    .join(fontBase64)
    .split('"__STALL__"')
    .join(stall ? "true" : "false");
}
