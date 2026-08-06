#!/usr/bin/env node
/**
 * Publish-correctness checker.
 *
 * Asserts that every module specifier appearing in a workspace's **packed** files
 * is declared in that workspace's own `package.json`.
 *
 * Why this exists, given Biome already has `noUndeclaredDependencies`:
 *
 *   Biome asks  "is this import declared anywhere?"
 *   This asks   "will this import resolve for someone who installed the tarball?"
 *
 * Two differences make the second question strictly stronger:
 *
 *   1. `devDependencies` satisfy Biome. They do NOT satisfy a consumer — npm
 *      does not install a package's devDependencies. A shipped file importing a
 *      devDependency is a consumer-visible break Biome cannot see.
 *   2. The monorepo hoists everything, so every import resolves locally
 *      regardless of what the manifests say. The defect is invisible until
 *      someone installs the published tarball.
 *
 * The shipped file set comes from `npm pack --dry-run`, not a glob, so the
 * `files` array and `.npmignore` semantics are honoured exactly as the registry
 * would apply them.
 *
 * BOUNDED GUARANTEE — read this before trusting a green run:
 *   This proves *declaration*, not *installability*. It verifies every shipped
 *   import is declared with a concrete range; it does NOT verify the range
 *   resolves on the registry. A declared `^99.0.0` passes. Full resolvability
 *   would need a registry round-trip against published versions, which reports
 *   on already-released code rather than the change under test, and false-fails
 *   on optional peers that are absent by design.
 *
 * Exit code: non-zero iff at least one error. Warnings never fail the run.
 *
 * See change: cleanup-undeclared-dependencies.
 */
import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import semver from "semver";
import ts from "typescript";

const execFileAsync = promisify(execFile);

export const REPO_ROOT = resolve(import.meta.dirname, "..");

/** Fields whose entries are installed for a consumer. `devDependencies` is absent by design. */
export const RUNTIME_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"];

/** Extensions we parse for module specifiers. Everything else in a tarball is inert. */
const SOURCE_EXT = /\.(?:[cm]?[jt]sx?)$/;

/** Candidate suffixes when resolving a relative specifier against the packed file list. */
const RESOLVE_SUFFIXES = ["", ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".mts", ".cts", ".d.ts"];

const BUILTINS = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

/**
 * Specifiers deliberately left undeclared. Every entry carries a reason; an
 * entry without one fails the run, so exceptions cannot accumulate silently.
 */
export const ALLOWLIST = [
  {
    workspace: "packages/flows-anthropic-bridge-plugin",
    specifier: "@pi/anthropic-messages",
    reason:
      "Returns E404 on the npm registry. Legacy pre-rescope name reached only through a guarded dynamic-import fallback; declaring it would write an unresolvable dependency into a published manifest.",
  },
];

const finding = (severity, rule, workspace, file, specifier, message) => ({
  severity,
  rule,
  workspace,
  file,
  specifier,
  message,
});

/* ------------------------------------------------------------------ *
 * Range selection
 * ------------------------------------------------------------------ */

/**
 * Choose the range to declare for `dep`, given the ranges already declared
 * elsewhere in the repo and the version that actually resolves.
 *
 * The rule, made executable so it is enforceable rather than prose:
 *
 *   1. Reuse an existing range ONLY if the resolving version satisfies it. An
 *      unsatisfiable range is a latent bug; propagating it multiplies the bug.
 *   2. Among existing ranges the resolving version DOES satisfy, take the one
 *      with the highest lower bound. Semver ranges are not totally ordered, so
 *      "narrowest" is defined concretely as greatest-minimum.
 *   3. If none qualify, fall back to a caret on the resolving version.
 *
 * Worked example from the spec: `wouter` siblings `>=3.0.0`, `^3.0.0`, `^3.9.0`
 * with `3.10.0` resolving -> `^3.9.0`.
 */
export function selectRange(existingRanges, resolvingVersion) {
  const satisfied = (existingRanges ?? []).filter(
    (r) => typeof r === "string" && r !== "*" && semver.validRange(r) && semver.satisfies(resolvingVersion, r),
  );
  if (satisfied.length === 0) return `^${resolvingVersion}`;
  return satisfied.reduce((best, r) => {
    const a = semver.minVersion(r);
    const b = semver.minVersion(best);
    return a && b && semver.gt(a, b) ? r : best;
  });
}

