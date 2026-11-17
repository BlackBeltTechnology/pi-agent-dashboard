/**
 * Switch a monorepo extension/skill package between its PUBLISHED npm source
 * and its LOCAL working-tree source, guaranteeing exactly one source per package.
 *
 * Two config layers are reconciled:
 *   - GLOBAL  ~/.pi/agent/settings.json   "packages": [...]
 *       npm  form  -> "npm:<npmName>"
 *       local form -> "<repoRoot>/packages/<dir>"        (dir path; pi resolves package.json "pi")
 *   - PROJECT <repo>/.pi/settings.json     only CLEANED, never added to: old
 *       "+packages/<dir>/<entry>" overlay paths are stripped, and a project entry is
 *       never left with an empty extensions/skills/prompts/themes filter (an empty
 *       filter on the repo-root entry disables the same-path global bridge →
 *       REGISTER_TIMEOUT). The project file is never created.
 *
 * Every switch:
 *   - removes ALL other representations of that package (no shadowing / double-load)
 *   - timestamped-backs-up each file it edits (project only when it changed)
 *   - re-validates JSON before writing
 *
 * Invoke:
 *   npx tsx ./scripts/switch-source.ts status
 *   npx tsx ./scripts/switch-source.ts local <pkg>      (the removed overlay flag exits 1)
 *   npx tsx ./scripts/switch-source.ts npm   <pkg>
 *
 * <pkg> = monorepo dir name (kb-extension) OR npm name (@blackbelt-technology/pi-dashboard-kb-extension).
 *
 * NOTE: packages loaded via dashboardPluginBridges (flows/goal/automation bridges) are
 * dashboard-managed and intentionally NOT toggled here. Re-init takes effect on the NEXT
 * session start (packages[] is read at init), so respawn sessions / run `npm run reload` after.
 */
import { readFileSync, writeFileSync, copyFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "../../../..");
const GLOBAL = join(homedir(), ".pi", "agent", "settings.json");
const PROJECT = join(REPO, ".pi", "settings.json");
const PKGS = join(REPO, "packages");

export type PkgInfo = { dir: string; npmName: string; hasExt: boolean; entry: string | null };

function readJson(p: string): any {
  return JSON.parse(readFileSync(p, "utf8"));
}
function writeJson(p: string, obj: any) {
  JSON.parse(JSON.stringify(obj)); // validate serializable
  copyFileSync(p, `${p}.bak-switch-${Date.now()}`);
  writeFileSync(p, `${JSON.stringify(obj, null, 2)}\n`);
}

function scanPackages(pkgs: string = PKGS): PkgInfo[] {
  const out: PkgInfo[] = [];
  for (const dir of readdirSync(pkgs)) {
    const pj = join(pkgs, dir, "package.json");
    if (!existsSync(pj)) continue;
    let o: any;
    try {
      o = readJson(pj);
    } catch {
      continue;
    }
    const pi = o.pi ?? {};
    const exts: string[] = pi.extensions ?? [];
    out.push({
      dir,
      npmName: o.name ?? dir,
      hasExt: exts.length > 0,
      entry: exts[0] ?? null,
    });
  }
  return out;
}

function resolvePkg(ident: string, all: PkgInfo[]): PkgInfo {
  const hit = all.find((p) => p.dir === ident || p.npmName === ident);
  if (!hit) {
    console.error(`✗ unknown package: ${ident}`);
    console.error(`  known: ${all.map((p) => p.dir).join(", ")}`);
    process.exit(1);
  }
  return hit;
}

const NPM_ENTRY = (p: PkgInfo) => `npm:${p.npmName}`;
/** Repo root derived from the project settings path (`<repo>/.pi/settings.json`). */
const repoOf = (projectPath: string) => dirname(dirname(projectPath));
const localPrefix = (p: PkgInfo, projectPath: string) => `${repoOf(projectPath)}/packages/${p.dir}`;
/** Global entries are strings or `{ source, ... }` objects (the dashboard toggle writes both). */
const globalSource = (e: any): string | undefined => (typeof e === "string" ? e : e?.source);
const isObj = (e: unknown): e is Record<string, any> => typeof e === "object" && e !== null && !Array.isArray(e);
const RESOURCE_KEYS = ["extensions", "skills", "prompts", "themes"] as const;
const overlayPathOf = (p: PkgInfo) => (e: unknown) =>
  typeof e === "string" && e.replace(/^\+/, "").startsWith(`packages/${p.dir}/`);

/**
 * Remove every representation of pkg from global packages[] and the project file,
 * then prune: a project entry is never left with an empty resource filter.
 *
 * Why: pi resolves project packages first and keeps the first entry per extension
 * file path, so an empty `extensions` on the repo-root entry DISABLES
 * `packages/extension/src/bridge.ts` and shadows the global bridge entry
 * (every session → REGISTER_TIMEOUT). Repair candidates = non-delta object
 * entries that had a `+packages/<dir>/` path removed in this run, or whose
 * `source` resolves to the repo root. See change: fix-switch-source-empty-overlay.
 */
