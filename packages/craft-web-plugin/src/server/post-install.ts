/**
 * `provisionWeb` post-install hook: turns a freshly extracted ArtCraft web build into the tree the
 * `serveApp` mount serves under a script-hash-free CSP (design D3).
 *
 *  1. externalizes EVERY executable inline script (no `type`, `text/javascript`, `module`) into
 *     `inline-<n>-<hash>.js`, keeping kind and order; data blocks (`application/json`, …) stay inline;
 *     an inline `importmap` fails (CSP would block it, no observed build uses one);
 *  2. injects the profile's ready hook: `trunk` = the build's own `TrunkApplicationStarted` dispatch
 *     (exactly one); `load-ready-ms` / `after-start-call` = a dispatch right after the hook point, which
 *     must match EXACTLY once (else throw → prepare `extract-failed`, `current` unchanged);
 *  3. loads, first in `<head>`: `craft-worker-<hash>.js` (only `workerTrampoline`), then
 *     `craft-profile-<hash>.js` (`window.__CRAFT_PROFILE__`), then `craft-shim-<hash>.js`;
 *  4. marks the document `<!-- craft-shim:<v> -->` + `<!-- craft-profile:<hash> -->` (idempotent rerun);
 *  5. writes `.gz` siblings for `.wasm/.js/.html/.css` (never `.br`: brotli is truncated by zrok);
 *  6. writes `craft-build.json {app, version, shimVersion, profileHash, sizeGzip}` (read by `status`).
 *
 * See change: edit-office-in-pane-with-craft-web (D2, task 4.1), extend-craft-web-to-all-apps (D3).
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";
import type { WebPostInstallContext } from "@blackbelt-technology/pi-dashboard-craft-apps/provision.js";
import { type CraftAppProfile, frameProfile, profileFor } from "../shared/app-profiles.js";
import { SHIM_SOURCE_PATH, WORKER_SOURCE_PATH } from "./shim.js";

const gzip = promisify(zlib.gzip);

export const BUILD_INFO_FILE = "craft-build.json";
const GZIP_EXTS = new Set([".wasm", ".js", ".html", ".css"]);
/** v1 marker shape; v1 plugins parse a v2 tree with this exact regex (test-plan #E7). */
const MARKER_RE = /<!-- craft-shim:(\d+) -->/;
const PROFILE_MARKER_RE = /<!-- craft-profile:([0-9a-f]+) -->/;
/** Any `<script …>…</script>` element (attributes in group 1, body in group 2). */
const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const TRUNK_EVENT = "TrunkApplicationStarted";
const DISPATCH = `\n;dispatchEvent(new CustomEvent("${TRUNK_EVENT}"));\n`;

/** `craft-build.json` of an installed tree. */
export interface CraftBuildInfo {
  app: string;
  version: string;
  shimVersion: number;
  /** Hash of the profile the tree was prepared with (absent in v1-shim trees). */
  profileHash?: string;
  /** Bytes a client downloads for the whole build (gzip variants where they exist). */
  sizeGzip: number;
}

const shortHash = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex").slice(0, 10);

/** The profile script the frame loads before the shim. */
const profileScript = (p: CraftAppProfile): string => `window.__CRAFT_PROFILE__ = Object.freeze(${JSON.stringify(frameProfile(p))});\n`;

/** Hash of everything post-install derives from a profile (a change → `shim-outdated` → one re-prepare). */
export function profileHash(p: CraftAppProfile): string {
  return shortHash(JSON.stringify({ frame: frameProfile(p), ready: p.ready, workerTrampoline: p.workerTrampoline === true }));
}

const attr = (attrs: string, name: string): string | undefined => {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(attrs);
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
};

type ScriptKind = "classic" | "module";