/**
 * Range for a **host-provided optional peer** replacing a `"*"`.
 *
 * Deliberately NOT `selectRange`'s caret. A caret on a 0.x version pins the
 * minor (`^0.75.5` admits only `>=0.75.5 <0.76.0`), so it would reject the very
 * hosts the `"*"` accepted and break already-published consumers. The
 * requirement is concreteness, not tightening — a lower bound satisfies it while
 * preserving compatibility.
 */
export function selectHostPeerRange(resolvingVersion) {
  return `>=${resolvingVersion}`;
}

/** Is `range` satisfied by the version that actually resolves? */
export function rangeIsSatisfiable(range, resolvingVersion) {
  if (typeof range !== "string" || range === "*" || !semver.validRange(range)) return false;
  return semver.satisfies(resolvingVersion, range);
}

/* ------------------------------------------------------------------ *
 * Specifier normalisation
 * ------------------------------------------------------------------ */

export function isBuiltin(spec) {
  return BUILTINS.has(spec);
}

export function isRelative(spec) {
  return spec.startsWith("./") || spec.startsWith("../") || spec === "." || spec === "..";
}

/**
 * Reduce a module specifier to the package name npm would install.
 *
 *   fastify                          -> fastify
 *   @mdi/react                       -> @mdi/react          (first TWO segments)
 *   dagre-d3-es/src/dagre/index.js   -> dagre-d3-es         (subpath stripped)
 *   @scope/pkg/sub/path.js           -> @scope/pkg
 *
 * Returns null for relative specifiers and absolute/protocol URLs, which are
 * never package names.
 */
export function packageNameOf(spec) {
  if (!spec || isRelative(spec)) return null;
  if (spec.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(spec)) {
    return spec.startsWith("node:") ? spec : null;
  }
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/* ------------------------------------------------------------------ *
 * Static extraction
 * ------------------------------------------------------------------ */

/**
 * Extract every module specifier from one source file.
 *
 * Returns `{ specifiers, parseError }`. A syntax error yields a `parseError`
 * rather than an empty specifier list, so an unparseable file is never mistaken
 * for a clean one — a vacuous pass is the failure mode this check exists to
 * prevent.
 */
export function extractSpecifiers(text, fileName) {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);

  // `parseDiagnostics` is where the parser records true syntax errors. It is
  // internal-ish but stable, and it is the only way to distinguish "no imports"
  // from "could not read this file".
  const diags = source.parseDiagnostics ?? [];
  if (diags.length > 0) {
    const d = diags[0];
    const msg = ts.flattenDiagnosticMessageText(d.messageText, " ");
    const { line } = source.getLineAndCharacterOfPosition(d.start ?? 0);
    return { specifiers: [], parseError: `${msg} (line ${line + 1})` };
  }

  const specifiers = [];
  const add = (node) => {
    if (node && ts.isStringLiteralLike(node)) {
      specifiers.push({
        value: node.text,
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      });
    }
  };

  const visit = (node) => {
    // import x from "y"  /  export * from "y"
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      add(node.moduleSpecifier);
    }
    // import x = require("y")
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node.moduleReference.expression);
    } else if (ts.isCallExpression(node)) {
      // import("y")
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) add(node.arguments[0]);
      // require("y")
      else if (ts.isIdentifier(node.expression) && node.expression.text === "require") add(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return { specifiers, parseError: null };
}

/* ------------------------------------------------------------------ *
 * Workspace discovery + packing
 * ------------------------------------------------------------------ */

/** Every workspace under `packages/` that does not declare `"private": true`. */
export function listWorkspaces(root = REPO_ROOT) {
  const base = join(root, "packages");
  if (!existsSync(base)) return [];
  const out = [];
  for (const name of readdirSync(base).sort()) {
    const dir = join(base, name);
    const manifestPath = join(dir, "package.json");
    if (!statSync(dir).isDirectory() || !existsSync(manifestPath)) continue;
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch {
      continue;
    }
    if (manifest.private === true) continue;
    out.push({ dir, rel: relative(root, dir), name: manifest.name ?? name, manifest });
  }
  return out;
}

/**
 * Pull the JSON payload out of `npm pack` stdout.
 *
 * A workspace with a `prepack`/`prepare` script (as `packages/client` has) emits
 * build output on the same stream, so `JSON.parse(stdout)` fails on otherwise
 * healthy packages. The payload is always last, so parse from the rightmost
 * plausible start. Returning null — never a guess — keeps a pack we could not
 * read reportable as an error instead of an empty, silently-passing file set.
 */
