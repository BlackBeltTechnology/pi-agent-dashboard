#!/usr/bin/env node
/**
 * Host API surface snapshot + semver bump gate (design D7, R20).
 *
 *   node scripts/host-api-surface.mjs --write              regenerate the snapshot
 *   node scripts/host-api-surface.mjs [--check]            snapshot is current, version matches
 *   node scripts/host-api-surface.mjs --base <git-ref>     ... and the bump rule vs <ref>'s snapshot
 *
 * `packages/dashboard-plugin-runtime/host-api-surface.json` records the plugin-facing
 * contract, read with the TypeScript checker (`getExportsOfModule` + `typeToString`):
 *   - `public.ts` and `./sdk` export names;
 *   - `UI_PRIMITIVE_KEYS` values and the printed props shape of each `UiPrimitiveMap[K]`;
 *   - printed shapes of every `SlotPropsMap` member and every `PluginClaim` /
 *     `PluginManifest` field;
 *   - `HOST_FX_CLASSES` values;
 *   - the public CSS custom-property subset = the concrete token code spans named in
 *     `host-design.md` (`--accent-<hue>-text` expanded to six hues; names only, no values);
 *   - the import-map specifiers (planned list — the import map itself lands in Phase 5);
 *   - the host API version it was taken at (`PLUGIN_HOST_API_VERSION`).
 *
 * Bump rule (`checkBump`): removing a recorded name/key/class/variable needs a MAJOR bump;
 * adding one, or changing any printed shape, needs at least a MINOR bump (the gate cannot
 * tell widening from narrowing, so a shape change forces a reviewed bump). Anything not
 * recorded (internal CSS variables, `./host` names) never trips it.
 *
 * Exit: 0 ok, 1 violations, 2 script error. Only dependency: `typescript`.
 * See change: decouple-plugins-from-core.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME_DIR = "packages/dashboard-plugin-runtime";
const SNAPSHOT_REL = `${RUNTIME_DIR}/host-api-surface.json`;
const SHARED_DP = "packages/shared/src/dashboard-plugin";
const HOST_DESIGN_REL =
  "packages/dashboard-plugin-skill/.pi/skills/dashboard-plugin-scaffold/references/host-design.md";
const INDEX_CSS_REL = "packages/client/src/index.css";
// Built by concatenation: the pnpm contract test scans string literals for undeclared workspace imports.
const SCOPE = "@blackbelt-technology";
const RUNTIME_SPECIFIER = `${SCOPE}/dashboard-plugin-runtime`;

/** Import-map specifiers (design D9), in `HOST_IMPORT_MAP_IMPORTS` order (pinned equal by a test). */
export const IMPORT_MAP_SPECIFIERS = [
  "react",
  "react/jsx-runtime",
  "react-dom",
  "react-dom/client",
  RUNTIME_SPECIFIER,
  `${RUNTIME_SPECIFIER}/embedded-app`,
  `${SCOPE}/pi-dashboard-app-kit/react`,
  "wouter",
];

/** `--accent-<hue>-text` hues (client `index.css`; theme-gallery requires the ramp). */
const ACCENT_HUES = ["purple", "blue", "green", "orange", "red", "yellow"];
/** Pattern code spans in host-design.md with an explicit disposition. An unknown `<…>` / `{…}` token span fails. */
const PATTERN_SPANS = {
  "--accent-<hue>-text": { expand: ACCENT_HUES.map((h) => `--accent-${h}-text`) },
  "--accent-<hue>": { ignore: "fill accents: the doc forbids them for text, so they are not a plugin contract" },
  "--severity-<level>-{bg,fg,border}": { ignore: "template; the concrete --severity-* tokens the doc names are recorded" },
};

// ── CSS custom-property subset ────────────────────────────────────────────

