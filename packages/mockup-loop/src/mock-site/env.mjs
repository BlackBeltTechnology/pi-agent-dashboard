// @ts-check
// Mock-site environment: resolve the project's launcher + app build config through a
// build-tool adapter, load the (optional) mock options, and generate the inheriting
// Vite config at `node_modules/.vite-mock-site/mock-site.config.mjs` on every start.
// No static `vite` import: the serve path loads the PROJECT's Vite lazily.
// See change: add-mock-site-exact-env (design D1, D2, D8, D9).

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateOptions } from "./options.mjs";
import { mockSite } from "./plugin.mjs";

/** @typedef {import("./options.mjs").MockSiteUserOptions} MockSiteUserOptions */

const VITE_CONFIGS = ["vite.config.ts", "vite.config.mts", "vite.config.js", "vite.config.mjs", "vite.config.cts", "vite.config.cjs"];
const OPTION_FILES = ["mock-site.config.ts", "mock-site.config.mts", "mock-site.config.js", "mock-site.config.mjs"];
/** Build tools we can name in an "unsupported" error: marker file → tool. */
const OTHER_TOOLS = [
  [/^webpack\.config\./, "webpack"], [/^rspack\.config\./, "rspack"], [/^next\.config\./, "next"],
  [/^\.parcelrc$/, "parcel"], [/^angular\.json$/, "angular"], [/^rollup\.config\./, "rollup"],
];
const BUILD_ADAPTERS = ["vite"];
const NEXT_STEP = `declare it in package.json: "mockSite": { "launcher": "<script that starts the build tool>", "config": "<app build config>" }, or add a build-tool adapter`;
export const GENERATED_DIR = path.join("node_modules", ".vite-mock-site");

/** @param {string} file */
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return undefined; }
}

/**
 * A declared project-relative path: must exist, and its real path (symlinks
 * followed) must sit inside the project root.
 * @param {string} root @param {string} rel @param {"launcher"|"config"} what
 * @returns {{ ok: true, file: string } | { ok: false, error: string }}
 */
function declaredPath(root, rel, what) {
  const abs = path.resolve(root, rel);
  if (!fs.existsSync(abs)) return { ok: false, error: `declared ${what} not found: ${abs} (package.json "mockSite.${what}")` };
  const real = fs.realpathSync(abs);
  const realRoot = fs.realpathSync(root);
  const inside = real === realRoot || real.startsWith(realRoot + path.sep);
  if (!inside) return { ok: false, error: `refusing ${what} outside the project: ${real} (declared as ${rel}; project ${realRoot})` };
  return { ok: true, file: real };
}

/** The project's Vite package dir, or null. @param {string} root */
function viteDir(root) {
  try {
    return path.dirname(createRequire(path.join(root, "package.json")).resolve("vite/package.json"));
  } catch {
    return null;
  }
}

/** @param {string} root @param {any} pkg */
function detectViteConfig(root, pkg) {
  for (const f of VITE_CONFIGS) if (fs.existsSync(path.join(root, f))) return path.join(root, f);
  const dev = typeof pkg?.scripts?.dev === "string" ? pkg.scripts.dev : "";
  const m = /\bvite\b[^&|;]*?(?:--config|-c)[ =]+(\S+)/.exec(dev);
  if (m && fs.existsSync(path.resolve(root, m[1]))) return path.resolve(root, m[1]);
  return null;
}

/**
 * Resolve the launcher + app config. Order: package.json `mockSite`, then the mock
 * options' `launcher`/`config`, then Vite adapter detection.
 * @param {string} root
 * @param {{ options?: MockSiteUserOptions }} [opts]
 * @returns {{ ok: true, adapter: "vite", launcher: string, config: string, source: "declared"|"detected" } | { ok: false, error: string }}
 */
export function resolveLauncher(root, opts = {}) {
  const pkg = readJson(path.join(root, "package.json")) ?? {};
  const manifest = pkg.mockSite && typeof pkg.mockSite === "object" ? pkg.mockSite : {};
  const launcherDecl = manifest.launcher ?? opts.options?.launcher;
  const configDecl = manifest.config ?? opts.options?.config;
  let config;
  if (configDecl) {
    const r = declaredPath(root, configDecl, "config");
    if (!r.ok) return r;
    config = r.file;
  } else {
    config = detectViteConfig(root, pkg);
    if (!config) {
      const names = fs.existsSync(root) ? fs.readdirSync(root) : [];
      const other = OTHER_TOOLS.find(([re]) => names.some((n) => /** @type {RegExp} */ (re).test(n)));
      if (other) return { ok: false, error: `build tool ${other[1]} has no mock-site adapter (supported adapters: ${BUILD_ADAPTERS.join(", ")}); ${NEXT_STEP}` };
      return { ok: false, error: `no app build config found in ${root} (looked for ${VITE_CONFIGS.join(", ")} and a "--config" in scripts.dev; supported adapters: ${BUILD_ADAPTERS.join(", ")}); ${NEXT_STEP}` };
    }
  }
  let launcher;
  if (launcherDecl) {
    const r = declaredPath(root, launcherDecl, "launcher");
    if (!r.ok) return r;
    launcher = r.file;
  } else {
    const dir = viteDir(root);
    if (!dir || !fs.existsSync(path.join(dir, "bin", "vite.js"))) return { ok: false, error: `vite not found from ${root}; install vite in the project, or ${NEXT_STEP}` };
    launcher = path.join(dir, "bin", "vite.js");
  }
  return { ok: true, adapter: "vite", launcher, config, source: launcherDecl || configDecl ? "declared" : "detected" };
}

