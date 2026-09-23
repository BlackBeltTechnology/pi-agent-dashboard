#!/usr/bin/env node
/**
 * Rewrite playwright-internal import specifiers in the vendored relay tree to
 * package-relative paths, and stamp an Apache-2.0 §4(b) modification notice.
 *
 * WHY. The browser plugin vendors playwright-core's CDP relay. Upstream
 * addresses its own helpers through playwright-internal bare specifiers
 * (`@isomorphic/*`, `@utils/wsServer`) that do not exist on npm. The plugin
 * originally mapped them onto `relay/vendor/shims/` with three alias layers
 * (tsconfig `paths`, a vitest `resolve.alias`, and jiti's `JITI_TSCONFIG_PATHS`).
 * None of those exists in an npm/managed/Electron install, so the plugin failed
 * to load there.
 *
 * Rewriting the specifiers to paths inside the package removes the need for all
 * three. This is the "copy -> verify -> patch -> rehash" refresh sequence's
 * patch step; `scripts/refresh-vendor.mjs` owns the whole sequence and this
 * script must never be run outside it when refreshing from upstream.
 *
 * IDEMPOTENT. Running twice leaves the tree byte-identical: the specifier
 * rewrite is a no-op once applied (so a second run rewrites nothing and writes
 * nothing), and the §4(b) header is detected by a sentinel and never stacked.
 * Asserted by `scripts/__tests__/patch-vendor-specifiers.test.mjs`.
 *
 * FAIL-CLOSED. A file that already carries the notice but still contains a
 * mapped specifier means upstream moved and the notice would under-report the
 * modification; that is an error, not a silent re-patch. So is any surviving
 * playwright-internal specifier with no mapping, anywhere under
 * `relay/vendor/**` (shims are on the rewritten imports' resolution path, so
 * they are scanned too even though they are not patch targets today).
 *
 * Exit code: non-zero when any playwright-internal specifier survives that has
 * no mapping (a future upstream refresh introducing `@protocol/foo` must fail
 * loudly, not produce a tree that only resolves in the monorepo).
 *
 * See change: fix-browser-plugin-vendor-specifier-resolution (D1, D3).
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const REPO_ROOT = resolve(import.meta.dirname, "..");

/** Vendored tree root, relative to a repo root. */
export const VENDOR_REL = "packages/browser-plugin/src/server/relay/vendor";

/** The subtree this script patches (shims are first-class sources, not targets). */
export const PLAYWRIGHT_CORE_REL = `${VENDOR_REL}/playwright-core`;

/**
 * playwright-internal namespaces. A surviving import under any of these is a
 * hard failure: the package would resolve it only through an alias that does
 * not exist in a published install.
 */
export const INTERNAL_NAMESPACES = ["@isomorphic/", "@utils/", "@protocol/", "@injected/"];

/**
 * Bare specifier -> target file under `relay/vendor/shims/`, relative to the
 * vendored tree root. The rewrite inserts the import's own depth prefix, so a
 * file four directories below `relay/vendor/` gets `../../../../shims/<name>.js`.
 */
export const SPECIFIER_MAP = Object.freeze({
  "@isomorphic/manualPromise": "shims/manualPromise.js",
  "@isomorphic/time": "shims/time.js",
  "@isomorphic/timeoutRunner": "shims/timeoutRunner.js",
  "@utils/wsServer": "shims/wsServer.js",
});

/** Sentinel proving the §4(b) header was already applied (idempotency). */
export const PATCH_MARKER = "scripts/patch-vendor-specifiers.mjs";

/** Sentinel proving the §4(b) header was already applied (idempotency). */
const HEADER_OPEN = "/**";

