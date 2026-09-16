/**
 * Tool codegen (change: expand-mcp-tiered-surface, D5).
 *
 * Reads the reviewed `tools.manifest.ts` and emits `src/server/generated/tools.ts`
 * (JSON Schema + binder metadata + param split per row) and the README
 * catalogue block. Run: `pnpm --filter <plugin> codegen`.
 *
 * Schema source of truth is the TypeScript type named by each row's `input`
 * (an exported type in `packages/shared`), resolved with the TypeScript compiler
 * API — the same mechanism `bus-client/src/codegen/generate-verbs.ts` uses for
 * the verb union. The freshness test regenerates in memory and asserts the
 * checked-in file is identical, so a changed request type fails the build until
 * the artefacts are regenerated.
 *
 * Path parameters are derived from the route pattern, and `:id` is renamed to
 * `sessionId` so every session-targeting tool shares one argument name (D4).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { MANIFEST, type ToolRow } from "../src/server/tools.manifest.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(PKG_ROOT, "..", "..");
const SHARED_ENTRY = path.join(REPO_ROOT, "packages/shared/src/rest-api.ts");
const OUT_FILE = path.join(PKG_ROOT, "src/server/generated/tools.ts");
const README_FILE = path.join(PKG_ROOT, "README.md");

/** JSON Schema subset we emit. */
export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  enum?: string[];
  description?: string;
  [k: string]: unknown;
}

export interface ParamSplit {
  /** Path parameters: tool argument name → route `:param` name. */
  path: Array<{ arg: string; param: string }>;
  /** Explicit query argument names (GET rows with a typed input). */
  query?: string[];
  /** Every non-path argument is a query parameter (permissive input). */
  queryAll?: boolean;
  /** Explicit body argument names (non-GET typed rows). */
  body?: string[];
  /** Every non-path argument is a body field (permissive input + session rows). */
  bodyAll?: boolean;
}

export interface GeneratedTool {
  name: string;
  description: string;
  tier: string;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean };
  inputSchema: JsonSchema;
  bind: ToolRow["bind"];
  paramSplit: ParamSplit;
  sessionTargeting: boolean;
}

const PATH_ARG_RE = /:([A-Za-z0-9_]+)/g;

/** Route `:param` → tool argument name (`:id` becomes `sessionId`, D4). */
export function argNameFor(param: string): string {
  return param === "id" ? "sessionId" : param;
}

/** Path parameters declared by a route pattern, in order. */
export function pathParams(routePath: string): Array<{ arg: string; param: string }> {
  const out: Array<{ arg: string; param: string }> = [];
  for (const m of routePath.matchAll(PATH_ARG_RE)) out.push({ arg: argNameFor(m[1]), param: m[1] });
  return out;
}

/** A `:param` in the path or a `sessionId` argument marks a session-targeting row. */
export function isSessionTargeting(row: ToolRow): boolean {
  if (row.sessionTargeting) return true;
  if (row.bind.kind === "rest" && /:(id|sessionId)\b/.test(row.bind.path)) return true;
  return false;
}

// ── JSON Schema from a TypeScript type ─────────────────────────────────────

