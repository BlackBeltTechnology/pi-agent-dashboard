/**
 * Switch a monorepo extension/skill package between its PUBLISHED npm source
 * and its LOCAL working-tree source, guaranteeing exactly one source per package.
 *
 * Two config layers are reconciled:
 *   - GLOBAL  ~/.pi/agent/settings.json   "packages": [...]
 *       npm  form  -> "npm:<npmName>"
 *       local form -> "<repoRoot>/packages/<dir>"        (dir path; pi resolves package.json "pi")
 *   - PROJECT <repo>/.pi/settings.json     "packages":[{ source, extensions:["+packages/<dir>/<entry>"] }]
 *       local overlay form (only when --overlay given, package must have pi.extensions)
 *
 * Every switch:
 *   - removes ALL other representations of that package (no shadowing / double-load)
 *   - timestamped-backs-up each file it edits
 *   - re-validates JSON before writing
 *
 * Invoke:
 *   npx tsx ./scripts/switch-source.ts status
 *   npx tsx ./scripts/switch-source.ts local <pkg> [--overlay]
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

type PkgInfo = { dir: string; npmName: string; hasExt: boolean; entry: string | null };

function readJson(p: string): any {
  return JSON.parse(readFileSync(p, "utf8"));
}
function writeJson(p: string, obj: any) {
  JSON.parse(JSON.stringify(obj)); // validate serializable
  copyFileSync(p, `${p}.bak-switch-${Date.now()}`);
  writeFileSync(p, `${JSON.stringify(obj, null, 2)}\n`);
}

function scanPackages(): PkgInfo[] {
  const out: PkgInfo[] = [];
  for (const dir of readdirSync(PKGS)) {
    const pj = join(PKGS, dir, "package.json");
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

const LOCAL_DIR = (p: PkgInfo) => `${REPO}/packages/${p.dir}`;
const NPM_ENTRY = (p: PkgInfo) => `npm:${p.npmName}`;
const localPrefix = (p: PkgInfo) => `${REPO}/packages/${p.dir}`;

// Remove every representation of pkg from global packages[] and project overlay.
function purge(global: any, project: any, p: PkgInfo) {
  const pref = localPrefix(p);
  global.packages = (global.packages ?? []).filter(
    (e: string) => e !== NPM_ENTRY(p) && e !== pref && !e.startsWith(`${pref}/`),
  );
  for (const ov of project.packages ?? []) {
    if (!Array.isArray(ov.extensions)) continue;
    ov.extensions = ov.extensions.filter(
      (e: string) => !e.replace(/^\+/, "").startsWith(`packages/${p.dir}/`),
    );
  }
}

function detect(global: any, project: any, p: PkgInfo): string {
  const pkgs: string[] = global.packages ?? [];
  const pref = localPrefix(p);
  if (pkgs.includes(NPM_ENTRY(p))) return "npm";
  if (pkgs.includes(pref)) return "local (global path)";
  if (pkgs.some((e) => e.startsWith(`${pref}/`))) return "local (global file path)";
  for (const ov of project.packages ?? [])
    if ((ov.extensions ?? []).some((e: string) => e.replace(/^\+/, "").startsWith(`packages/${p.dir}/`)))
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

function ensureProjectOverlay(project: any): any {
  if (!Array.isArray(project.packages)) project.packages = [];
  let ov = project.packages.find((x: any) => x.source === REPO);
  if (!ov) {
    ov = { source: REPO, extensions: [] };
    project.packages.push(ov);
  }
  if (!Array.isArray(ov.extensions)) ov.extensions = [];
  return ov;
}

function cmdSwitch(mode: "local" | "npm", ident: string, overlay: boolean) {
  const all = scanPackages();
  const p = resolvePkg(ident, all);
  const global = readJson(GLOBAL);
  const project = existsSync(PROJECT) ? readJson(PROJECT) : { packages: [] };

  purge(global, project, p);

  if (mode === "npm") {
    global.packages.push(NPM_ENTRY(p));
  } else if (overlay) {
    if (!p.hasExt) {
      console.error(`✗ --overlay needs pi.extensions; ${p.dir} has none. Use plain 'local'.`);
      process.exit(1);
    }
    const ov = ensureProjectOverlay(project);
    ov.extensions.push(`+packages/${p.dir}/${p.entry}`);
  } else {
    global.packages.push(LOCAL_DIR(p));
  }

  writeJson(GLOBAL, global);
  if (existsSync(PROJECT) || mode === "local") writeJson(PROJECT, project);

  console.log(`✓ ${p.dir} -> ${detect(readJson(GLOBAL), existsSync(PROJECT) ? readJson(PROJECT) : { packages: [] }, p)}`);
  console.log(`  backups: *.bak-switch-* | takes effect on NEXT session start (respawn / npm run reload)`);
}

const [cmd, ident] = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const overlay = process.argv.includes("--overlay");

if (cmd === "status") cmdStatus();
else if ((cmd === "local" || cmd === "npm") && ident) cmdSwitch(cmd, ident, overlay);
else {
  console.error("usage: switch-source.ts status | local <pkg> [--overlay] | npm <pkg>");
  process.exit(1);
}