const CONCRETE_TOKEN = /--[a-z0-9]+(?:-[a-z0-9]+)*(?![a-z0-9<{-])/g;

/** Tokens a span with a `<…>` / `{…}` pattern contributes; throws on a pattern with no tabulated disposition. */
function patternSpanTokens(span) {
  const handled = PATTERN_SPANS[span];
  if (handled) return handled.expand ?? [];
  const concrete = [...span.matchAll(CONCRETE_TOKEN)].length > 0;
  if (!concrete && /--[a-z0-9-]*[<{]/.test(span)) {
    throw new Error(`host-design.md code span \`${span}\` holds an unexpanded pattern — add it to PATTERN_SPANS (expand or ignore with a reason)`);
  }
  return [];
}

/** Public CSS custom properties named by host-design.md code spans; throws on an unhandled pattern span. */
export function parseHostDesignTokens(md) {
  const tokens = new Set();
  for (const [, span] of md.matchAll(/`([^`\n]+)`/g)) {
    if (!span.includes("--")) continue;
    if (/[<{]/.test(span)) for (const t of patternSpanTokens(span)) tokens.add(t);
    for (const m of span.matchAll(CONCRETE_TOKEN)) tokens.add(m[0]);
  }
  return [...tokens].sort();
}

const declaredCssTokens = (css) => new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));

// ── TypeScript checker ────────────────────────────────────────────────────

const OPTIONS = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  skipLibCheck: true,
  noEmit: true,
  strict: true,
  allowImportingTsExtensions: true,
};

function makeProgram(root) {
  const p = (rel) => path.join(root, rel);
  const files = [
    p(`${RUNTIME_DIR}/src/public.ts`),
    p(`${RUNTIME_DIR}/src/sdk.ts`),
    p(`${SHARED_DP}/ui-primitives.ts`),
    p(`${SHARED_DP}/slot-props.ts`),
    p(`${SHARED_DP}/manifest-types.ts`),
  ];
  const options = { ...OPTIONS, paths: { [`${SCOPE}/pi-dashboard-shared/*`]: [p("packages/shared/src/*")] } };
  const program = ts.createProgram(files, options);
  return { program, checker: program.getTypeChecker(), files };
}

const FMT = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope;

function isExternal(type, program) {
  const decl = type.symbol?.declarations?.[0] ?? type.aliasSymbol?.declarations?.[0];
  if (!decl) return false;
  const sf = decl.getSourceFile();
  return program.isSourceFileDefaultLibrary(sf) || sf.fileName.includes("/node_modules/");
}

/** Object types whose members belong to the plugin contract: declared in shared/dashboard-plugin, or anonymous. */
function isContractObject(type) {
  const name = type.symbol?.name;
  if (name === "__type" || name === "__object") return true;
  const file = type.symbol?.declarations?.[0]?.getSourceFile().fileName ?? "";
  return file.includes("/shared/src/dashboard-plugin/");
}

const COMPONENT_ALIASES = new Set(["ComponentType", "FunctionComponent", "ComponentClass"]);

function printMember(ctx, sym, depth, seen) {
  const { checker } = ctx;
  const decl = sym.valueDeclaration ?? sym.declarations?.[0];
  const t = decl ? checker.getTypeOfSymbolAtLocation(sym, decl) : checker.getDeclaredTypeOfSymbol(sym);
  const optional = sym.flags & ts.SymbolFlags.Optional ? "?" : "";
  return `${JSON.stringify(sym.name).slice(1, -1)}${optional}: ${printShape(ctx, t, depth + 1, seen)}`;
}

/** Print a type, expanding contract object shapes (depth-limited, cycle-safe) so member changes show up. */
function printShape(ctx, type, depth = 0, seen = new Set()) {
  const { checker, program, anchor } = ctx;
  const name = () => checker.typeToString(type, anchor, FMT).replace(/import\("[^"]*\/(packages\/[^"]*)"\)\./g, "");
  if (depth > 4) return name();
  const aliasProps = COMPONENT_ALIASES.has(type.aliasSymbol?.name) ? type.aliasTypeArguments?.[0] : undefined;
  if (aliasProps) return `component<${printShape(ctx, aliasProps, depth + 1, seen)}>`;
  if (type.isUnion()) {
    if (type.types.every((t) => t.flags & ts.TypeFlags.BooleanLiteral)) return "boolean";
    return [...new Set(type.types.map((t) => printShape(ctx, t, depth + 1, seen)))].sort().join(" | ");
  }
  if (type.isIntersection()) return type.types.map((t) => printShape(ctx, t, depth + 1, seen)).join(" & ");
  if (checker.isArrayType(type)) return `${printShape(ctx, checker.getTypeArguments(type)[0], depth + 1, seen)}[]`;
  const expandable = type.flags & ts.TypeFlags.Object && !isExternal(type, program) && isContractObject(type);
  const opaqueFn = type.getCallSignatures().length > 0 && type.getProperties().length === 0;
  const id = type.id ?? type.symbol;
  if (!expandable || opaqueFn || seen.has(id)) return name();
  const next = new Set(seen).add(id);
  const members = type
    .getProperties()
    .sort((x, y) => x.name.localeCompare(y.name))
    .map((sym) => printMember(ctx, sym, depth, next));
  return `{ ${members.join("; ")} }`;
}

function exportNames(checker, sf) {
  const sym = checker.getSymbolAtLocation(sf);
  if (!sym) throw new Error(`${sf.fileName}: not a module`);
  return checker
    .getExportsOfModule(sym)
    .map((s) => s.name)
    .sort();
}

function interfaceMembers(ctx, sf, ifaceName) {
  const { checker } = ctx;
  const decl = sf.statements.find((n) => ts.isInterfaceDeclaration(n) && n.name.text === ifaceName);
  if (!decl) throw new Error(`${sf.fileName}: interface ${ifaceName} not found`);
  const type = checker.getTypeAtLocation(decl.name);
  const out = {};
  for (const s of type.getProperties().sort((a, b) => a.name.localeCompare(b.name))) {
    const d = s.valueDeclaration ?? s.declarations?.[0];
    out[s.name] = `${s.flags & ts.SymbolFlags.Optional ? "?" : ""}${printShape(ctx, checker.getTypeOfSymbolAtLocation(s, d))}`;
  }
  return out;
}

function findConstDeclaration(sf, constName) {
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    const hit = st.declarationList.declarations.find((d) => ts.isIdentifier(d.name) && d.name.text === constName);
    if (hit) return hit;
  }
  throw new Error(`${sf.fileName}: const ${constName} not found`);
}

function constObjectValues(ctx, sf, constName) {
  const { checker } = ctx;
  const decl = findConstDeclaration(sf, constName);
  const out = {};
  for (const s of checker.getTypeAtLocation(decl.name).getProperties()) {
    const t = checker.getTypeOfSymbolAtLocation(s, s.valueDeclaration);
    out[s.name] = t.isStringLiteral() ? t.value : checker.typeToString(t);
  }
  return Object.fromEntries(Object.entries(out).sort(([x], [y]) => x.localeCompare(y)));
}

const readText = (root, rel) => fs.readFileSync(path.join(root, rel), "utf8");

/** Version of the host API as declared in shared/host-api.ts (read as text: no TS execution). */
function declaredHostApiVersion(root) {
  const m = /PLUGIN_HOST_API_VERSION\s*=\s*"(\d+\.\d+\.\d+)"/.exec(readText(root, `${SHARED_DP}/host-api.ts`));
  if (!m) throw new Error(`${SHARED_DP}/host-api.ts: PLUGIN_HOST_API_VERSION not found`);
  return m[1];
}

/** Compute the current surface from source. */
export function computeSurface(root = ROOT) {
  const { program, checker, files } = makeProgram(root);
  const sf = (i) => {
    const f = program.getSourceFile(files[i]);
    if (!f) throw new Error(`cannot load ${files[i]}`);
    return f;
  };
  const [pub, sdk, ui, slotProps, manifest] = [0, 1, 2, 3, 4].map(sf);
  const ctx = { checker, program, anchor: undefined };
  const withAnchor = (f) => ({ ...ctx, anchor: f });

  const uiKeys = constObjectValues(withAnchor(ui), ui, "UI_PRIMITIVE_KEYS");
  const uiMap = interfaceMembers(withAnchor(ui), ui, "UiPrimitiveMap");
  const fx = constObjectValues(withAnchor(sdk), program.getSourceFile(path.join(root, SHARED_DP, "host-fx-classes.ts")), "HOST_FX_CLASSES");

  const tokens = parseHostDesignTokens(readText(root, HOST_DESIGN_REL));
  const declared = declaredCssTokens(readText(root, INDEX_CSS_REL));
  const missing = tokens.filter((t) => !declared.has(t));
  if (missing.length) throw new Error(`host-design.md names CSS custom properties not declared in ${INDEX_CSS_REL}: ${missing.join(", ")}`);

  return {
    version: declaredHostApiVersion(root),
    publicExports: exportNames(checker, pub),
    sdkExports: exportNames(checker, sdk),
    uiPrimitiveKeys: uiKeys,
    uiPrimitiveProps: uiMap,
    slotProps: interfaceMembers(withAnchor(slotProps), slotProps, "SlotPropsMap"),
    claimFields: interfaceMembers(withAnchor(manifest), manifest, "PluginClaim"),
    manifestFields: interfaceMembers(withAnchor(manifest), manifest, "PluginManifest"),
    hostFxClasses: fx,
    cssCustomProperties: tokens,
    importMapSpecifiers: [...IMPORT_MAP_SPECIFIERS],
  };
}

// ── Diff + bump rule ──────────────────────────────────────────────────────

const LIST_SECTIONS = {
  publicExports: "public export",
  sdkExports: "sdk export",
  cssCustomProperties: "CSS custom property",
  importMapSpecifiers: "import-map specifier",
};
const MAP_SECTIONS = {
  uiPrimitiveKeys: "UI primitive key",
  uiPrimitiveProps: "UI primitive props",
  slotProps: "slot props",
  claimFields: "claim field",
  manifestFields: "manifest field",
  hostFxClasses: "host FX class",
};

function diffLists(label, a, b, out) {
  const left = new Set(a ?? []);
  const right = new Set(b ?? []);
  for (const n of left) if (!right.has(n)) out.removed.push({ section: label, name: n });
  for (const n of right) if (!left.has(n)) out.added.push({ section: label, name: n });
}

function diffMaps(label, a = {}, b = {}, out) {
  for (const [n, v] of Object.entries(a)) {
    if (!(n in b)) out.removed.push({ section: label, name: n });
    else if (v !== b[n]) out.changed.push({ section: label, name: n });
  }
  for (const n of Object.keys(b)) if (!(n in a)) out.added.push({ section: label, name: n });
}

/** Structural diff of two surfaces: `{removed, added, changed}` entries `{ section, name }`. */
export function diffSurface(prev, next) {
  const out = { removed: [], added: [], changed: [] };
  for (const [key, label] of Object.entries(LIST_SECTIONS)) diffLists(label, prev[key], next[key], out);
  for (const [key, label] of Object.entries(MAP_SECTIONS)) diffMaps(label, prev[key], next[key], out);
  return out;
}

const parseVersion = (v) => {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v));
  if (!m) throw new Error(`invalid host API version: ${v}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
};

/** `"none" | "patch" | "minor" | "major" | "down"` between two versions. */
export function bumpKind(prevVersion, nextVersion) {
  const a = parseVersion(prevVersion);
  const b = parseVersion(nextVersion);
  for (let i = 0; i < 3; i++) {
    if (b[i] === a[i]) continue;
    if (b[i] < a[i]) return "down";
    return ["major", "minor", "patch"][i];
  }
  return "none";
}

/** Bump-rule violations of `next` relative to `prev` (a committed baseline). Empty = ok. */
export function checkBump(prev, next) {
  const kind = bumpKind(prev.version, next.version);
  if (kind === "down") return [`host API version went backwards: ${prev.version} → ${next.version}`];
  const { removed, added, changed } = diffSurface(prev, next);
  const lines = [];
  if (kind !== "major") {
    for (const r of removed) lines.push(`REMOVED ${r.section} "${r.name}" needs a major bump (${prev.version} → ${next.version} is ${kind})`);
  }
  if (kind !== "major" && kind !== "minor") {
    for (const a of added) lines.push(`ADDED ${a.section} "${a.name}" needs at least a minor bump (${prev.version} → ${next.version} is ${kind})`);
    for (const c of changed) lines.push(`CHANGED ${c.section} "${c.name}" shape needs at least a minor bump (${prev.version} → ${next.version} is ${kind})`);
  }
  return lines;
}

// ── CLI ───────────────────────────────────────────────────────────────────

function readSnapshot(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function baseSnapshot(ref, root) {
  try {
    const out = execFileSync("git", ["show", `${ref}:${SNAPSHOT_REL}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return JSON.parse(out);
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const opts = { root: ROOT, write: false, base: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--write") opts.write = true;
    else if (a === "--check") opts.write = false;
    else if (a === "--base") opts.base = argv[++i];
    else if (a === "--root") opts.root = path.resolve(argv[++i]);
    else throw new Error(`unknown argument: ${a}`);
  }
  return opts;
}

/** Violation lines for a snapshot file vs the freshly computed surface (and vs `base`, when given). */
function checkSnapshot(opts, snapshotFile, surface) {
  if (!fs.existsSync(snapshotFile)) return [`${SNAPSHOT_REL} is missing — run \`node scripts/host-api-surface.mjs --write\``];
  const snap = readSnapshot(snapshotFile);
  const lines = [];
  if (JSON.stringify(snap) !== JSON.stringify(surface)) {
    const { removed, added, changed } = diffSurface(snap, surface);
    lines.push(
      `snapshot is stale vs source (${removed.length} removed, ${added.length} added, ${changed.length} changed) — bump PLUGIN_HOST_API_VERSION if needed, then run \`node scripts/host-api-surface.mjs --write\``,
    );
    for (const x of removed.slice(0, 10)) lines.push(`  - removed ${x.section} "${x.name}"`);
    for (const x of added.slice(0, 10)) lines.push(`  + added ${x.section} "${x.name}"`);
    for (const x of changed.slice(0, 10)) lines.push(`  ~ changed ${x.section} "${x.name}"`);
  }
  const base = opts.base ? baseSnapshot(opts.base, opts.root) : null;
  if (base) lines.push(...checkBump(base, snap));
  return lines;
}

function main(argv) {
  const opts = parseArgs(argv);
  const snapshotFile = path.join(opts.root, SNAPSHOT_REL);
  const surface = computeSurface(opts.root);
  if (opts.write) {
    fs.writeFileSync(snapshotFile, `${JSON.stringify(surface, null, 2)}\n`);
    console.log(`host-api-surface: wrote ${SNAPSHOT_REL} (host API ${surface.version})`);
    return 0;
  }
  const lines = checkSnapshot(opts, snapshotFile, surface);
  if (lines.length === 0) {
    console.log(`host-api-surface: OK — host API ${surface.version}, ${surface.publicExports.length} public + ${surface.sdkExports.length} sdk exports`);
    return 0;
  }
  console.error(lines.join("\n"));
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(`host-api-surface: ${err.message}`);
    process.exitCode = 2;
  }
}
