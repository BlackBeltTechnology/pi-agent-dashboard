#!/usr/bin/env node
/**
 * Static specifier guard for the vendored relay tree.
 *
 * Every import under `relay/vendor/` must resolve from the published package
 * alone: a Node builtin, a dependency declared in the plugin's `package.json`,
 * or a relative path. Anything else resolves only through a monorepo-only alias
 * layer — the defect this guard exists to prevent.
 *
 * WHY NOT A NAMESPACE ALLOWLIST. The previous design resolved
 * `@isomorphic/*` / `@utils/wsServer` through tsconfig `paths`. A guard that
 * rejected exactly those prefixes would pass a future upstream refresh that
 * introduces `@protocol/` or `@injected/` — a new instance of the same bug.
 * This guard asks the real question instead: is this specifier a builtin or a
 * declared dependency?
 *
 * SCOPE. All of `relay/vendor/`, not just `playwright-core/`: the rewritten
 * imports resolve INTO `shims/`, so a shim acquiring an internal specifier is
 * the same failure class. Parsing import syntax (not grepping text) matters —
 * `NOTICE` and `AGENTS.md` legitimately name the old specifiers in prose.
 *
 * Exit code: non-zero naming every offending file + specifier.
 *
 * See change: fix-browser-plugin-vendor-specifier-resolution (D4.2).
 */
import { readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { importSpecifiers, REPO_ROOT, VENDOR_REL } from "./patch-vendor-specifiers.mjs";

export { REPO_ROOT, VENDOR_REL };
export const PLUGIN_PKG_REL = "packages/browser-plugin/package.json";

/**
 * Node's own module list, both spellings. Used instead of a blanket `node:`
 * prefix rule so an unknown builtin (`node:not-real`) is a violation rather
 * than being waved through on its scheme — `node:` is reserved, not a wildcard.
 */
export const BUILTINS = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

/**
 * Only `./` and `../` are acceptable local specifiers. Absolute paths and
 * non-`node:` schemes are NOT: the spec allows a package-relative path, a Node
 * builtin, or a declared dependency — `/tmp/x.js` and `file:`/`https:` are none
 * of those and would resolve differently (or not at all) for a consumer.
 */
export function isLocalRelative(spec) {
  return spec.startsWith("./") || spec.startsWith("../");
}

/** Dynamic `import('x')` / `require('x')`, which the static regex misses. */
export function dynamicSpecifiers(text) {
  const found = [];
  for (const re of [/\bimport\s*\(\s*['"]([^'"]+)['"]/g, /\brequire\s*\(\s*['"]([^'"]+)['"]/g]) {
    for (const m of text.matchAll(re)) found.push(m[1]);
  }
  return found;
}

/** Fields installed for a consumer — the ones an import may rely on. */
export function declaredDependencies(pkgPath) {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  const fields = ["dependencies", "peerDependencies", "optionalDependencies"];
  const names = new Set();
  for (const field of fields) for (const name of Object.keys(pkg[field] ?? {})) names.add(name);
  return names;
}

/** Package name of a bare specifier (`@scope/pkg/sub` -> `@scope/pkg`). */
export function packageNameOf(spec) {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
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

/**
 * Check every vendored import against {builtins} ∪ {declared}.
 * Returns `{ ok, violations, checked }`; violations name file + specifier.
 */
export function checkVendorSpecifiers(root = REPO_ROOT) {
  const declared = declaredDependencies(join(root, PLUGIN_PKG_REL));
  const files = walkTs(join(root, VENDOR_REL)).sort();

  const violations = [];
  let checked = 0;

  for (const file of files) {
    const relPath = relative(join(root, VENDOR_REL), file).split(sep).join("/");
    const text = readFileSync(file, "utf-8");
    for (const spec of [...importSpecifiers(text), ...dynamicSpecifiers(text)]) {
      checked += 1;
      if (isLocalRelative(spec)) continue;
      if (BUILTINS.has(spec)) continue;
      if (declared.has(packageNameOf(spec))) continue;
      violations.push({ file: `${VENDOR_REL}/${relPath}`, specifier: spec });
    }
  }

  return { ok: violations.length === 0, violations, checked };
}

function main(argv) {
  const rootFlag = argv.indexOf("--root");
  const root = rootFlag === -1 ? REPO_ROOT : resolve(argv[rootFlag + 1]);
  const { ok, violations, checked } = checkVendorSpecifiers(root);

  if (ok) {
    console.log(`vendored specifiers ok (${checked} import(s) checked)`);
    return 0;
  }
  for (const { file, specifier } of violations) console.error(`UNDECLARED ${specifier}  (${file})`);
  console.error(
    `\n${violations.length} unresolvable specifier(s). Rewrite them to a relative path via ` +
      `scripts/patch-vendor-specifiers.mjs, or declare the dependency.`,
  );
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(main(process.argv.slice(2)));
}