export function parsePackOutput(stdout) {
  for (let i = stdout.length - 1; i >= 0; i--) {
    const c = stdout[i];
    if (c !== "[" && c !== "{") continue;
    try {
      const parsed = JSON.parse(stdout.slice(i));
      if (parsed && (Array.isArray(parsed) ? parsed.length > 0 : typeof parsed === "object")) return parsed;
    } catch {
      // not the payload start; keep scanning left
    }
  }
  return null;
}

/**
 * Derive the packed file list via `npm pack --dry-run --json`.
 *
 * A non-zero exit is reported as an error rather than an empty file set: a
 * workspace whose pack fails must fail the run, not silently contribute zero
 * findings.
 */
export async function packWorkspace(dir) {
  try {
    // Bounded: a workspace's `prepack`/`prepare` lifecycle script runs here, and
    // one that hangs would stall `analyzeRepository` forever and blow the CI
    // budget with no diagnostic. A timeout surfaces as a `pack-failed` finding.
    const { stdout } = await execFileAsync("npm", ["pack", "--dry-run", "--json"], {
      cwd: dir,
      maxBuffer: 64 * 1024 * 1024,
      timeout: 120_000,
    });
    const parsed = parsePackOutput(stdout);
    if (parsed === null) return { files: [], error: "could not locate JSON payload in `npm pack --json` output" };
    const entry = Array.isArray(parsed) ? parsed[0] : parsed;
    return { files: (entry?.files ?? []).map((f) => f.path), error: null };
  } catch (err) {
    return { files: [], error: (err.stderr || err.message || String(err)).trim().split("\n").slice(-4).join(" ") };
  }
}

/* ------------------------------------------------------------------ *
 * Analysis
 * ------------------------------------------------------------------ */

/** An allowlist entry is usable only when it names a workspace, a specifier, and a reason. */
export function validateAllowlist(allowlist = ALLOWLIST) {
  const findings = [];
  for (const [i, e] of allowlist.entries()) {
    const label = `${e?.workspace ?? "?"} :: ${e?.specifier ?? "?"}`;
    if (!e?.workspace || !e?.specifier) {
      findings.push(
        finding("error", "allowlist-malformed", e?.workspace ?? "-", "<allowlist>", e?.specifier ?? "-",
          `allowlist entry #${i} is missing a workspace or specifier`),
      );
      continue;
    }
    if (typeof e.reason !== "string" || e.reason.trim() === "") {
      findings.push(
        finding("error", "allowlist-missing-reason", e.workspace, "<allowlist>", e.specifier,
          `allowlist entry ${label} has no reason string; exceptions must be justified in place`),
      );
    }
  }
  return findings;
}

/** Does a relative specifier land on a file that is actually in the tarball? */
function relativeResolves(spec, fromFile, packedSet) {
  const target = join(dirname(fromFile), spec).split("\\").join("/");
  const bases = [target, `${target}/index`];
  // A TS-ESM source ships as `.ts` but imports `./foo.js`; accept the source form too.
  const stripped = target.replace(/\.[cm]?js$/, "");
  if (stripped !== target) bases.push(stripped, `${stripped}/index`);
  for (const b of bases) for (const s of RESOLVE_SUFFIXES) if (packedSet.has(b + s)) return true;
  return false;
}