/** Kind of an inline script element: executable kind, `data` (never executes), or throws on importmap. */
function inlineKind(attrs: string): ScriptKind | "data" {
  const type = attr(attrs, "type")?.trim().toLowerCase();
  if (type === undefined || type === "" || type === "text/javascript" || type === "application/javascript") return "classic";
  if (type === "module") return "module";
  if (type === "importmap") throw new Error("index.html carries an inline importmap; the frame CSP would block it");
  return "data";
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Regex of the hook point of a non-Trunk ready hook (whole statement, global). */
function hookPoint(ready: CraftAppProfile["ready"]): RegExp | null {
  if (ready.kind === "load-ready-ms") return new RegExp(`\\bwindow\\.${escapeRe(ready.global)}\\.readyMs\\s*=[^;\\n]*;`, "g");
  if (ready.kind === "after-start-call") return new RegExp(`(?<![\\w.$])${escapeRe(ready.call)}\\([^;\\n]*\\);`, "g");
  return null;
}

interface Inline {
  whole: string;
  kind: ScriptKind;
  body: string;
}

/** Inject the ready hook into the executable inline scripts (bodies rewritten in place). */
function injectReadyHook(scripts: Inline[], ready: CraftAppProfile["ready"]): void {
  const re = hookPoint(ready);
  if (!re) {
    const hits = scripts.reduce((n, s) => n + s.body.split(TRUNK_EVENT).length - 1, 0);
    if (hits !== 1) throw new Error(`expected exactly one inline Trunk bootstrap script in index.html, found ${hits} TrunkApplicationStarted dispatches`);
    return;
  }
  const hits = scripts.reduce((n, s) => n + (s.body.match(re)?.length ?? 0), 0);
  if (hits !== 1) throw new Error(`ready hook ${ready.kind} point matched ${hits} times in index.html, expected exactly once`);
  for (const s of scripts) s.body = s.body.replace(re, (stmt) => `${stmt}${DISPATCH}`);
}

/** Rewrite `index.html` and place the scripts. Returns without change when already marked identically. */
function injectShim(dir: string, shimSource: Buffer, shimVersion: number, profile: CraftAppProfile, workerSource: () => Buffer): string {
  const indexPath = path.join(dir, "index.html");
  const html = fs.readFileSync(indexPath, "utf8");
  const hash = profileHash(profile);
  const marked = MARKER_RE.exec(html);
  if (marked) {
    if (Number(marked[1]) !== shimVersion) throw new Error(`build already carries craft-shim ${marked[1]}, expected ${shimVersion}`);
    const prof = PROFILE_MARKER_RE.exec(html)?.[1];
    if (prof !== hash) throw new Error(`build already carries craft-profile ${prof ?? "none"}, expected ${hash}`);
    return hash;
  }
  const head = /<head\b[^>]*>/i.exec(html);
  if (!head) throw new Error("index.html has no <head>");

  const inline: Inline[] = [];
  for (const m of html.matchAll(SCRIPT_RE)) {
    if (attr(m[1], "src") !== undefined) continue;
    const kind = inlineKind(m[1]);
    if (kind !== "data") inline.push({ whole: m[0], kind, body: m[2] });
  }
  injectReadyHook(inline, profile.ready);

  let out = html;
  inline.forEach((s, n) => {
    const file = `inline-${n}-${shortHash(s.body)}.js`;
    fs.writeFileSync(path.join(dir, file), s.body);
    const tag = s.kind === "module" ? `<script type="module" src="./${file}" crossorigin="anonymous"></script>` : `<script src="./${file}" crossorigin="anonymous"></script>`;
    out = out.replace(s.whole, () => tag);
  });

  const lead: string[] = [`<!-- craft-shim:${shimVersion} -->`, `<!-- craft-profile:${hash} -->`];
  if (profile.workerTrampoline) {
    const src = workerSource();
    const file = `craft-worker-${shortHash(src)}.js`;
    fs.writeFileSync(path.join(dir, file), src);
    lead.push(`<script src="./${file}" crossorigin="anonymous"></script>`);
  }
  const profSrc = profileScript(profile);
  const profFile = `craft-profile-${shortHash(profSrc)}.js`;
  fs.writeFileSync(path.join(dir, profFile), profSrc);
  lead.push(`<script src="./${profFile}" crossorigin="anonymous"></script>`);
  const shimFile = `craft-shim-${shortHash(shimSource)}.js`;
  fs.writeFileSync(path.join(dir, shimFile), shimSource);
  lead.push(`<script src="./${shimFile}" crossorigin="anonymous"></script>`);

  const at = out.indexOf(head[0]) + head[0].length;
  fs.writeFileSync(indexPath, `${out.slice(0, at)}\n${lead.join("\n")}${out.slice(at)}`);
  return hash;
}

function walk(dir: string, visit: (file: string) => void): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs, visit);
    else if (e.isFile()) visit(abs);
  }
}

/** Write `.gz` siblings (level 9) and drop any `.br`; returns the client download size. */
async function compressAssets(dir: string): Promise<number> {
  const files: string[] = [];
  walk(dir, (f) => files.push(f));
  let size = 0;
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (ext === ".br") {
      fs.rmSync(file, { force: true });
      continue;
    }
    if (ext === ".gz" || path.basename(file) === BUILD_INFO_FILE) continue;
    if (GZIP_EXTS.has(ext)) {
      const packed = await gzip(fs.readFileSync(file), { level: 9 });
      fs.writeFileSync(`${file}.gz`, packed);
      size += packed.length;
    } else {
      size += fs.statSync(file).size;
    }
  }
  return size;
}

export interface PostInstallOptions {
  /** Profile lookup (default: the shipped profile table). */
  profile?: (app: string) => CraftAppProfile | undefined;
  workerSourcePath?: string;
}

/** Build the `postInstall` hook handed to `provisionWeb`. */
export function createPostInstall(shimSourcePath: string = SHIM_SOURCE_PATH, opts: PostInstallOptions = {}): (ctx: WebPostInstallContext) => Promise<void> {
  const lookup = opts.profile ?? profileFor;
  const workerPath = opts.workerSourcePath ?? WORKER_SOURCE_PATH;
  return async ({ dir, app, version, shimVersion }) => {
    const profile = lookup(app);
    if (!profile) throw new Error(`${app} has no craft-web adapter profile`);
    const hash = injectShim(dir, fs.readFileSync(shimSourcePath), shimVersion, profile, () => fs.readFileSync(workerPath));
    const sizeGzip = await compressAssets(dir);
    const info: CraftBuildInfo = { app, version, shimVersion, profileHash: hash, sizeGzip };
    fs.writeFileSync(path.join(dir, BUILD_INFO_FILE), `${JSON.stringify(info)}\n`);
  };
}

/** Read `craft-build.json` of an installed tree (`null` when absent or malformed). */
export function readBuildInfo(dir: string): CraftBuildInfo | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, BUILD_INFO_FILE), "utf8")) as Partial<CraftBuildInfo>;
    if (
      typeof raw.app === "string" &&
      typeof raw.version === "string" &&
      Number.isInteger(raw.shimVersion) &&
      typeof raw.sizeGzip === "number" &&
      (raw.profileHash === undefined || typeof raw.profileHash === "string")
    ) {
      return raw as CraftBuildInfo;
    }
  } catch {
    /* absent or malformed */
  }
  return null;
}
