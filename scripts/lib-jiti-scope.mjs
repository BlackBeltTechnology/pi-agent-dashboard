/**
 * Discovery rule + AST detector for the `jiti-cjs-transpile-safety` gate.
 *
 * The property: no first-party TypeScript that jiti evaluates at runtime may
 * transpile to CommonJS retaining `import.meta` in **code position**. jiti wraps
 * CJS output in a `vm` function, where raw `import.meta` is a `SyntaxError`; its
 * only recovery is to re-import the module through a
 * `data:text/javascript;base64,…` specifier, which a Bun single-file executable
 * resolves as a package name and rejects with `NameTooLong` (issue #408).
 *
 * Scope is a DERIVED RULE — "first-party source jiti evaluates at runtime" —
 * not an enumerated workspace list, so a new extension/plugin/workspace is
 * covered with no edit here. Criterion is *evaluated by jiti*, NOT *executed
 * from source*: raw-`.ts` `bin` entries carry `#!/usr/bin/env node` and run
 * under Node's native type-stripping as ESM, so no CJS wrapper exists and the
 * fault class cannot arise — they are out of scope unless a seed reaches them.
 *
 * See change: fix-jiti-cjs-transpile-safety.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as acorn from "acorn";
import { createJiti } from "jiti";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SOURCE_EXT = [".ts", ".tsx", ".mts", ".cts"];

/**
 * Vite-compiled workspaces. `import.meta.env` is legitimate there and Vite, not
 * jiti, compiles it. This IS an enumerated exclusion rather than a derived one:
 * "compiled by Vite" leaves no manifest-level signal to key on. It is a hard
 * exclusion — a workspace listed here stays out even if the walk reaches it
 * (`client-utils` is transitively reachable through
 * `packages/shared/src/dashboard-plugin/ui-primitives.ts`), so adding an entry
 * here narrows the gate and must be justified.
 */
const EXCLUDED_WORKSPACES = new Set(["client", "client-utils", "shell"]);

/** True when some `bin` wrapper of this workspace boots its `main` through jiti. */
function bootstrapsJiti(dir, manifest) {
  const bins =
    typeof manifest.bin === "string" ? [manifest.bin] : Object.values(manifest.bin ?? {});
  return bins.some((b) => {
    try {
      return readFileSync(path.resolve(dir, b), "utf8").includes("jiti");
    } catch {
      return false;
    }
  });
}

const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
};

/** True for build output, tests, and untracked artefacts. */
export function isExcludedPath(rel) {
  const parts = rel.split(path.sep);
  // Build output / untracked artefacts. `packages/electron/out` is gitignored,
  // exists after any local Electron build, and contains `.tsx` that legitimately
  // retains `import.meta` — a naive walk would go red only on dev machines.
  if (parts.some((p) => p === "out" || p === "dist" || p === "node_modules" || p === ".cache")) {
    return true;
  }
  // Test files and __tests__ directories.
  if (parts.some((p) => p === "__tests__" || p === "__fixtures__" || p === "fixtures")) return true;
  const base = parts[parts.length - 1];
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(base)) return true;
  // Vite/browser source.
  if (parts[0] === "packages" && EXCLUDED_WORKSPACES.has(parts[1])) return true;
  if (parts.includes("src") && parts.includes("client") && parts[0] === "packages") return true;
  return false;
}

/** Map every workspace package name → absolute directory. */
export function workspaceIndex(root = repoRoot) {
  const byName = new Map();
  const dirs = [];
  const pkgsDir = path.join(root, "packages");
  if (!existsSync(pkgsDir)) return { byName, dirs };
  for (const d of readdirSync(pkgsDir)) {
    const dir = path.join(pkgsDir, d);
    const manifest = readJson(path.join(dir, "package.json"));
    if (!manifest) continue;
    dirs.push({ dir, name: manifest.name, manifest, slug: d });
    if (manifest.name) byName.set(manifest.name, dir);
  }
  return { byName, dirs };
}