/** Every `import ... from '<spec>'` / `import '<spec>'` specifier, in file order. */
export function importSpecifiers(text) {
  const found = [];
  const patterns = [
    // import x from "y"  /  import "y"  /  import type { x } from "y"
    /\bimport\s+(?:[^'"]*?\bfrom\s+)?['"]([^'"]+)['"]/g,
    // export { x } from "y"  /  export * from "y"  /  export type { x } from "y"
    // Re-exports matter and used to be missed: a vendored file may FORWARD a
    // playwright-internal specifier without importing it, so `export … from`
    // slipped past both this patch step and the specifier guard, and the plugin
    // then died with the same `Cannot find module` this change exists to fix.
    /\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s+['"]([^'"]+)['"]/g,
  ];
  for (const re of patterns) for (const match of text.matchAll(re)) found.push(match[1]);
  return found;
}

/** True when `spec` is a bare playwright-internal specifier. */
export function isInternalSpecifier(spec) {
  return INTERNAL_NAMESPACES.some((ns) => spec.startsWith(ns));
}

/** `../../..` prefix reaching `relay/vendor/` from a file at `relPath`. */
export function depthPrefix(relPath) {
  const depth = dirname(relPath).split("/").filter(Boolean).length;
  return "../".repeat(depth);
}

/** sha256 of a file's bytes, as the integrity manifest records them. */
export function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function walkTs(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTs(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** The §4(b) notice, naming the specifiers actually rewritten in this file. */
function noticeFor(rewrites) {
  const lines = rewrites.map((r) => ` *   ${r.from} -> ${r.to}`).join("\n");
  return [
    "/**",
    " * MODIFIED for @blackbelt-technology/pi-dashboard-browser-plugin.",
    " *",
    " * Copied from microsoft/playwright at the commit recorded in",
    " * relay/vendor/NOTICE (Apache License 2.0). These playwright-internal",
    " * import specifiers were rewritten to package-relative paths so the plugin",
    " * resolves without tsconfig `paths`, a bundler alias, or the",
    " * JITI_TSCONFIG_PATHS environment variable:",
    " *",
    lines,
    " *",
    ` * Generated by ${PATCH_MARKER}: do not edit by hand.`,
    " * Refresh via scripts/refresh-vendor.mjs (copy, verify, patch, rehash).",
    " */",
    "",
  ].join("\n");
}

/**
 * Patch one file's text. Pure: returns the new text plus what happened.
 * `relPath` is the file's path relative to the vendored tree root, used only to
 * compute the relative-import prefix.
 */
export function patchText(text, relPath) {
  const prefix = depthPrefix(relPath);
  const rewrites = [];

  let patched = text;
  for (const [from, target] of Object.entries(SPECIFIER_MAP)) {
    const to = `${prefix}${target}`;
    let hit = false;
    for (const quote of ["'", '"']) {
      const needle = `${quote}${from}${quote}`;
      if (patched.includes(needle)) {
        patched = patched.split(needle).join(`${quote}${to}${quote}`);
        hit = true;
      }
    }
    if (hit) rewrites.push({ from, to });
  }

  // §4(b): only modified bytes carry the notice, and only once. A notice that
  // is already present while a mapped specifier still is means the file was
  // re-copied WITHOUT clearing the notice (or upstream added one) — the notice
  // would then under-report, so this is a hard failure rather than a re-patch.
  const alreadyNoticed = patched.includes(PATCH_MARKER);
  if (rewrites.length > 0 && !alreadyNoticed) {
    const licenseEnd = patched.indexOf("*/");
    const insertAt = patched.startsWith(HEADER_OPEN) && licenseEnd !== -1 ? licenseEnd + 2 : 0;
    const head = patched.slice(0, insertAt);
    const rest = patched.slice(insertAt).replace(/^\n+/, "");
    patched = `${head}\n\n${noticeFor(rewrites).trimEnd()}\n\n${rest}`;
  }

  return { text: patched, rewrites, staleNotice: alreadyNoticed && rewrites.length > 0 };
}

/**
 * Patch the vendored `playwright-core/` subtree under `root`.
 *
 * Returns `{ changed, rewrites, unmapped }`, where `changed` is the relative
 * paths written, `rewrites` counts specifier occurrences, and `unmapped` names
 * surviving playwright-internal specifiers (hard failure when non-empty).
 */
export function patchTree(root = REPO_ROOT) {
  const files = walkTs(join(root, VENDOR_REL)).sort();

  const changed = [];
  const unmapped = [];
  const staleNotices = [];
  let rewrites = 0;

  for (const file of files) {
    const relPath = relative(join(root, VENDOR_REL), file).split(sep).join("/");
    const before = readFileSync(file, "utf-8");
    const isPatchTarget = relPath.startsWith("playwright-core/");
    const { text, rewrites: fileRewrites, staleNotice } = isPatchTarget
      ? patchText(before, relPath)
      : { text: before, rewrites: [], staleNotice: false };
    rewrites += fileRewrites.length;
    if (staleNotice) staleNotices.push(`${VENDOR_REL}/${relPath}`);
    if (text !== before) {
      writeFileSync(file, text);
      changed.push(`${VENDOR_REL}/${relPath}`);
    }
    for (const spec of importSpecifiers(text)) {
      if (isInternalSpecifier(spec)) unmapped.push({ file: `${VENDOR_REL}/${relPath}`, spec });
    }
  }

  return { changed, rewrites, unmapped, staleNotices };
}

function main(argv) {
  const rootFlag = argv.indexOf("--root");
  const root = rootFlag === -1 ? REPO_ROOT : resolve(argv[rootFlag + 1]);

  const { changed, rewrites, unmapped, staleNotices } = patchTree(root);
  for (const rel of changed) console.log(`patched ${rel}`);
  console.log(`${changed.length} file(s), ${rewrites} specifier line(s) rewritten`);

  for (const rel of staleNotices) {
    console.error(`\n${rel}: already carries the §4(b) notice but still contains a mapped specifier.`);
    console.error(`Re-copy this file from upstream before patching — the notice would under-report.`);
  }
  if (staleNotices.length > 0) return 1;

  if (unmapped.length > 0) {
    console.error(`\nUnmapped playwright-internal specifier(s):`);
    for (const { file, spec } of unmapped) console.error(`  ${spec}  (${file})`);
    console.error(`Add a mapping in scripts/patch-vendor-specifiers.mjs, or vendor the target.`);
    return 1;
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(main(process.argv.slice(2)));
}
