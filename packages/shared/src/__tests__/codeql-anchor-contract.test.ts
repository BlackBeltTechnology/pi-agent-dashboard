/**
 * Contract: the CodeQL analysis anchor `scripts/codeql-anchor/plugin-routes.mjs`
 * gives a real `Fastify()` to exactly the plugin registrars measured hidden by
 * `paths-ignore` (spec "Plugin server route modules are analysed through an
 * anchor", test-plan #E19–#E25).
 *
 * Pure static analysis of the anchor source text: the anchor is never imported
 * or executed (registrars are `.ts` with runtime deps). Inertness is by
 * construction — top level holds only imports and exported function
 * declarations, no `listen(`, no top-level `await`.
 *
 * See change: fix-codeql-baseline-coverage.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..", "..");
const ANCHOR_REL = "scripts/codeql-anchor/plugin-routes.mjs";

/** registrar → module (repo-relative). Membership criterion: docs/code-quality.md. */
const ALLOWLIST: Record<string, string> = {
  mountAutomationRoutes: "packages/automation-plugin/src/server/routes.ts",
  mountTeamRoutes: "packages/team-plugin/src/server/routes.ts",
  registerGoalRoutes: "packages/goal-plugin/src/server/routes.ts",
  registerBlackholeRoutes: "packages/blackhole-plugin/src/server/index.ts",
  mountRolesRoutes: "packages/roles-plugin/src/server/roles-routes.ts",
};

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Validate anchor source; returns errors (empty = valid). */
function checkAnchor(source: string, root: string, anchorRel = ANCHOR_REL): string[] {
  const errs: string[] = [];
  const src = stripComments(source);
  const anchorDir = path.dirname(anchorRel);
  // Imports must be single-line: a multi-line import would not match and would
  // then fail the "top-level code outside an exported function" check below.
  const importRe = /^import\s+(?:\{([^}]*)\}|(\w+))\s+from\s+["']([^"']+)["'];?\s*$/gm;
  const imported = new Map<string, string[]>(); // module → names
  for (const m of src.matchAll(importRe)) {
    const spec = m[3];
    if (spec === "fastify") continue;
    if (!spec.startsWith(".")) {
      errs.push(`unexpected import ${spec}`);
      continue;
    }
    const mod = path.posix.normalize(path.posix.join(anchorDir, spec)).replace(/\.js$/, ".ts");
    const names = (m[1] ?? m[2] ?? "")
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean);
    imported.set(mod, names);
  }
  errs.push(...registrarErrors(imported, root));
  errs.push(...topLevelErrors(src.replace(importRe, "")));
  return errs;
}

/** Imported modules == allowlist; each allowlisted module exists and exports its registrar. */
function registrarErrors(imported: Map<string, string[]>, root: string): string[] {
  const errs: string[] = [];
  const allowedMods = new Set(Object.values(ALLOWLIST));
  for (const mod of imported.keys()) if (!allowedMods.has(mod)) errs.push(`module ${mod} is outside the allowlist`);
  for (const [registrar, mod] of Object.entries(ALLOWLIST)) {
    if (!imported.get(mod)?.includes(registrar)) errs.push(`anchor does not import ${registrar} from ${mod}`);
    const abs = path.join(root, mod);
    if (!fs.existsSync(abs)) {
      errs.push(`allowlisted module ${mod} (${registrar}) does not exist`);
      continue;
    }
    const text = fs.readFileSync(abs, "utf8");
    if (!new RegExp(`export (async )?function ${registrar}\\b`).test(text)) {
      errs.push(`module ${mod} no longer exports ${registrar}`);
    }
  }
  return errs;
}

/** Inert by construction: only imports and exported functions at top level, no `listen(`. */
function topLevelErrors(withoutImports: string): string[] {
  const errs: string[] = [];
  if (/\blisten\s*\(/.test(withoutImports)) errs.push("anchor calls listen(");
  // Top level: only imports and exported function declarations.
  let top = withoutImports;
  const fnRe = /^(export\s+)?(async\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{/m;
  let exported = 0;
  for (let m = fnRe.exec(top); m; m = fnRe.exec(top)) {
    if (!m[1]) errs.push(`function ${m[3]} is not exported`);
    else exported++;
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < top.length; i++) {
      if (top[i] === "{") depth++;
      else if (top[i] === "}" && --depth === 0) break;
    }
    top = top.slice(0, m.index) + top.slice(i + 1);
  }
  if (exported === 0) errs.push("anchor has no exported function");
  if (top.trim()) errs.push(`top-level code outside an exported function: ${top.trim().slice(0, 60)}`);
  return errs;
}

// Minimal `paths-ignore` glob matcher (double-star, double-star-slash, single star).
// Double-star forms become placeholder tokens BEFORE single `*` is expanded.
function globMatches(glob: string, rel: string): boolean {
  const src = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "\u0000")
    .replace(/\*\*/g, "\u0001")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, "(?:.*/)?")
    .replace(/\u0001/g, ".*");
  return new RegExp(`^${src}$`).test(rel);
}

