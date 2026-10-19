/**
 * `provisionWeb` post-install hook: turns a freshly extracted Trunk/eframe web build into the tree the
 * `serveApp` mount serves under a script-hash-free CSP.
 *
 *  1. moves the inline module bootstrap (the only inline script) into `bootstrap-<hash>.js`;
 *  2. copies the shim as `craft-shim-<hash>.js` and loads it, as a classic script, BEFORE the bootstrap;
 *  3. marks the document `<!-- craft-shim:<shimVersion> -->` (idempotent: a rerun changes nothing);
 *  4. writes `.gz` siblings for `.wasm/.js/.html/.css` (never `.br`: brotli is truncated by zrok);
 *  5. writes `craft-build.json {app, version, shimVersion, sizeGzip}` (read by `status`).
 *
 * After it, no inline script remains and every non-`index.html` asset is content-hashed, so the CSP needs
 * no per-build hash and immutable caching is correct.
 *
 * See change: edit-office-in-pane-with-craft-web (D2, task 4.1).
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";
import type { WebPostInstallContext } from "@blackbelt-technology/pi-dashboard-craft-apps/provision.js";
import { SHIM_SOURCE_PATH } from "./shim.js";

const gzip = promisify(zlib.gzip);

export const BUILD_INFO_FILE = "craft-build.json";
const GZIP_EXTS = new Set([".wasm", ".js", ".html", ".css"]);
const MARKER_RE = /<!-- craft-shim:(\d+) -->/;
const INLINE_MODULE_RE = /<script\b(?![^>]*\bsrc\s*=)[^>]*\btype\s*=\s*["']module["'][^>]*>([\s\S]*?)<\/script>/gi;

/** `craft-build.json` of an installed tree. */
export interface CraftBuildInfo {
  app: string;
  version: string;
  shimVersion: number;
  /** Bytes a client downloads for the whole build (gzip variants where they exist). */
  sizeGzip: number;
}

const shortHash = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex").slice(0, 10);

/** Rewrite `index.html` (shim + external bootstrap) and place the two files. Returns without change when already marked. */
function injectShim(dir: string, shimSource: Buffer, shimVersion: number): void {
  const indexPath = path.join(dir, "index.html");
  const html = fs.readFileSync(indexPath, "utf8");
  const marked = MARKER_RE.exec(html);
  if (marked) {
    if (Number(marked[1]) !== shimVersion) throw new Error(`build already carries craft-shim ${marked[1]}, expected ${shimVersion}`);
    return;
  }
  const inline = [...html.matchAll(INLINE_MODULE_RE)].filter((m) => m[1].includes("TrunkApplicationStarted"));
  if (inline.length !== 1) {
    throw new Error(`expected exactly one inline Trunk bootstrap script in index.html, found ${inline.length}`);
  }
  const [whole, bootstrap] = inline[0];
  const bootstrapFile = `bootstrap-${shortHash(bootstrap)}.js`;
  const shimFile = `craft-shim-${shortHash(shimSource)}.js`;
  fs.writeFileSync(path.join(dir, bootstrapFile), bootstrap);
  fs.writeFileSync(path.join(dir, shimFile), shimSource);
  const tags =
    `<!-- craft-shim:${shimVersion} -->\n` +
    `<script src="./${shimFile}" crossorigin="anonymous"></script>\n` +
    `<script type="module" src="./${bootstrapFile}" crossorigin="anonymous"></script>`;
  fs.writeFileSync(indexPath, html.replace(whole, () => tags));
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

/** Build the `postInstall` hook handed to `provisionWeb`. */
export function createPostInstall(shimSourcePath: string = SHIM_SOURCE_PATH): (ctx: WebPostInstallContext) => Promise<void> {
  return async ({ dir, app, version, shimVersion }) => {
    injectShim(dir, fs.readFileSync(shimSourcePath), shimVersion);
    const sizeGzip = await compressAssets(dir);
    const info: CraftBuildInfo = { app, version, shimVersion, sizeGzip };
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
      typeof raw.sizeGzip === "number"
    ) {
      return raw as CraftBuildInfo;
    }
  } catch {
    /* absent or malformed */
  }
  return null;
}
