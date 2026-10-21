#!/usr/bin/env node
/**
 * Plugin/core boundary gate. Core packages and plugins SHALL NOT import plugin
 * packages. A ratcheting allowlist (`scripts/plugin-boundary-allowlist.json`)
 * records the known edges: a NEW edge or a STALE row fails the run.
 *
 *   node scripts/check-plugin-boundary.mjs [--root <dir>] [--allowlist <file>]
 *                                          [--no-allowlist] [--write-baseline]
 *
 *   --no-allowlist    report every edge as NEW (ignore the allowlist file)
 *   --write-baseline  rewrite the allowlist from current edges; rows that still
 *                     match keep reason/disposition/removedBy, stale rows drop
 *
 * Plugin set = packages whose `package.json#pi-dashboard-plugin` or adjacent
 * `dashboard-plugin.json` exists (never a name pattern). "Core" = every other
 * `packages/*` package. Edges: ts imports (`ts.preProcessFile`), mock / dynamic
 * template literals, all four package.json dependency fields, CSS `@source`.
 * Rows are keyed `(from, to)` — line numbers never enter the key, so churn
 * above an import does not invalidate a row.
 *
 * Exemptions are computed from manifests on every run, never stored as rows:
 *   - the generated client plugin registry / plugin-sources.css;
 *   - `packages/client/package.json` `dependencies` on a bundled plugin
 *     (non-fixture, declares `client`);
 *   - fixture plugins used from tests or `devDependencies`.
 *
 * `./host` symbol check (design D6/X7): the runtime root re-exports every
 * `dashboard-plugin-runtime/src/host.ts` name as `@deprecated` for one minor. An
 * in-repo plugin file (test or prod) importing / re-exporting such a name from
 * the package ROOT fails unless the allowlist's `hostRootImports` has a row
 * `{ file, expires, reason }` covering it. `expires` (`MAJOR.MINOR[.PATCH]`) is
 * inclusive: valid while the runtime package version <= `expires`, an error once
 * greater. A row whose file no longer violates is STALE. Skipped when
 * `src/host.ts` is absent.
 *
 * Exit: 0 ok, 1 violations, 2 script error. No dependencies beyond `typescript`.
 *
 * See change: decouple-plugins-from-core.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWLIST_REL = "scripts/plugin-boundary-allowlist.json";
const PACKAGES = "packages";
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".git", ".worktrees", "release", "out"]);
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const DEP_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const KIND_ORDER = ["prod", "test", "pkg", "css", "host"];
// Built by concatenation: the pnpm contract test scans string literals for undeclared workspace imports.
const RUNTIME_ROOT = `${"@blackbelt-technology"}/dashboard-plugin-runtime`;
const RUNTIME_HOST = `${RUNTIME_ROOT}/host`;
const RUNTIME_DIR = "packages/dashboard-plugin-runtime";
const GENERATED = new Set([
  "packages/client/src/generated/plugin-registry.tsx",
  "packages/client/src/generated/plugin-sources.css",
]);
const CLIENT_PKG = "packages/client/package.json";

/** Test sources: test dirs, `*.test.*` / `*.spec.*`, and vitest/jest setup files. */
const TEST_PATH =
  /(^|\/)(__tests__|__mocks__|tests?|test-support|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)(vitest|jest)[.-][\w.-]*setup[\w.-]*\.[cm]?[jt]s$|(^|\/)[\w.-]*\.setup\.[cm]?[jt]s$|(^|\/)setup\.[cm]?[jt]s$/;
export const isTestFile = (rel) => TEST_PATH.test(rel);

