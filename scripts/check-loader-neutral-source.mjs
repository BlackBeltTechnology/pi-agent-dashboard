#!/usr/bin/env node
/**
 * Loader-neutral source gate.
 *
 * The dashboard server boots on the Node-native TypeScript loader by default
 * (`PI_DASHBOARD_TS_LOADER=jiti` falls back to jiti). jiti transpiles
 * first-party TS to CommonJS and injects `require`, `__dirname`,
 * `__filename`; native ESM has none of them, and a bare use throws a
 * `ReferenceError` only when that (often lazy) code path runs. This gate makes
 * the class visible at test time.
 *
 * Rules, AST-level (never textual — strings/templates/comments are ignored):
 *   - `require`, `__dirname`, `__filename`, `exports` referenced while the file
 *     declares no binding of that name (`const require = createRequire(…)`,
 *     `const __dirname = dirname(fileURLToPath(import.meta.url))` pass);
 *   - `module.<x>` with no `module` binding;
 *   - a `.tsx` file reached by a VALUE import (`import type` is erased).
 *   `.cts` files load as CommonJS under both loaders and are not scanned.
 *
 * Scope is derived: the `serverMain` + `pluginServer` seed kinds of
 * `lib-jiti-scope.mjs` (both plugin-manifest forms), walked through their
 * first-party value-import graph; a `serverMain` workspace contributes its
 * whole `src/**` (workers load sibling `.ts` entries by URL, not specifier).
 * `piExtension` / `pluginBridge` seeds run under pi's jiti — out of scope.
 * An empty file set fails the gate.
 *
 * Usage: node scripts/check-loader-neutral-source.mjs [--root <dir>]
 * Wired into `npm test` via scripts/__tests__/loader-neutral-source.test.mjs.
 * See change: fix-appimage-cold-boot-latency (design D5).
 */
import { readFileSync } from "node:fs";
import nodeModule from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as acorn from "acorn";
import {
  discoverSeeds as defaultDiscoverSeeds,
  filesUnder,
  isExcludedPath,
  repoRoot,
  resolveFirstParty,
  workspaceIndex,
} from "./lib-jiti-scope.mjs";

const SERVER_KINDS = new Set(["serverMain", "pluginServer"]);
/** Module sources the gate parses; anything else reached (`.json`, assets) is data. */
const SCANNED_EXT = new Set([".ts", ".mts", ".js", ".mjs"]);
const FREE_GLOBALS = new Set(["require", "__dirname", "__filename", "exports"]);

/** TS → JS with line positions preserved when possible (strip), else transform. */
function toJs(source) {
  try {
    return nodeModule.stripTypeScriptTypes(source, { mode: "strip" });
  } catch {
    return nodeModule.stripTypeScriptTypes(source, { mode: "transform" });
  }
}

function parse(js) {
  return acorn.parse(js, {
    ecmaVersion: "latest",
    sourceType: "module",
    locations: true,
    allowHashBang: true,
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    allowImportExportEverywhere: true,
  });
}

/** Every child node of `node` with the key it hangs under. */
function* children(node) {
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "start" || key === "end" || key === "loc") continue;
    const v = node[key];
    if (Array.isArray(v)) {
      for (const c of v) if (c && typeof c.type === "string") yield [key, c];
    } else if (v && typeof v.type === "string") {
      yield [key, v];
    }
  }
}

function patternNames(p, out) {
  if (!p) return;
  switch (p.type) {
    case "Identifier": out.add(p.name); break;
    case "ObjectPattern": for (const prop of p.properties) patternNames(prop.type === "RestElement" ? prop.argument : prop.value, out); break;
    case "ArrayPattern": for (const el of p.elements) patternNames(el, out); break;
    case "RestElement": patternNames(p.argument, out); break;
    case "AssignmentPattern": patternNames(p.left, out); break;
  }
}

/** Names the file binds anywhere (file-level approximation, per design D5). */
function declaredNames(ast) {
  const out = new Set();
  const stack = [ast];
  while (stack.length > 0) {
    const n = stack.pop();
    switch (n.type) {
      case "VariableDeclarator": patternNames(n.id, out); break;
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        if (n.id) out.add(n.id.name);
        for (const p of n.params) patternNames(p, out);
        break;
      case "ClassDeclaration":
      case "ClassExpression": if (n.id) out.add(n.id.name); break;
      case "ImportSpecifier":
      case "ImportDefaultSpecifier":
      case "ImportNamespaceSpecifier": out.add(n.local.name); break;
      case "CatchClause": patternNames(n.param, out); break;
    }
    for (const [, c] of children(n)) stack.push(c);
  }
  return out;
}

