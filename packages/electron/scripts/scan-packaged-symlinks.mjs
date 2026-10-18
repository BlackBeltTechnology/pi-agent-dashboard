#!/usr/bin/env node
/**
 * Guard: scan a PACKAGED app for symlinks that would break the bundle.
 *
 * Fails on any symlink below `scanDir` that is
 *   - absolute            (build-host path baked in; not relocatable),
 *   - dangling            (target missing, or a loop), or
 *   - resolves outside the packaged app root (a relative `../../` escape).
 *
 * Companion of relativize-extra-resource-links.mjs: that hook fixes the links
 * @electron/packager >= 20 makes absolute; this scan proves it did, on every
 * electron leg (darwin, linux, win32), and also catches resource kinds the hook
 * cannot fix (a link to an absolute path OUTSIDE every copied resource).
 *
 * Usage: node scan-packaged-symlinks.mjs <scanDir> [appRoot]
 *   scanDir  the packaged resources directory (e.g. `<App>.app/Contents/Resources`
 *            or `<out>/<App>-linux-x64/resources`)
 *   appRoot  the packaged app root links must stay inside (default: scanDir)
 * Exit 0 clean; 1 violations (listed on stderr as `::error::` lines); 2 usage.
 *
 * See change: refresh-electron-bundled-components (design D7).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const realpathOrNull = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
};

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) yield full;
    else if (entry.isDirectory()) yield* walk(full);
  }
}

/**
 * @param {{ scanDir: string, appRoot?: string }} args
 * @returns {{ link: string, target: string, reason: "absolute" | "dangling" | "escapes-app-root" }[]}
 */
export function scanPackagedSymlinks({ scanDir, appRoot = scanDir }) {
  const rootReal = realpathOrNull(appRoot) ?? appRoot;
  const problems = [];
  for (const link of walk(scanDir)) {
    const target = fs.readlinkSync(link);
    if (path.isAbsolute(target)) {
      problems.push({ link, target, reason: "absolute" });
      continue;
    }
    const resolved = realpathOrNull(link);
    if (resolved === null) {
      problems.push({ link, target, reason: "dangling" });
    } else if (!isInside(resolved, rootReal)) {
      problems.push({ link, target, reason: "escapes-app-root" });
    }
  }
  return problems;
}

function main(argv) {
  const [scanDir, appRoot] = argv;
  if (!scanDir || !fs.existsSync(scanDir)) {
    console.error("usage: scan-packaged-symlinks.mjs <scanDir> [appRoot]  (scanDir must exist)");
    return 2;
  }
  const problems = scanPackagedSymlinks({ scanDir, appRoot: appRoot ?? scanDir });
  if (problems.length === 0) {
    console.log(`scan-packaged-symlinks: OK — no absolute, dangling or root-escaping link under ${scanDir}`);
    return 0;
  }
  for (const p of problems) {
    console.error(`::error::symlink ${p.reason}: ${path.relative(scanDir, p.link)} -> ${p.target}`);
  }
  console.error(`scan-packaged-symlinks: ${problems.length} bad link(s) under ${scanDir}`);
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