function tjs(tsType: ts.Type, checker: ts.TypeChecker): JsonSchema {
  const flags = tsType.flags;
  // A union of string literals is an enum (e.g. `status?: SessionStatus[]`).
  if (tsType.isUnion()) {
    const literals: string[] = [];
    let allStringLiterals = true;
    for (const member of tsType.types) {
      if (member.isStringLiteral()) literals.push(member.value);
      else if (member.flags & ts.TypeFlags.Undefined) continue;
      else {
        allStringLiterals = false;
        break;
      }
    }
    if (allStringLiterals && literals.length > 0) return { type: "string", enum: literals };
  }
  if (flags & ts.TypeFlags.StringLike) {
    if (tsType.isStringLiteral()) return { type: "string", enum: [tsType.value] };
    return { type: "string" };
  }
  if (flags & ts.TypeFlags.NumberLike) return { type: "number" };
  if (flags & ts.TypeFlags.BooleanLike) return { type: "boolean" };

  if (checker.isArrayType?.(tsType) || checker.isTupleType?.(tsType)) {
    const elem = checker.getTypeArguments(tsType as ts.TypeReference)[0];
    return { type: "array", items: elem ? tjs(elem, checker) : {} };
  }

  // Record<string, unknown> — an object type with a string index signature.
  const stringIndex = checker.getIndexTypeOfType(tsType, ts.IndexKind.String);
  if (stringIndex) {
    return { type: "object", additionalProperties: true };
  }

  if (flags & ts.TypeFlags.Object) {
    const props = checker.getPropertiesOfType(tsType);
    if (props.length === 0) {
      return { type: "object", properties: {}, required: [], additionalProperties: false };
    }
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const prop of props) {
      const declaration = prop.valueDeclaration ?? prop.declarations?.[0];
      const rawPropType = checker.getTypeOfSymbolAtLocation(prop, declaration ?? declaration!);
      // Optional props are `T | undefined`; strip it so `limit?: number` maps to
      // `{type:"number"}`, not `{}`.
      const schema = tjs(checker.getNonNullableType(rawPropType), checker);
      // JSDoc `@minimum`/`@maximum`/`@integer` carry bounds a plain TS type
      // cannot express (e.g. the list_sessions page sizes).
      if (declaration) {
        for (const tag of ts.getJSDocTags(declaration)) {
          const name = tag.tagName.text;
          const text = typeof tag.comment === "string" ? tag.comment.trim() : "";
          if (name === "minimum" || name === "maximum") {
            const n = Number(text);
            if (Number.isFinite(n)) schema[name] = n;
          } else if (name === "integer") {
            schema.type = "integer";
          }
        }
      }
      properties[prop.name] = schema;
      const optional = (prop.flags & ts.SymbolFlags.Optional) !== 0;
      if (!optional) required.push(prop.name);
    }
    return { type: "object", properties, required, additionalProperties: false };
  }

  // Fallback: an intentionally-unspecified type.
  return {};
}