/**
 * Take the app's build shape: resolve root-relative settings against the app's
 * source root, then drop dev-server runtime (`server`), output (`build`) and `root`.
 * The app's root is relative to its config's directory (where its scripts run).
 * @param {Record<string, any>} cfg @param {string} configFile
 */
export function inheritAppConfig(cfg, configFile) {
  const appRoot = path.resolve(path.dirname(configFile), typeof cfg.root === "string" ? cfg.root : ".");
  const out = { ...cfg };
  out.publicDir = out.publicDir === false ? false : path.resolve(appRoot, typeof out.publicDir === "string" ? out.publicDir : "public");
  out.envDir = out.envDir === false ? false : path.resolve(appRoot, typeof out.envDir === "string" ? out.envDir : ".");
  if (typeof out.cacheDir === "string") out.cacheDir = path.resolve(appRoot, out.cacheDir);
  delete out.server;
  delete out.build;
  delete out.root;
  delete out.preview;
  return { config: out, appRoot };
}

/**
 * Load the project's own Vite (ESM entry) lazily — the extension never imports it statically.
 * @param {string} root
 */
export async function importProjectVite(root) {
  const dir = viteDir(root);
  if (!dir) throw new Error(`vite not found from ${root}; install vite in the project`);
  const pkg = readJson(path.join(dir, "package.json")) ?? {};
  const dot = pkg.exports?.["."];
  const entry = (typeof dot?.import === "string" ? dot.import : dot?.import?.default) ?? pkg.module ?? "dist/node/index.js";
  return import(pathToFileURL(path.join(dir, entry)).href);
}

/** The options file under `mockups/`, or null. @param {string} root */
export function optionsFile(root) {
  for (const f of OPTION_FILES) if (fs.existsSync(path.join(root, "mockups", f))) return path.join(root, "mockups", f);
  return null;
}

/**
 * Load + validate the optional options file through the project's Vite config loader.
 * @param {string} root @param {any} vite
 * @returns {Promise<{ ok: true, options: MockSiteUserOptions, file: string|null } | { ok: false, error: string }>}
 */
export async function loadOptions(root, vite) {
  const file = optionsFile(root);
  if (!file) return { ok: true, options: {}, file: null };
  try {
    const loaded = await vite.loadConfigFromFile({ command: "serve", mode: "development" }, file, root, "silent");
    return { ok: true, options: validateOptions(loaded?.config, file), file };
  } catch (e) {
    const msg = String(/** @type {Error} */ (e)?.message ?? e).split("\n")[0];
    return { ok: false, error: msg.includes(file) ? msg : `mock options file failed to load: ${file}: ${msg}` };
  }
}

/**
 * Everything a start needs: options, launcher, app config, and the generated config
 * (rewritten on every call).
 * @param {string} root
 * @returns {Promise<{ ok: true, launcher: string, config: string, generated: string, source: string, optionsFile: string|null } | { ok: false, error: string }>}
 */
export async function prepareMockSite(root) {
  /** @type {MockSiteUserOptions} */
  let options = {};
  let file = null;
  if (optionsFile(root)) {
    let vite;
    try { vite = await importProjectVite(root); } catch (e) { return { ok: false, error: String(/** @type {Error} */ (e).message) }; }
    const o = await loadOptions(root, vite);
    if (!o.ok) return o;
    options = o.options;
    file = o.file;
  }
  const l = resolveLauncher(root, { options });
  if (!l.ok) return l;
  const generated = writeGeneratedConfig(root, { config: l.config, options, optionsFile: file });
  return { ok: true, launcher: l.launcher, config: l.config, generated, source: l.source, optionsFile: file };
}

/**
 * Write `<root>/node_modules/.vite-mock-site/mock-site.config.<hash>.mjs` (plain .mjs:
 * no TS stripping under node_modules; `<hash>` of the root keeps projects that share
 * a symlinked node_modules apart). It imports the project's Vite next to it.
 * @param {string} root @param {{ config: string, options: MockSiteUserOptions, optionsFile: string|null }} p
 */
function writeGeneratedConfig(root, p) {
  const dir = path.join(root, GENERATED_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `mock-site.config.${createHash("sha256").update(root).digest("hex").slice(0, 8)}.mjs`);
  const envModule = fileURLToPath(import.meta.url);
  const params = { projectRoot: root, config: p.config, options: p.options, optionsFile: p.optionsFile };
  fs.writeFileSync(file, `// GENERATED by the mock site on every start — do not edit.
import * as vite from "vite";
import { createMockSiteConfig } from ${JSON.stringify(envModule)};
export default (env) => createMockSiteConfig(${JSON.stringify(params)}, env, vite);
`);
  return file;
}

/**
 * @public Imported by the generated config (a file knip cannot see).
 * Called by the generated config inside the launcher's process: load the app
 * config, inherit its build shape, and layer the mock-site plugin on top.
 * @param {{ projectRoot: string, config: string, options: MockSiteUserOptions, optionsFile: string|null }} p
 * @param {{ mode?: string }} env
 * @param {any} vite
 */
export async function createMockSiteConfig(p, env, vite) {
  const loaded = await vite.loadConfigFromFile({ command: "serve", mode: env?.mode ?? "development", isSsrBuild: false, isPreview: false }, p.config, path.dirname(p.config));
  if (!loaded) throw new Error(`mock-site: app config did not load: ${p.config}`);
  const { config, appRoot } = inheritAppConfig(loaded.config, p.config);
  const o = p.options ?? {};
  console.log(`mock-site: app config ${p.config}${p.optionsFile ? `, options ${p.optionsFile}` : ""}`);
  return vite.mergeConfig(config, {
    plugins: [mockSite({ projectRoot: p.projectRoot, app: o.app, title: o.title, themes: o.themes, aliases: o.aliases, appRoot })],
  });
}