/**
 * Seed set: entry points jiti evaluates. Three seeds, each derived from
 * manifests — see the capability spec for why one seed is not enough.
 */
export function discoverSeeds(root = repoRoot) {
  const { dirs } = workspaceIndex(root);
  const seeds = { piExtensions: [], mainTs: [], pluginEntries: [] };
  const isTs = (v) => typeof v === "string" && SOURCE_EXT.includes(path.extname(v));
  for (const { dir, manifest } of dirs) {
    const rel = (p) => path.relative(root, path.resolve(dir, p));
    // Seed 1 — `pi.extensions` `.ts` entries, loaded by the pi host via jiti.
    for (const e of manifest.pi?.extensions ?? []) {
      if (isTs(e)) seeds.piExtensions.push(rel(e));
    }
    // Seed 2 — a workspace whose `main` is a TypeScript file AND whose `bin`
    // wrapper bootstraps jiti. `packages/server` declares `main: src/cli.ts`
    // and its `bin/pi-dashboard.mjs` re-execs Node with
    // `--import <jiti-url> cli.ts`, so its whole `src/**` is jiti-evaluated.
    // Keying on `bin` alone cannot find the entry (`bin` is the `.mjs`
    // wrapper); keying on `main` alone is too wide — it also matches plain
    // libraries like `packages/bus-client`, which no host re-execs.
    if (isTs(manifest.main) && bootstrapsJiti(dir, manifest)) seeds.mainTs.push(rel(manifest.main));
    // Seed 3 — `pi-dashboard-plugin` `server`/`bridge` entries, loaded at
    // `dashboard-plugin-runtime/src/server/loader.ts` via dynamic `import()`
    // over glob-discovered paths, so no static specifier exists to walk.
    const pd = manifest["pi-dashboard-plugin"];
    for (const key of ["server", "bridge"]) {
      if (isTs(pd?.[key])) seeds.pluginEntries.push(rel(pd[key]));
    }
  }
  return seeds;
}

const RESOLVE_CANDIDATES = (base) => [
  base,
  ...SOURCE_EXT.map((e) => base + e),
  ...SOURCE_EXT.map((e) => path.join(base, `index${e}`)),
];

/** Candidate base paths for a workspace-package specifier (bare or subpath). */
function workspaceBases(spec, byName) {
  const hit = [...byName.keys()]
    .filter((n) => spec === n || spec.startsWith(`${n}/`))
    .sort((a, b) => b.length - a.length)[0];
  if (!hit) return [];
  const dir = byName.get(hit);
  const sub = spec.slice(hit.length).replace(/^\//, "").replace(/\.js$/, "");
  // Workspaces publish source through an exports map that rewrites `./*.js` →
  // `./src/*.ts`; try both roots rather than reimplementing exports resolution.
  if (sub) return [path.resolve(dir, sub), path.resolve(dir, "src", sub)];
  const main = readJson(path.join(dir, "package.json"))?.main;
  const fromMain = typeof main === "string" ? [path.resolve(dir, main.replace(/\.js$/, ""))] : [];
  return [...fromMain, path.resolve(dir, "src", "index"), path.resolve(dir, "index")];
}

function resolveFirstParty(spec, fromFile, root, byName) {
  if (!spec || spec.startsWith("node:") || spec.startsWith("data:")) return null;
  const bases = spec.startsWith(".")
    ? [path.resolve(path.dirname(fromFile), spec.replace(/\.js$/, ""))]
    : workspaceBases(spec, byName);
  for (const base of bases) {
    for (const c of RESOLVE_CANDIDATES(base)) {
      if (!existsSync(c) || !statSync(c).isFile()) continue;
      const rel = path.relative(root, c);
      return rel.startsWith("..") ? null : rel;
    }
  }
  return null;
}

const SPEC_RE =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+|^\s*export\s+\*\s+from\s*)["']([^"']+)["']/gm;