function loadSharedProgram(): { checker: ts.TypeChecker; source: ts.SourceFile } {
  const program = ts.createProgram([SHARED_ENTRY], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(SHARED_ENTRY);
  if (!source) throw new Error(`cannot load ${SHARED_ENTRY}`);
  return { checker, source };
}

/** Resolve the exported type `name` from the shared program, or null. */
function resolveType(
  name: string,
  checker: ts.TypeChecker,
  source: ts.SourceFile,
): ts.Type | null {
  let found: ts.Type | undefined;
  const moduleSymbol = checker.getSymbolAtLocation(source);
  const exports = moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : [];
  for (const sym of exports) {
    if (sym.name !== name) continue;
    const target = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
    found = checker.getDeclaredTypeOfSymbol(target);
  }
  return found ?? null;
}

/** Input schema for a row: the named shared type + the route's path params. */
function schemaForRow(
  row: ToolRow,
  checker: ts.TypeChecker,
  source: ts.SourceFile,
): JsonSchema {
  let base: JsonSchema;
  if (row.input === "ToolJsonBody") {
    base = { type: "object", additionalProperties: true };
  } else if (row.input === "ToolEmptyInput") {
    base = { type: "object", properties: {}, required: [], additionalProperties: false };
  } else {
    const t = resolveType(row.input, checker, source);
    if (!t) throw new Error(`manifest row ${row.name}: unknown input type ${row.input}`);
    base = tjs(t, checker);
  }

  if (row.bind.kind !== "rest") return base;
  const params = pathParams(row.bind.path);
  if (params.length === 0) return base;
  const properties = { ...(base.properties ?? {}) };
  const required = new Set(base.required ?? []);
  for (const { arg } of params) {
    properties[arg] = { type: "string", description: `Path parameter \`${arg}\`.` };
    required.add(arg);
  }
  const schema: JsonSchema = {
    type: "object",
    properties,
    required: [...required],
    additionalProperties: base.additionalProperties === true,
  };
  return schema;
}

/** Split a row's arguments into path / query / body for the runtime binder. */
function paramSplitFor(row: ToolRow, schema: JsonSchema): ParamSplit {
  if (row.bind.kind === "session") {
    return { path: [], bodyAll: true };
  }
  if (row.bind.kind === "context") {
    return { path: [], bodyAll: true };
  }
  const path = pathParams(row.bind.path);
  const pathArgs = new Set(path.map((p) => p.arg));
  if (row.input === "ToolJsonBody") {
    return row.bind.method === "GET"
      ? { path, queryAll: true }
      : { path, bodyAll: true };
  }
  const names = Object.keys(schema.properties ?? {}).filter((n) => !pathArgs.has(n));
  return row.bind.method === "GET" ? { path, query: names } : { path, body: names };
}

/** Effective tier: declared for context/session; max(route, declared) for rest. */
function tierFor(row: ToolRow, routeTier: (m: string, p: string) => string): string {
  if (row.bind.kind === "rest") {
    const route = routeTier(row.bind.method, row.bind.path);
    if (!row.tier) return route;
    return row.tier; // invariants test asserts declared >= route
  }
  if (!row.tier) {
    throw new Error(`manifest row ${row.name}: context/session rows must declare a tier`);
  }
  return row.tier;
}

export interface BuildResult {
  tools: GeneratedTool[];
  content: string;
}

/** Build the generated tool list + the emitted file content (pure). */
export function build(
  routeTier: (m: string, p: string) => string,
): BuildResult {
  const { checker, source } = loadSharedProgram();
  const tools: GeneratedTool[] = [];
  for (const row of MANIFEST) {
    const inputSchema = schemaForRow(row, checker, source);
    tools.push({
      name: row.name,
      description: row.description,
      tier: tierFor(row, routeTier),
      annotations: row.annotations,
      inputSchema,
      bind: row.bind,
      paramSplit: paramSplitFor(row, inputSchema),
      sessionTargeting: isSessionTargeting(row),
    });
  }
  return { tools, content: render(tools) };
}

function render(tools: readonly GeneratedTool[]): string {
  const body = tools
    .map((t) => `  ${JSON.stringify(t)},`)
    .join("\n");
  return `/**
 * GENERATED by src/codegen/generate-tools.ts — DO NOT EDIT.
 *
 * One entry per manifest row: JSON Schema (from the row's shared \`input\` type),
 * effective tier, MCP annotations, transport binding and param split. The
 * freshness test regenerates this in memory and asserts equality.
 *
 * See OpenSpec change: expand-mcp-tiered-surface (D3/D5).
 */
import type { Tier } from "@blackbelt-technology/pi-dashboard-shared/tiers.js";
import type { ToolRow } from "../tools.manifest.js";

export interface ParamSplit {
  path: Array<{ arg: string; param: string }>;
  query?: string[];
  queryAll?: boolean;
  body?: string[];
  bodyAll?: boolean;
}

export interface GeneratedTool {
  name: string;
  description: string;
  tier: Tier;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean };
  inputSchema: {
    type?: string;
    properties?: Record<string, { type?: string; description?: string; [k: string]: unknown }>;
    required?: string[];
    additionalProperties?: boolean;
    [k: string]: unknown;
  };
  bind: ToolRow["bind"];
  paramSplit: ParamSplit;
  sessionTargeting: boolean;
}

export const GENERATED_TOOLS: readonly GeneratedTool[] = [
${body}
];
`;
}

function renderReadmeBlock(tools: readonly GeneratedTool[]): string {
  const lines = tools
    .map((t) => `| \`${t.name}\` | ${t.tier} | ${t.description} |`)
    .join("\n");
  return [
    "<!-- tools:start -->",
    "",
    "| Tool | Tier | Description |",
    "| --- | --- | --- |",
    lines,
    "",
    "<!-- tools:end -->",
  ].join("\n");
}

/** Regenerate the README catalogue block in place. */
function writeReadme(tools: readonly GeneratedTool[]): void {
  const current = fs.readFileSync(README_FILE, "utf8");
  const block = renderReadmeBlock(tools);
  const start = current.indexOf("<!-- tools:start -->");
  const end = current.indexOf("<!-- tools:end -->");
  if (start === -1 || end === -1) {
    throw new Error("README.md is missing the <!-- tools:start/end --> block");
  }
  const next = current.slice(0, start) + block + current.slice(end + "<!-- tools:end -->".length);
  fs.writeFileSync(README_FILE, next, "utf8");
}

/** The README block content for a tool list (exported for the freshness test). */
export function readmeBlockFor(tools: readonly GeneratedTool[]): string {
  return renderReadmeBlock(tools);
}

async function main(): Promise<void> {
  const { routeTier } = await import("@blackbelt-technology/pi-dashboard-shared/route-tiers.js");
  const { tools, content } = build(routeTier);
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, content, "utf8");
  writeReadme(tools);
  console.log(`Generated ${tools.length} tools → ${path.relative(REPO_ROOT, OUT_FILE)}`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