/** Analyse one already-packed workspace. Pure: no I/O beyond reading shipped files. */
export function analyzeWorkspace(ws, packedFiles, { allowlist = ALLOWLIST } = {}) {
  const findings = [];
  const packedSet = new Set(packedFiles);
  const m = ws.manifest;
  const declared = new Set(RUNTIME_FIELDS.flatMap((f) => Object.keys(m[f] ?? {})));
  const devOnly = new Set(Object.keys(m.devDependencies ?? {}).filter((d) => !declared.has(d)));
  const allowed = new Set(
    allowlist.filter((e) => e.workspace === ws.rel || e.workspace === ws.name).map((e) => e.specifier),
  );

  for (const rel of packedFiles) {
    if (!SOURCE_EXT.test(rel)) continue;
    const abs = join(ws.dir, rel);
    if (!existsSync(abs)) continue; // pack lists it, working tree lacks it — build artefact
    const { specifiers, parseError } = extractSpecifiers(readFileSync(abs, "utf8"), abs);

    if (parseError) {
      findings.push(
        finding("error", "unparseable-source", ws.rel, rel, null,
          `shipped file could not be parsed, so its imports are unknown: ${parseError}`),
      );
      continue;
    }

    for (const { value, line } of specifiers) {
      const where = `${rel}:${line}`;
      if (allowed.has(value)) continue;

      if (isRelative(value)) {
        if (!relativeResolves(value, rel, packedSet)) {
          findings.push(
            finding("error", "dangling-relative-import", ws.rel, where, value,
              `relative import "${value}" has no target in the packed file set; it will fail for a consumer`),
          );
        }
        continue;
      }

      const pkg = packageNameOf(value);
      if (pkg === null || isBuiltin(pkg) || isBuiltin(value)) continue;
      if (allowed.has(pkg)) continue;
      if (declared.has(pkg)) continue;

      if (devOnly.has(pkg)) {
        findings.push(
          finding("error", "dev-only-import", ws.rel, where, pkg,
            `"${pkg}" is declared only in devDependencies, which npm does not install for a consumer; a shipped file may not import it`),
        );
      } else {
        findings.push(
          finding("error", "undeclared-import", ws.rel, where, pkg,
            `"${pkg}" is imported by a shipped file but declared in none of ${RUNTIME_FIELDS.join(", ")}`),
        );
      }
    }
  }
  return findings;
}

/**
 * Report declared dependencies that are absent from `node_modules`.
 *
 * Warning, never an error: this check's stated guarantee is declaration, not
 * installability, and an optional peer is routinely absent by design. The point
 * is that the range is *visibly unverifiable* rather than silently assumed good.
 */
export function verifyDeclaredRanges(ws, root = REPO_ROOT) {
  const findings = [];
  for (const field of RUNTIME_FIELDS) {
    for (const [dep, range] of Object.entries(ws.manifest[field] ?? {})) {
      const local = join(ws.dir, "node_modules", dep, "package.json");
      const hoisted = join(root, "node_modules", dep, "package.json");
      if (existsSync(local) || existsSync(hoisted)) continue;
      findings.push(
        finding("warning", "unverifiable-range", ws.rel, "package.json", dep,
          `${field}."${dep}" is declared at "${range}" but absent from node_modules, so the range cannot be verified locally`),
      );
    }
  }
  return findings;
}

/** Run the whole check. `concurrency` bounds parallel `npm pack` calls (CI budget: <60s). */
export async function analyzeRepository(root = REPO_ROOT, { allowlist = ALLOWLIST, concurrency = 8 } = {}) {
  // A non-positive concurrency would spawn zero runners, and the function would
  // return an empty finding list having checked nothing — a vacuous pass, which
  // is the exact failure mode this checker exists to prevent.
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new TypeError(`concurrency must be a positive integer, received ${concurrency}`);
  }
  const workspaces = listWorkspaces(root);
  const findings = [...validateAllowlist(allowlist)];

  const queue = [...workspaces];
  const runner = async () => {
    for (let ws = queue.shift(); ws; ws = queue.shift()) {
      const { files, error } = await packWorkspace(ws.dir);
      if (error) {
        findings.push(
          finding("error", "pack-failed", ws.rel, "package.json", null,
            `npm pack --dry-run failed, so this workspace could not be verified: ${error}`),
        );
        continue;
      }
      findings.push(...analyzeWorkspace(ws, files, { allowlist }));
      findings.push(...verifyDeclaredRanges(ws, root));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length || 1) }, runner));

  findings.sort((a, b) => `${a.workspace}${a.file}${a.specifier}`.localeCompare(`${b.workspace}${b.file}${b.specifier}`));
  return { workspaces, findings };
}

export function formatFinding(f) {
  const tag = f.severity === "error" ? "ERROR" : "warn ";
  return `${tag} [${f.rule}] ${f.workspace}/${f.file}${f.specifier ? ` :: ${f.specifier}` : ""}\n        ${f.message}`;
}

async function main() {
  const { workspaces, findings } = await analyzeRepository();
  for (const f of findings) console.log(formatFinding(f));
  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");
  console.log(
    `\n${workspaces.length} non-private workspace(s) checked · ${errors.length} error(s) · ${warnings.length} warning(s)`,
  );
  process.exit(errors.length > 0 ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) await main();