/** True when an Identifier under `parent[key]` is a name, not a reference. */
function isNonReference(parent, key) {
  if (!parent) return false;
  switch (parent.type) {
    case "MemberExpression": return key === "property" && !parent.computed;
    case "Property":
    case "MethodDefinition":
    case "PropertyDefinition": return key === "key" && !parent.computed;
    case "LabeledStatement":
    case "BreakStatement":
    case "ContinueStatement": return key === "label";
    case "ImportSpecifier": return key === "imported";
    case "ExportSpecifier": return key === "exported";
    case "MetaProperty": return true;
    default: return false;
  }
}

/** Static string value of an import source node, or null. */
function staticSource(node) {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0].value.cooked;
  return null;
}

/**
 * Scan one TS/JS source. Returns `{ violations, imports }` where `imports` are
 * the static VALUE-import specifiers (type-only imports are erased first).
 */
export function scanSource(source, file) {
  let ast;
  try {
    ast = parse(toJs(source));
  } catch (err) {
    return { violations: [{ file, line: 0, rule: "unparseable", message: `cannot parse: ${err.message}` }], imports: [] };
  }
  const declared = declaredNames(ast);
  const violations = [];
  const imports = [];
  const stack = [[ast, null, null]];
  while (stack.length > 0) {
    const [n, parent, key] = stack.pop();
    if (n.type === "ImportDeclaration" || n.type === "ExportAllDeclaration" || n.type === "ExportNamedDeclaration" || n.type === "ImportExpression") {
      const spec = staticSource(n.source);
      if (spec) imports.push(spec);
    }
    if (n.type === "Identifier" && !isNonReference(parent, key) && !declared.has(n.name)) {
      const line = n.loc.start.line;
      if (FREE_GLOBALS.has(n.name)) {
        violations.push({ file, line, rule: n.name, message: `unbound CommonJS global \`${n.name}\` (use createRequire / import.meta)` });
      } else if (n.name === "module" && parent?.type === "MemberExpression" && key === "object") {
        const prop = parent.property.name ?? parent.property.value;
        violations.push({ file, line, rule: `module.${prop}`, message: `unbound CommonJS \`module.${prop}\`` });
      }
    }
    for (const [k, c] of children(n)) stack.push([c, n, k]);
  }
  return { violations, imports };
}

/**
 * Run the gate. `discoverSeeds` is injectable so the fail-closed path is
 * testable. Returns `{ ok, files, violations, error? }`.
 */
export function runLoaderNeutralGate({ root = repoRoot, discoverSeeds = defaultDiscoverSeeds } = {}) {
  const { byName } = workspaceIndex(root);
  const seeds = (discoverSeeds(root).tagged ?? []).filter((s) => SERVER_KINDS.has(s.kind));
  const seen = new Set();
  const viaImport = new Set();
  const queue = [];
  const push = (rel, byImport) => {
    if (!rel || isExcludedPath(rel)) return;
    if (byImport) viaImport.add(rel);
    if (seen.has(rel)) return;
    seen.add(rel);
    queue.push(rel);
  };
  for (const s of seeds) push(s.entry, true);
  for (const s of seeds.filter((x) => x.kind === "serverMain")) {
    for (const f of filesUnder(path.join(root, path.dirname(s.entry)), root)) push(f, false);
  }

  const violations = [];
  while (queue.length > 0) {
    const rel = queue.pop();
    const ext = path.extname(rel);
    if (!SCANNED_EXT.has(ext)) continue; // .tsx judged after the walk; .cts is CommonJS by design; data files
    let source;
    try {
      source = readFileSync(path.join(root, rel), "utf8");
    } catch {
      continue;
    }
    const scan = scanSource(source, rel);
    violations.push(...scan.violations);
    const abs = path.join(root, rel);
    for (const spec of scan.imports) push(resolveFirstParty(spec, abs, root, byName), true);
  }
  for (const rel of viaImport) {
    if (path.extname(rel) === ".tsx") {
      violations.push({ file: rel, line: 1, rule: "tsx", message: "`.tsx` value-imported into server scope (the native loader cannot load JSX)" });
    }
  }

  const files = [...seen].sort();
  violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  if (files.length === 0) {
    return { ok: false, files, violations, error: "loader-neutral gate: empty file set — seed discovery is broken, not the repo clean" };
  }
  return { ok: violations.length === 0, files, violations };
}

function main(argv) {
  const i = argv.indexOf("--root");
  const root = i >= 0 ? path.resolve(argv[i + 1]) : repoRoot;
  const res = runLoaderNeutralGate({ root });
  if (res.error) {
    console.error(`✗ ${res.error}`);
    return 1;
  }
  for (const v of res.violations) console.error(`✗ ${v.file}:${v.line} [${v.rule}] ${v.message}`);
  if (!res.ok) {
    console.error(`✗ loader-neutral gate: ${res.violations.length} violation(s) in ${res.files.length} server-loaded file(s)`);
    return 1;
  }
  console.log(`✓ loader-neutral gate: ${res.files.length} server-loaded file(s), zero violations`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(main(process.argv.slice(2)));
}