/**
 * Every ESM `import`/`export … from` and CJS `require()` specifier in a file.
 *
 * KNOWN LIMIT: this is a regex over source, not an AST walk — asymmetric with
 * the AST-level detection, and deliberately so. A NON-LITERAL specifier
 * (`import(pluginEntryPath)`) is invisible to it. That is why seed 3 reads the
 * plugin `server`/`bridge` entries from the manifests instead of relying on the
 * walk: the one dynamic-import site that matters today is covered by a seed,
 * not by this function. A future non-literal first-party import would escape
 * the walk silently and needs its own seed.
 */
export function specifiersOf(source) {
  const out = [];
  for (const m of source.matchAll(SPEC_RE)) out.push(m[1]);
  return out;
}

/** All source files under a directory, honouring the exclusion rules. */
function filesUnder(absDir, root) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const rel = path.relative(root, abs);
      if (isExcludedPath(rel)) continue;
      if (e.isDirectory()) walk(abs);
      else if (SOURCE_EXT.includes(path.extname(e.name))) out.push(rel);
    }
  };
  walk(absDir);
  return out;
}

/**
 * The gate's file set: the transitive first-party import graph of every seed,
 * plus the whole `src/**` of any workspace seeded through `main` (that entire
 * tree is jiti-evaluated by the re-exec, not only what the entry imports).
 */
export function discoverJitiLoadedFiles(root = repoRoot) {
  const { byName } = workspaceIndex(root);
  const seeds = discoverSeeds(root);
  const queue = [];
  const seen = new Set();

  const push = (rel) => {
    if (!rel || seen.has(rel) || isExcludedPath(rel)) return;
    seen.add(rel);
    queue.push(rel);
  };

  for (const s of [...seeds.piExtensions, ...seeds.mainTs, ...seeds.pluginEntries]) push(s);
  // A `main: *.ts` workspace is re-exec'd under jiti wholesale.
  for (const entry of seeds.mainTs) {
    const srcDir = path.join(root, path.dirname(entry));
    for (const f of filesUnder(srcDir, root)) push(f);
  }

  while (queue.length > 0) {
    const rel = queue.pop();
    const abs = path.join(root, rel);
    let source;
    try {
      source = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    for (const spec of specifiersOf(source)) {
      push(resolveFirstParty(spec, abs, root, byName));
    }
  }
  return [...seen].sort();
}

let jitiInstance;
const jiti = () => (jitiInstance ??= createJiti(import.meta.url));

/** Run jiti's real transform in CommonJS mode. */
export function transformToCjs(source, filename) {
  return jiti().transform({ source, filename, ts: true });
}

/**
 * Code-position `import.meta` detection — AST-level, never textual.
 *
 * A substring check is provably wrong in both directions here: jiti's output
 * preserves comments AND string literals, so `"import.meta.resolve is
 * unavailable"` or a doc-comment would false-positive. Parsing and locating
 * `MetaProperty` nodes is the only sound test.
 */
export function hasCodePositionImportMeta(emitted) {
  let ast;
  try {
    ast = acorn.parse(emitted, {
      ecmaVersion: "latest",
      sourceType: "module",
      allowImportExportEverywhere: true,
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
    });
  } catch {
    // Unparseable emitted output is a gate failure, not a pass.
    return true;
  }
  const IGNORED_KEYS = new Set(["type", "start", "end", "loc"]);
  const stack = [ast];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === null || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      stack.push(...node);
      continue;
    }
    if (node.type === "MetaProperty" && node.meta?.name === "import") return true;
    for (const key of Object.keys(node)) {
      if (!IGNORED_KEYS.has(key)) stack.push(node[key]);
    }
  }
  return false;
}

/** Transpile one repo-relative file and report whether it retains `import.meta`. */
export function checkFile(rel, root = repoRoot) {
  const abs = path.join(root, rel);
  const emitted = transformToCjs(readFileSync(abs, "utf8"), abs);
  return { file: rel, emitted, violates: hasCodePositionImportMeta(emitted) };
}
