/**
 * Shared checks for the manifest forward-compatibility contract (spec `dashboard-plugin-skill`, items 1-6)
 * and the `node_modules` layout scenario. Used by `forward-compat.test.ts` and `render-augment.test.ts`.
 * See change: decouple-plugins-from-core (tasks 7.9, 8.135).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { scaffoldHostApiRange } from "../render.js";

export interface PackageJson {
  keywords?: string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  exports?: Record<string, string>;
  scripts?: Record<string, string>;
  "pi-dashboard-plugin"?: Record<string, unknown> & { claims?: unknown[] };
  [key: string]: unknown;
}

/** Manifest fields holding a package-relative path. */
export const MANIFEST_PATH_FIELDS = ["client", "clientBundle", "clientStyles", "server", "bridge", "configSchema"] as const;

/** Every manifest path value, keyed by field. */
export function manifestPaths(pkg: PackageJson): Array<[string, string]> {
  const m = pkg["pi-dashboard-plugin"] ?? {};
  return MANIFEST_PATH_FIELDS.flatMap((k) => (typeof m[k] === "string" ? [[k, m[k] as string] as [string, string]] : []));
}

type Manifest = Record<string, unknown>;

function pathViolations(pkg: PackageJson): string[] {
  return manifestPaths(pkg).flatMap(([k, v]) => {
    const out: string[] = [];
    if (v.startsWith("/")) out.push(`(2) ${k} is absolute: ${v}`);
    if (!v.startsWith("./")) out.push(`(2) ${k} is not ./-relative: ${v}`);
    if (v.split("/").includes("..")) out.push(`(2) ${k} escapes the package root: ${v}`);
    return out;
  });
}

function exportsViolations(pkg: PackageJson, m: Manifest): string[] {
  return (["client", "server", "bridge"] as const)
    .filter((f) => typeof m[f] === "string" && pkg.exports?.[`./${f}`] !== m[f])
    .map((f) => `(4) exports["./${f}"] (${String(pkg.exports?.[`./${f}`])}) != manifest.${f} (${String(m[f])})`);
}

function runtimeViolations(m: Manifest): string[] {
  const bundle = m.clientBundle;
  if (typeof bundle !== "string") return ["runtime: no clientBundle"];
  const dir = path.posix.dirname(bundle);
  const out: string[] = [];
  if (dir === ".") out.push(`runtime: clientBundle ${bundle} is not in a dedicated directory`);
  for (const f of ["server", "bridge", "configSchema"] as const) {
    const v = m[f];
    if (typeof v === "string" && path.posix.dirname(v) === dir) out.push(`runtime: ${f} ${v} lies inside the client bundle dir ${dir}`);
  }
  if (typeof m.clientStyles === "string" && path.posix.dirname(m.clientStyles) !== dir) out.push(`runtime: clientStyles ${m.clientStyles} is outside ${dir}`);
  return out;
}

/** Violations of contract items (1)-(6); empty = conforming. `requireRuntime` adds the runtime-delivery rules. */
export function contractViolations(pkg: PackageJson, opts: { requireRuntime?: boolean } = {}): string[] {
  const m = pkg["pi-dashboard-plugin"] as Manifest | undefined;
  if (!m) return ["(1) no top-level `pi-dashboard-plugin` field"]; // (1) top level, not under `pi`
  const out: string[] = [];
  if ((pkg.pi as Manifest | undefined)?.["pi-dashboard-plugin"] !== undefined) out.push("(1) manifest nested under `pi`");
  out.push(...pathViolations(pkg)); // (2)
  for (const group of ["dependencies", "devDependencies"] as const) {
    for (const [name, range] of Object.entries(pkg[group] ?? {})) if (range.startsWith("workspace:")) out.push(`(3) ${group}.${name} is ${range}`);
  }
  out.push(...exportsViolations(pkg, m)); // (4)
  if (typeof m.requiredApi !== "string" || !/^[\^~]?\d+(\.(\d+|x)){0,2}$/.test(m.requiredApi)) out.push(`(5) requiredApi is not a semver range: ${String(m.requiredApi)}`);
  if (m.hostApi !== scaffoldHostApiRange()) out.push(`(6) hostApi ${String(m.hostApi)} != ${scaffoldHostApiRange()}`);
  if (!pkg.keywords?.includes("pi-dashboard-plugin")) out.push("(6) keywords lack pi-dashboard-plugin");
  return opts.requireRuntime ? [...out, ...runtimeViolations(m)] : out;
}

/** Manifest paths that do not resolve to a regular file inside `root` (a `node_modules/<pkg>/` copy). */
export function unresolvedManifestPaths(root: string, pkg: PackageJson): string[] {
  const rootAbs = path.resolve(root);
  return manifestPaths(pkg)
    .filter(([, v]) => {
      const abs = path.resolve(rootAbs, v);
      return !abs.startsWith(`${rootAbs}${path.sep}`) || !fs.existsSync(abs) || !fs.statSync(abs).isFile();
    })
    .map(([k, v]) => `${k}: ${v}`);
}