export function purge(global: any, project: any, p: PkgInfo, projectPath: string = PROJECT) {
  const pref = localPrefix(p, projectPath);
  global.packages = (global.packages ?? []).filter((e: any) => {
    const src = globalSource(e);
    return typeof src !== "string" || (src !== NPM_ENTRY(p) && src !== pref && !src.startsWith(`${pref}/`));
  });
  if (!Array.isArray(project.packages)) return;
  const repo = repoOf(projectPath);
  const isOverlayPath = overlayPathOf(p);
  project.packages = project.packages.filter((ov: unknown) => {
    if (!isObj(ov) || ov.autoload === false) return true;
    let touched = false;
    if (Array.isArray(ov.extensions)) {
      const kept = ov.extensions.filter((e: unknown) => !isOverlayPath(e));
      touched = kept.length !== ov.extensions.length;
      ov.extensions = kept;
    }
    const isRoot = typeof ov.source === "string" && resolve(dirname(projectPath), ov.source) === repo;
    if (!touched && !isRoot) return true;
    const hadKeys = RESOURCE_KEYS.some((k) => k in ov);
    for (const k of RESOURCE_KEYS) if (Array.isArray(ov[k]) && ov[k].length === 0) delete ov[k];
    return !(hadKeys && !RESOURCE_KEYS.some((k) => k in ov));
  });
  if (project.packages.length === 0) delete project.packages;
}

export function detect(global: any, project: any, p: PkgInfo, projectPath: string = PROJECT): string {
  const pkgs = (global.packages ?? []).map(globalSource).filter((s: unknown): s is string => typeof s === "string");
  const pref = localPrefix(p, projectPath);
  if (pkgs.includes(NPM_ENTRY(p))) return "npm";
  if (pkgs.includes(pref)) return "local (global path)";
  if (pkgs.some((e: string) => e.startsWith(`${pref}/`))) return "local (global file path)";
  const isOverlayPath = overlayPathOf(p);
  for (const ov of project.packages ?? [])
    if (isObj(ov) && Array.isArray(ov.extensions) && ov.extensions.some(isOverlayPath))
      return "local (project overlay)";
  return "—";
}

function cmdStatus() {
  const global = readJson(GLOBAL);
  const project = existsSync(PROJECT) ? readJson(PROJECT) : { packages: [] };
  const all = scanPackages().filter((p) => p.hasExt || (readJson(join(PKGS, p.dir, "package.json")).pi?.skills));
  console.log(`source map  (REPO=${REPO})\n`);
  for (const p of all) {
    const src = detect(global, project, p);
    if (src === "—") continue;
    console.log(`  ${p.dir.padEnd(26)} ${src.padEnd(26)} ${p.npmName}`);
  }
  console.log(`\n(only installed packages shown; run with: local <pkg> | npm <pkg>)`);
}

type Paths = { global: string; project: string; pkgs: string };

export function cmdSwitch(
  mode: "local" | "npm",
  ident: string,
  overlay = false,
  paths: Paths = { global: GLOBAL, project: PROJECT, pkgs: PKGS },
) {
  if (overlay) {
    // Removed: a `+path` filter can only re-enable files already in the ROOT manifest,
    // so the overlay never loaded anything new. See change: fix-switch-source-empty-overlay.
    console.error("✗ --overlay was removed (it never loaded anything new). Use plain 'local <pkg>'.");
    process.exit(1);
  }
  const all = scanPackages(paths.pkgs);
  const p = resolvePkg(ident, all);
  const global = readJson(paths.global);
  const hasProject = existsSync(paths.project);
  const project = hasProject ? readJson(paths.project) : {};
  const projectBefore = JSON.stringify(project);

  purge(global, project, p, paths.project);

  if (mode === "npm") global.packages.push(NPM_ENTRY(p));
  else global.packages.push(localPrefix(p, paths.project));

  writeJson(paths.global, global);
  // Never create the project file; rewrite (and back up) only when it changed.
  if (hasProject && JSON.stringify(project) !== projectBefore) writeJson(paths.project, project);

  console.log(`✓ ${p.dir} -> ${detect(readJson(paths.global), project, p, paths.project)}`);
  console.log(`  backups: *.bak-switch-* | takes effect on NEXT session start (respawn / npm run reload)`);
}

// Run the CLI only when executed directly, so tests can import the functions.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const [cmd, ident] = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const overlay = process.argv.includes("--overlay");

  if (cmd === "status") cmdStatus();
  else if ((cmd === "local" || cmd === "npm") && ident) cmdSwitch(cmd, ident, overlay);
  else {
    console.error("usage: switch-source.ts status | local <pkg> | npm <pkg>");
    process.exit(1);
  }
}