const imp = (name: string, mod: string) => `import { ${name} } from "../../${mod}";`;
const allImports = Object.entries(ALLOWLIST).map(([n, m]) => imp(n, m));
const body = (calls: string[]) =>
  `export async function anchor() {\n  const f = Fastify();\n${calls.map((c) => `  ${c}`).join("\n")}\n}\n`;
const allCalls = Object.keys(ALLOWLIST).map((n) => `${n}(f, {});`);
const fixture = (imports: string[], rest = body(allCalls)) =>
  `import Fastify from "fastify";\n${imports.join("\n")}\n${rest}`;

describe("codeql anchor contract", () => {
  it("#E19 real anchor imports exactly the allowlisted registrars, no listen(", () => {
    const abs = path.join(repoRoot, ANCHOR_REL);
    expect(fs.existsSync(abs), ANCHOR_REL).toBe(true);
    expect(checkAnchor(fs.readFileSync(abs, "utf8"), repoRoot)).toEqual([]);
    expect(Object.keys(ALLOWLIST).sort()).toEqual(
      ["mountAutomationRoutes", "mountRolesRoutes", "mountTeamRoutes", "registerBlackholeRoutes", "registerGoalRoutes"].sort(),
    );
  });

  it("well-formed fixture passes", () => {
    expect(checkAnchor(fixture(allImports), repoRoot)).toEqual([]);
  });

  it("#E20 a missing registrar fails naming its module", () => {
    const errs = checkAnchor(fixture(allImports.slice(1)), repoRoot).join("\n");
    expect(errs).toContain(ALLOWLIST.mountAutomationRoutes);
  });

  it("#E21 an extra import outside the allowlist fails naming it", () => {
    const extra = 'import { x } from "../../packages/team-plugin/src/server/store.ts";';
    expect(checkAnchor(fixture([...allImports, extra]), repoRoot).join("\n")).toContain(
      "packages/team-plugin/src/server/store.ts",
    );
    // A multi-line extra import is not parsed as an import, and fails closed.
    const multi = 'import {\n  x,\n} from "../../packages/team-plugin/src/server/store.ts";';
    expect(checkAnchor(fixture([...allImports, multi]), repoRoot)).not.toEqual([]);
  });

  it("#E22 missing module or renamed export fails naming module and registrar", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "anchor-"));
    for (const [n, m] of Object.entries(ALLOWLIST)) {
      if (n === "mountRolesRoutes") continue; // absent module
      fs.mkdirSync(path.join(root, path.dirname(m)), { recursive: true });
      const exportName = n === "mountTeamRoutes" ? "mountTeamRoutesRenamed" : n;
      fs.writeFileSync(path.join(root, m), `export function ${exportName}() {}\n`);
    }
    const errs = checkAnchor(fixture(allImports), root).join("\n");
    expect(errs).toContain(`${ALLOWLIST.mountRolesRoutes} (mountRolesRoutes)`);
    expect(errs).toContain(`${ALLOWLIST.mountTeamRoutes} no longer exports mountTeamRoutes`);
  });

  it("#E23 inert by construction", () => {
    const fn = body(allCalls);
    expect(checkAnchor(fixture(allImports, `${fn}registerGoalRoutes(Fastify(), {});\n`), repoRoot)).not.toEqual([]);
    expect(
      checkAnchor(fixture(allImports, fn.replace("const f = Fastify();", "const f = Fastify(); f.listen({});")), repoRoot),
    ).not.toEqual([]);
    expect(checkAnchor(fixture(allImports, fn.replace("export ", "")), repoRoot)).not.toEqual([]);
    expect(checkAnchor(fixture(allImports, `${fn}await Promise.resolve();\n`), repoRoot)).not.toEqual([]);
    expect(checkAnchor(fixture(allImports, fn), repoRoot)).toEqual([]);
  });

  it("#E24 paths-ignore keeps test code out and the anchor in", () => {
    const cfg = parseYaml(fs.readFileSync(path.join(repoRoot, ".github", "codeql", "codeql-config.yml"), "utf8")) as {
      "paths-ignore": string[];
    };
    const ignore = cfg["paths-ignore"];
    for (const g of ["**/__tests__/**", "**/*.test.ts", "**/*.test.tsx", "**/*.test.mjs", "**/*.spec.ts"]) {
      expect(ignore, g).toContain(g);
    }
    for (const g of ignore) expect(globMatches(g, ANCHOR_REL), `${g} must not ignore the anchor`).toBe(false);
    // The matcher itself recognises a glob that WOULD ignore the anchor.
    expect(globMatches("scripts/**", ANCHOR_REL)).toBe(true);
    expect(globMatches("**/codeql-anchor/**", ANCHOR_REL)).toBe(true);
    expect(globMatches("**/__tests__/**", ANCHOR_REL)).toBe(false);
  });

  it("#E25 the anchor is not in the published package files", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as { files?: string[] };
    const hits = (pkg.files ?? []).filter((f) => ANCHOR_REL.startsWith(f.replace(/\*.*$/, "")) || f.includes("codeql-anchor"));
    expect(hits).toEqual([]);
  });
});
