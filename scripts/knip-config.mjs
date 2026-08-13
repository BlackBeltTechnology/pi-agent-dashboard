#!/usr/bin/env node
/**
 * Knip entry-point derivation — keeps `knip.json` honest against the manifests.
 *
 * Knip cannot infer this repo's entry points, and an UNROOTED graph does not
 * merely under-report: it reports reachable files as dead. Measured during the
 * spike — with no config, Knip claimed 723 findings and 90 unused files, of
 * which `canvas-tool.ts` (imported on the next line by `bridge.ts`),
 * `flow-question-adapter.ts` and `remote-connect-preload.ts` were plain false
 * positives. Rooting the graph took it to 437 findings and 10 unused files, all
 * ten exact-verified true positives.
 *
 * Three entry conventions are load-bearing and non-obvious:
 *   - `pi-dashboard-plugin` { client, server, bridge } — the dashboard plugins
 *   - `pi.extensions` — pi extensions, whose entry lives in a pi manifest
 *   - shell-invoked `scripts/**` — run as `node x.mjs` from .sh and CI, never
 *     imported, so Knip cannot see the edge (a DEAD script is undetectable;
 *     that is the accepted blind spot, see docs/code-quality.md)
 *
 * `--check` fails when a manifest declares an entry `knip.json` does not carry,
 * which is how the config is stopped from silently drifting back to unrooted.
 *
 * See change: add-knip-dead-code-oracle.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Entry paths implied by a manifest, restricted to the fields Knip CANNOT
 * infer. `bin`, `main` and `exports` are deliberately excluded: Knip reads
 * those natively, so demanding an explicit entry for them makes this check
 * report gaps that are not gaps (`packages/kb`'s `src/cli.ts` is rooted via
 * `bin` and is correctly absent from the unused-files list).
 *
 * Pure: returns paths relative to the package dir.
 */
export function deriveEntries(pkg) {
  const out = [];
  const plugin = pkg?.["pi-dashboard-plugin"];
  if (plugin && typeof plugin === "object") {
    for (const key of ["client", "server", "bridge"]) {
      if (typeof plugin[key] === "string") out.push(plugin[key]);
    }
  }
  const ext = pkg?.pi?.extensions;
  if (Array.isArray(ext)) {
    for (const e of ext) if (typeof e === "string") out.push(e);
  }
  return out.map(normalizeEntry).filter(Boolean);
}

/**
 * A manifest points at built output (`dist/`, `.vite/`); Knip must be pointed at
 * the SOURCE that produces it, or the whole tree behind it stays unrooted.
 */
export function normalizeEntry(entry) {
  if (typeof entry !== "string" || entry.length === 0) return null;
  let e = entry.replace(/^\.\//, "");
  if (e.startsWith("dist/")) e = e.replace(/^dist\//, "src/").replace(/\.js$/, ".ts");
  if (e.startsWith(".vite/build/")) e = e.replace(/^\.vite\/build\//, "src/").replace(/\.js$/, ".ts");
  return e;
}

/**
 * The workspace that OWNS a repo-root-relative path: the longest configured
 * workspace prefix. The root manifest declares `pi.extensions` pointing at
 * `packages/extension/src/bridge.ts`, which is rooted by the
 * `packages/extension` workspace — not by the root one — so resolving the owner
 * is what keeps this check from inventing gaps.
 */
export function owningWorkspace(config, repoPath) {
  const keys = Object.keys(config?.workspaces ?? {}).filter((k) => k !== ".");
  let best = ".";
  for (const k of keys) {
    if (repoPath.startsWith(`${k}/`) && k.length > best.length) best = k;
  }
  return best;
}

/**
 * Entries a manifest declares that `knip.json` does not carry.
 * `packages` is [{ dir, pkg }] with `dir` relative to the repo root.
 */
export function missingEntries(config, packages) {
  const missing = [];
  for (const { dir, pkg } of packages) {
    for (const entry of deriveEntries(pkg)) {
      const repoPath = dir === "." ? entry : `${dir}/${entry}`;
      const owner = owningWorkspace(config, repoPath);
      const relative = owner === "." ? repoPath : repoPath.slice(owner.length + 1);
      const configured = new Set(toArray(config?.workspaces?.[owner]?.entry));
      if (!covers(configured, relative)) missing.push({ workspace: owner, entry: relative });
    }
  }
  return missing;
}

function toArray(v) {
  if (Array.isArray(v)) return v;
  return typeof v === "string" ? [v] : [];
}

/** An entry is covered by an exact match or by a glob that subsumes it. */
function covers(configured, entry) {
  if (configured.has(entry)) return true;
  for (const c of configured) {
    if (!c.includes("*")) continue;
    const re = new RegExp(`^${c.replace(/\./g, "\\.").replace(/\*\*\//g, "(.*/)?").replace(/\*/g, "[^/]*")}$`);
    if (re.test(entry)) return true;
  }
  return false;
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".vite", "out", "coverage"]);

/**
 * Every manifest in the tree, walked from the filesystem.
 *
 * Deliberately NOT `git ls-files`: the Docker harness image carries the source
 * but not `.git` (it is in .dockerignore), so a git-backed walk aborts with
 * "not a git repository" there — caught by the harness run, which is the whole
 * reason that check exists.
 */
export function readWorkspacePackages(root, dir = ".", out = []) {
  const abs = path.join(root, dir);
  let entries;
  try {
    entries = readdirSync(abs, { withFileTypes: true });
  } catch {
    return out;
  }
  if (entries.some((e) => e.isFile() && e.name === "package.json")) {
    try {
      out.push({ dir, pkg: JSON.parse(readFileSync(path.join(abs, "package.json"), "utf8")) });
    } catch {
      /* an unparseable manifest is not this script's problem */
    }
  }
  for (const e of entries) {
    if (!e.isDirectory() || SKIP_DIRS.has(e.name)) continue;
    readWorkspacePackages(root, dir === "." ? e.name : `${dir}/${e.name}`, out);
  }
  return out;
}

function main() {
  const root = process.cwd();
  const config = JSON.parse(readFileSync(path.join(root, "knip.json"), "utf8"));
  const missing = missingEntries(config, readWorkspacePackages(root));
  for (const m of missing) {
    console.error(`✗ ${m.workspace}: manifest declares entry "${m.entry}" but knip.json does not`);
  }
  if (missing.length === 0) {
    console.log("✓ knip-config: every manifest-declared entry is rooted in knip.json");
  } else {
    console.error(`  fix: add the entry to knip.json workspaces — an unrooted tree reports live files as dead`);
  }
  process.exit(missing.length === 0 ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