const MOCK_LITERAL = /\b(?:vi|jest)\s*\.\s*(?:do)?(?:mock|unmock|importActual|requireActual)\s*\(\s*(["'`])([^"'`$]+)\1/g;
const DYNAMIC_TEMPLATE = /\b(?:import|require)\s*\(\s*`([^`$]*)/g;
const CSS_SOURCE = /@source\s+(?:not\s+)?(?:inline\()?\s*["']([^"']+)["']/g;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** One record per `packages/<dir>` holding a package.json. */
function loadPackages(root) {
  const base = path.join(root, PACKAGES);
  const pkgs = [];
  for (const dir of fs.existsSync(base) ? fs.readdirSync(base).sort() : []) {
    const json = readJson(path.join(base, dir, "package.json"));
    if (!json) continue;
    const sidecar = readJson(path.join(base, dir, "dashboard-plugin.json"));
    const manifest = json["pi-dashboard-plugin"] ?? sidecar;
    const m = manifest && typeof manifest === "object" ? manifest : {};
    pkgs.push({
      dir,
      name: json.name,
      isPlugin: Boolean(manifest),
      fixture: m.fixture === true,
      hasClient: Boolean(m.client),
    });
  }
  return pkgs;
}

function buildContext(root) {
  const pkgs = loadPackages(root);
  const byDir = new Map(pkgs.map((p) => [p.dir, p]));
  const byName = new Map(pkgs.filter((p) => p.name).map((p) => [p.name, p]));
  const bundled = new Set(pkgs.filter((p) => p.isPlugin && !p.fixture && p.hasClient).map((p) => p.dir));
  return { root, byDir, byName, bundled };
}

function* walk(dir, base = dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(path.join(dir, entry.name), base);
    } else if (entry.isFile()) {
      yield path.relative(base, path.join(dir, entry.name)).split(path.sep).join("/");
    }
  }
}

const packageDirOf = (rel) => (rel.startsWith(`${PACKAGES}/`) ? rel.split("/")[1] : null);

/** Package dir a module specifier or relative path points at, or null. */
function resolveTarget(spec, fromRel, ctx) {
  if (spec.startsWith(".")) {
    const joined = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
    return packageDirOf(joined);
  }
  const m = spec.match(/^(@[^/]+\/[^/]+|[^/@][^/]*)/);
  return m ? (ctx.byName.get(m[1])?.dir ?? null) : null;
}

/** Every module specifier of a ts/js file: imports, requires, mock literals. */
function tsSpecifiers(content) {
  const specs = new Set();
  for (const f of ts.preProcessFile(content, true, true).importedFiles) specs.add(f.fileName);
  return specs;
}

/** Offsets of block comments, so literal scanners skip commented-out code. */
function blockComments(content) {
  return [...content.matchAll(/\/\*[\s\S]*?\*\//g)].map((m) => [m.index, m.index + m[0].length]);
}

function isCommented(content, index, blocks) {
  if (blocks.some(([a, b]) => index >= a && index < b)) return true;
  const lineStart = content.lastIndexOf("\n", index) + 1;
  return /(^|[^:])\/\//.test(content.slice(lineStart, index));
}

/** `vi|jest.(do)?mock|importActual("lit")` and `` import(`lit${x}`) `` prefixes. */
function literalSpecifiers(content) {
  const specs = new Set();
  const blocks = blockComments(content);
  for (const re of [MOCK_LITERAL, DYNAMIC_TEMPLATE]) {
    for (const m of content.matchAll(re)) {
      if (!isCommented(content, m.index, blocks)) specs.add(m[2] ?? m[1]);
    }
  }
  return specs;
}

function scanTsFile(rel, content, ctx) {
  const specs = new Set([...tsSpecifiers(content), ...literalSpecifiers(content)]);
  const kind = isTestFile(rel) ? "test" : "prod";
  const refs = [];
  for (const spec of specs) {
    const to = resolveTarget(spec, rel, ctx);
    if (isHostSpecifier(spec)) refs.push({ from: rel, to: "dashboard-plugin-runtime/host", kind: "host" });
    else if (to) refs.push({ from: rel, to, kind });
  }
  return refs;
}

const isHostSpecifier = (spec) => spec === RUNTIME_HOST || spec.startsWith(`${RUNTIME_HOST}/`);

function scanPackageJson(rel, json, ctx) {
  const refs = [];
  for (const field of DEP_FIELDS) {
    for (const dep of Object.keys(json?.[field] ?? {})) {
      const to = ctx.byName.get(dep)?.dir;
      if (to) refs.push({ from: rel, to, kind: "pkg", field });
    }
  }
  return refs;
}

function scanCssFile(rel, content, ctx) {
  const refs = [];
  for (const m of content.matchAll(CSS_SOURCE)) {
    const to = resolveTarget(m[1].startsWith(".") ? m[1] : `./${m[1]}`, rel, ctx);
    if (to) refs.push({ from: rel, to, kind: "css" });
  }
  return refs;
}

/** Raw references of one file, before plugin classification and exemptions. */
function scanFile(rel, ctx) {
  const abs = path.join(ctx.root, rel);
  if (SOURCE_FILE.test(rel)) return scanTsFile(rel, fs.readFileSync(abs, "utf8"), ctx);
  if (rel.endsWith(".css")) return scanCssFile(rel, fs.readFileSync(abs, "utf8"), ctx);
  if (/^packages\/[^/]+\/package\.json$/.test(rel)) return scanPackageJson(rel, readJson(abs), ctx);
  return [];
}

function isExempt(ref, ctx) {
  if (GENERATED.has(ref.from)) return true;
  const target = ctx.byDir.get(ref.to);
  if (target.fixture && (ref.kind === "test" || ref.field === "devDependencies")) return true;
  return ref.from === CLIENT_PKG && ref.field === "dependencies" && ctx.bundled.has(ref.to);
}

function isViolation(ref, ctx) {
  if (ref.kind === "host") return !isTestFile(ref.from) && ctx.byDir.get(packageDirOf(ref.from))?.isPlugin === true;
  if (ref.to === packageDirOf(ref.from)) return false;
  return ctx.byDir.get(ref.to)?.isPlugin === true && !isExempt(ref, ctx);
}

/** Forbidden edges, one per `(from, to)`, sorted by kind then path. */
export function findEdges(root) {
  const ctx = buildContext(root);
  const edges = new Map();
  for (const rel of walk(path.join(root, PACKAGES), root)) {
    for (const ref of scanFile(rel, ctx)) {
      const key = rowKey(ref);
      if (!edges.has(key) && isViolation(ref, ctx)) edges.set(key, { from: ref.from, to: ref.to, kind: ref.kind });
    }
  }
  return [...edges.values()].sort(compareRows);
}

const rowKey = (r) => `${r.from}\u0000${r.to}`;
const kindRank = (k) => (KIND_ORDER.indexOf(k) === -1 ? KIND_ORDER.length : KIND_ORDER.indexOf(k));
const compareRows = (a, b) =>
  kindRank(a.kind) - kindRank(b.kind) || a.from.localeCompare(b.from) || a.to.localeCompare(b.to);

/** Names exported by `dashboard-plugin-runtime/src/host.ts` (empty when absent). */
function hostExportNames(root) {
  const file = path.join(root, RUNTIME_DIR, "src", "host.ts");
  if (!fs.existsSync(file)) return new Set();
  const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const names = new Set();
  for (const n of sf.statements) {
    if (ts.isExportDeclaration(n) && n.exportClause && ts.isNamedExports(n.exportClause)) {
      for (const e of n.exportClause.elements) names.add(e.name.text);
    } else if (ts.isVariableStatement(n) && n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const d of n.declarationList.declarations) if (ts.isIdentifier(d.name)) names.add(d.name.text);
    } else if (
      (ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n) || ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n)) &&
      n.name &&
      n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      names.add(n.name.text);
    }
  }
  return names;
}

