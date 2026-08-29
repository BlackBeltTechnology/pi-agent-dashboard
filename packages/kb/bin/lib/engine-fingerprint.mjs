// Engine fingerprint for @blackbelt-technology/pi-dashboard-kb (design D1,
// change fix-kb-eval-measurement-integrity). ONE shared, dependency-free
// module: `npm run build` writes the committed engine-fingerprint.json with it,
// the bin shim (bin/kb.mjs) re-checks staleness with it, and the CI freshness
// gate (scripts/check-kb-dist-fresh.mjs) recomputes with it — no three-way
// reimplementation.
//
// Three hashes:
//   srcHash      — LF-normalized contents of src/**/*.ts minus src/__tests__,
//                  sorted relative paths (a src edit without a rebuild forks
//                  the hash → observable in CI).
//   tsconfigHash — LF-normalized contents of the tsconfig extends chain (a
//                  compilerOptions change alters emit without changing src).
//   distHash     — the emitted dist/** (proves the dist on disk is a complete
//                  emit, catching fresh-src-over-stale-dist from an interrupted
//                  build).
// LF normalization because the repo has no .gitattributes and CI runs Windows
// jobs where autocrlf would otherwise fork the hash.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LF = (s) => s.replace(/\r\n/g, "\n");

/** Recursively collect files under `dir` (posix relative paths, sorted). */
function walk(dir, prefix = "") {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(join(dir, e.name), rel));
    else if (e.isFile()) out.push(rel);
  }
  return out.sort();
}

function hashFiles(pkgRoot, rels) {
  const h = createHash("sha256");
  for (const rel of rels) {
    h.update(rel);
    h.update("\u0000");
    h.update(LF(readFileSync(join(pkgRoot, rel), "utf8")));
    h.update("\u0001");
  }
  return h.digest("hex");
}

/** All .ts under src/, excluding any __tests__ dir (and this bin lib — plain
 *  JS, never matched). Sorted by path so creation order cannot fork the hash. */
export function computeSrcHash(pkgRoot) {
  const srcDir = join(pkgRoot, "src");
  const rels = walk(srcDir)
    .filter((rel) => rel.endsWith(".ts") && !rel.split("/").includes("__tests__"))
    .map((rel) => `src/${rel}`);
  return hashFiles(pkgRoot, rels);
}

/** The tsconfig extends chain (root first, then each resolved extends target).
 *  Only relative extends targets are followed — a package-spec extends target
 *  cannot resolve reliably without a module resolver and this package has none. */
export function tsconfigChain(pkgRoot) {
  const chain = [];
  let cur = join(pkgRoot, "tsconfig.json");
  const seen = new Set();
  while (existsSync(cur) && !seen.has(cur)) {
    seen.add(cur);
    chain.push(cur);
    let raw;
    try {
      raw = readFileSync(cur, "utf8");
    } catch {
      break;
    }
    let m;
    try {
      // Tolerant JSONC parse: comments AND trailing commas are legal in
      // tsconfig files; a hard parse failure must not silently truncate the
      // extends chain (a base-config change would then miss the hash).
      m = JSON.parse(raw.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/,([\s\n\r]*[}\]])/g, "$1"));
    } catch {
      break; // unparseable config: hash what exists, stop following
    }
    const ext = m && m.extends;
    if (typeof ext !== "string" || ext.startsWith("$")) break;
    cur = resolve(dirname(cur), ext);
    if (!cur.endsWith(".json")) cur += ".json";
  }
  return chain;
}

/** null = no tsconfig at the package root (the installed-tarball shape). */
export function computeTsconfigHash(pkgRoot) {
  const chain = tsconfigChain(pkgRoot);
  if (!chain.length) return null;
  return hashFiles(pkgRoot, chain.map((p) => relative(pkgRoot, p)));
}

/** null = no dist on disk. */
export function computeDistHash(pkgRoot) {
  const distDir = join(pkgRoot, "dist");
  if (!existsSync(distDir)) return null;
  return hashFiles(pkgRoot, walk(distDir).map((rel) => `dist/${rel}`));
}

export function fingerprintPackage(pkgRoot) {
  return {
    srcHash: computeSrcHash(pkgRoot),
    tsconfigHash: computeTsconfigHash(pkgRoot),
    distHash: computeDistHash(pkgRoot),
  };
}

export const FINGERPRINT_FILE = "engine-fingerprint.json";

/** Sentinel returned by readCommittedFingerprint when the file exists but is
 *  not valid JSON — distinct from missing, so consumers can FAIL CLOSED
 *  (unparseable JSON must never look like a clean fingerprint). */
export const FINGERPRINT_MALFORMED = { malformed: true };

export function readCommittedFingerprint(pkgRoot) {
  const p = join(pkgRoot, FINGERPRINT_FILE);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return FINGERPRINT_MALFORMED; // unparseable JSON fails closed, never null-as-missing
  }
}

/** Compute + write engine-fingerprint.json (committed; npm `files` ships it). */
export function writeFingerprint(pkgRoot) {
  const fp = fingerprintPackage(pkgRoot);
  writeFileSync(join(pkgRoot, FINGERPRINT_FILE), JSON.stringify(fp, null, 2) + "\n");
  return fp;
}

// CLI mode (used by `npm run build` and the sandbox tests):
//   node bin/lib/engine-fingerprint.mjs [--write] [pkgRoot=.]
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const pkgRoot = resolve(args[0] ?? ".");
  if (process.argv.includes("--write")) {
    const fp = writeFingerprint(pkgRoot);
    console.log(`wrote ${join(pkgRoot, FINGERPRINT_FILE)}`);
    console.log(JSON.stringify(fp));
  } else {
    console.log(JSON.stringify(fingerprintPackage(pkgRoot)));
  }
}