/** Host names a file imports / re-exports from the package ROOT (not a subpath). */
function rootHostNamesOf(content, hostNames) {
  const sf = ts.createSourceFile("x.tsx", content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = new Set();
  for (const n of sf.statements) {
    const named = ts.isImportDeclaration(n) ? n.importClause?.namedBindings : ts.isExportDeclaration(n) ? n.exportClause : undefined;
    if (!(ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) || n.moduleSpecifier?.text !== RUNTIME_ROOT) continue;
    if (!named || !(ts.isNamedImports(named) || ts.isNamedExports(named))) continue;
    for (const e of named.elements) {
      const name = (e.propertyName ?? e.name).text;
      if (hostNames.has(name)) found.add(name);
    }
  }
  return [...found].sort();
}

/** In-repo plugin files that import a `./host` name from the runtime root: `{ file, names }`. */
export function findHostRootImports(root) {
  const hostNames = hostExportNames(root);
  if (hostNames.size === 0) return [];
  const ctx = buildContext(root);
  const out = [];
  for (const rel of walk(path.join(root, PACKAGES), root)) {
    if (!SOURCE_FILE.test(rel) || rel.startsWith(`${RUNTIME_DIR}/`)) continue;
    if (ctx.byDir.get(packageDirOf(rel))?.isPlugin !== true) continue;
    const content = fs.readFileSync(path.join(root, rel), "utf8");
    if (!content.includes(RUNTIME_ROOT)) continue;
    const names = rootHostNamesOf(content, hostNames);
    if (names.length) out.push({ file: rel, names });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/** `MAJOR.MINOR[.PATCH]` → numeric triple; a missing patch is `Infinity` (the whole minor is covered). */
function parseVersionLoose(v) {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(v ?? ""));
  return m ? [Number(m[1]), Number(m[2]), m[3] === undefined ? Number.POSITIVE_INFINITY : Number(m[3])] : null;
}
const compareVersions = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

function runtimeVersion(root) {
  const v = readJson(path.join(root, RUNTIME_DIR, "package.json"))?.version;
  const parsed = parseVersionLoose(v);
  return parsed ? { text: v, parsed } : null;
}

/** Compare host-root imports with `hostRootImports` rows → violation lines. */
export function reconcileHostRoot(imports, rows, version) {
  const lines = [];
  const rowByFile = new Map(rows.map((r) => [r.file, r]));
  const importFiles = new Set(imports.map((i) => i.file));
  for (const { file, names } of imports) {
    const row = rowByFile.get(file);
    if (!row) {
      lines.push(
        `HOST-IMPORT ${file} imports ${names.join(", ")} from the runtime root — import it from the ./host subpath of dashboard-plugin-runtime (./test-support for __reset*ForTests helpers)`,
      );
      continue;
    }
    const expires = parseVersionLoose(row.expires);
    if (!expires) {
      lines.push(`HOST-IMPORT allowlist row for ${file} has no valid "expires" (MAJOR.MINOR[.PATCH])`);
    } else if (version && compareVersions(version.parsed, expires) > 0) {
      lines.push(
        `EXPIRED host-import allowlist row ${file} (expires ${row.expires}; runtime is ${version.text}) — migrate ${file} to ./host or ./test-support and delete the row`,
      );
    }
  }
  for (const row of rows) {
    if (!importFiles.has(row.file)) lines.push(`STALE host-import allowlist row ${row.file} — no host name imported from the root any more, delete it`);
  }
  return lines;
}

const PLACEHOLDER = "TODO";
const ANNOTATIONS = ["reason", "disposition", "removedBy"];
const isUnannotated = (row) => ANNOTATIONS.some((f) => !row[f] || row[f] === PLACEHOLDER);

/** Compare edges with allowlist rows → NEW edges, STALE rows, UNANNOTATED rows. */
export function reconcile(edges, rows) {
  const rowKeys = new Set(rows.map(rowKey));
  const edgeKeys = new Set(edges.map(rowKey));
  return {
    added: edges.filter((e) => !rowKeys.has(rowKey(e))),
    stale: rows.filter((r) => !edgeKeys.has(rowKey(r))),
    unannotated: rows.filter(isUnannotated),
  };
}

/** Rewrite rows from current edges, keeping annotations of rows that still match. */
export function rebaseline(edges, rows) {
  const old = new Map(rows.map((r) => [rowKey(r), r]));
  return edges.map((e) => {
    const prev = old.get(rowKey(e));
    const fresh = { from: e.from, to: e.to, kind: e.kind };
    const notes = Object.fromEntries(ANNOTATIONS.map((f) => [f, PLACEHOLDER]));
    return { ...fresh, ...notes, ...prev, kind: e.kind };
  });
}

function loadRows(file) {
  if (!fs.existsSync(file)) return [];
  const json = readJson(file);
  if (!json || !Array.isArray(json.rows)) throw new Error(`${file}: expected {"rows": [...]}`);
  return json.rows;
}

/** Optional `hostRootImports` rows (`{ file, expires, reason }`). */
function loadHostRows(file) {
  if (!fs.existsSync(file)) return [];
  const rows = readJson(file)?.hostRootImports;
  if (rows === undefined) return [];
  if (!Array.isArray(rows)) throw new Error(`${file}: "hostRootImports" must be an array`);
  return rows;
}

const fmtEdge = (e) => `[${e.kind}] ${e.from} → ${e.to}`;

function report(result) {
  const lines = [];
  for (const e of result.added) lines.push(`NEW ${fmtEdge(e)}`);
  for (const r of result.stale) lines.push(`STALE allowlist entry ${fmtEdge(r)} — no matching edge, delete it`);
  for (const r of result.unannotated) lines.push(`UNANNOTATED allowlist entry ${fmtEdge(r)} — set reason, disposition, removedBy`);
  return lines;
}

function parseArgs(argv) {
  const opts = { root: DEFAULT_ROOT, allowlist: null, noAllowlist: false, writeBaseline: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") opts.root = path.resolve(argv[++i]);
    else if (a === "--allowlist") opts.allowlist = path.resolve(argv[++i]);
    else if (a === "--no-allowlist") opts.noAllowlist = true;
    else if (a === "--write-baseline") opts.writeBaseline = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  opts.allowlist ??= path.join(opts.root, ALLOWLIST_REL);
  return opts;
}

function writeBaseline(file, edges) {
  const rows = rebaseline(edges, loadRows(file));
  const hostRootImports = loadHostRows(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = hostRootImports.length ? { rows, hostRootImports } : { rows };
  fs.writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
  return rows;
}

function main(argv) {
  const opts = parseArgs(argv);
  const edges = findEdges(opts.root);
  if (opts.writeBaseline) {
    const rows = writeBaseline(opts.allowlist, edges);
    console.log(`plugin boundary: wrote ${rows.length} row(s) to ${path.relative(opts.root, opts.allowlist)}`);
    return 0;
  }
  const rows = opts.noAllowlist ? [] : loadRows(opts.allowlist);
  const hostRows = opts.noAllowlist ? [] : loadHostRows(opts.allowlist);
  const lines = [
    ...report(reconcile(edges, rows)),
    ...reconcileHostRoot(findHostRootImports(opts.root), hostRows, runtimeVersion(opts.root)),
  ];
  if (lines.length === 0) {
    console.log(`plugin boundary: OK — ${edges.length} allowlisted edge(s), ${hostRows.length} host-import row(s)`);
    return 0;
  }
  console.error(lines.join("\n"));
  console.error(`plugin boundary: ${lines.length} violation(s). Fix the import, or (after review) --write-baseline.`);
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(`check-plugin-boundary: ${err.message}`);
    process.exitCode = 2;
  }
}
