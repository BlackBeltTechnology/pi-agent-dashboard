/**
 * Re-relativize symlinks that @electron/packager >= 20 makes absolute when it
 * copies `extraResource` entries.
 *
 * Why this exists: packager's `copyExtraResources` (platform.js) copies each
 * entry with `fs.promises.cp(src, dest, { recursive: true })` and NO
 * `verbatimSymlinks`. Node's `fs.cp` then rewrites every RELATIVE symlink to an
 * ABSOLUTE path under the SOURCE tree (the build host). The packaged app ends up
 * with dangling `server/node_modules/.bin/*` and `node/bin/npm` links, and
 * `codesign --verify --strict` rejects the bundle with
 * `invalid destination for symbolic link in bundle`.
 *
 * The fix runs as `packagerConfig.afterCopyExtraResources` (after ALL entries are
 * copied, so cross-resource targets exist). It is generic on purpose: it is
 * driven by the `extraResource` list, never by a hard-coded name list, so later
 * resources (a bundled Python venv, a codegraph binary) are covered unchanged.
 *
 * Rules:
 *  - Only an ABSOLUTE link whose target lies inside the SOURCE of ANY
 *    `extraResource` entry is rewritten, to a relative link to the same path
 *    inside that entry's copy. A link from one resource into another is covered.
 *  - Source paths are compared as given AND by real path (`/tmp` is
 *    `/private/tmp` on macOS), for the target and for the entry.
 *  - Links pointing anywhere else are left untouched. The packaged-app scan
 *    (scan-packaged-symlinks.mjs) is what reports those.
 *  - File entries (e.g. `app-update.yml`) are valid link targets but are not walked.
 *
 * Upstream: electron/packager `copyExtraResources` (platform.js) copies without
 * `verbatimSymlinks`, while its own `move()` fallback passes `verbatimSymlinks:
 * true`. The same defect in `copyTemplate()` is open as electron/packager#1964
 * (`fix: preserve relative symlink targets`); that PR does NOT touch
 * `copyExtraResources`. An upstream issue for the extra-resource copy is still to
 * be filed (task 4.3 of this change); drop this hook once packager fixes it.
 *
 * See change: refresh-electron-bundled-components (design D3).
 */
import fs from "node:fs";
import path from "node:path";

const realpathOrSelf = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
};

/** True when `child` equals `parent` or lies below it (path-segment aware). */
function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Resources directory packager copied the entries into.
 * darwin/mas: `<buildPath>/<App>.app/Contents/Resources`; others:
 * `<buildPath>/resources`.
 */
export function resourcesDirFor(buildPath, platform) {
  if (platform === "darwin" || platform === "mas") {
    const app = fs
      .readdirSync(buildPath)
      .find((name) => name.endsWith(".app") && fs.statSync(path.join(buildPath, name)).isDirectory());
    if (!app) throw new Error(`no .app bundle under ${buildPath}`);
    return path.join(buildPath, app, "Contents", "Resources");
  }
  return path.join(buildPath, "resources");
}

/**
 * Source → destination map for the string entries of `extraResource`.
 * Packager places each entry at `<resourcesDir>/<basename(entry)>` and accepts
 * only string entries, so the mapping is unambiguous. Entries missing on disk
 * are skipped (packager would have failed on them already).
 *
 * @param {string | string[] | undefined} extraResource
 * @param {string} projectDir  directory the entries are relative to (the Forge project dir, NOT cwd)
 * @param {string} resourcesDir
 * @returns {{ sources: string[], dest: string, isDirectory: boolean }[]}
 */
export function mapExtraResources(extraResource, projectDir, resourcesDir) {
  const list = extraResource == null ? [] : Array.isArray(extraResource) ? extraResource : [extraResource];
  const out = [];
  for (const entry of list) {
    if (typeof entry !== "string") continue;
    const abs = path.resolve(projectDir, entry);
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue;
    }
    const real = realpathOrSelf(abs);
    out.push({
      sources: real === abs ? [abs] : [abs, real],
      dest: path.join(resourcesDir, path.basename(abs)),
      isDirectory: stat.isDirectory(),
    });
  }
  return out;
}

/** Every symlink path below `dir` (lstat-based: links are never followed). */
function* walkSymlinks(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) yield full;
    else if (entry.isDirectory()) yield* walkSymlinks(full);
  }
}

/**
 * Relative link target for an absolute `target`, or null when it lies inside no
 * entry's source. Compares the target as recorded and by real path, against each
 * entry's source as given and by real path.
 */
function relativeTargetFor(link, target, entries) {
  const candidates = [target, realpathOrSelf(target)];
  for (const entry of entries) {
    for (const source of entry.sources) {
      const hit = candidates.find((c) => isInside(c, source));
      if (hit === undefined) continue;
      return path.relative(path.dirname(link), path.join(entry.dest, path.relative(source, hit))) || ".";
    }
  }
  return null;
}

/**
 * Rewrite every absolute link inside a copied directory entry that targets the
 * source of any entry, to a relative link inside the copies.
 *
 * @param {{ resourcesDir: string, extraResource: string | string[] | undefined, projectDir: string }} args
 * @returns {{ link: string, from: string, to: string }[]} the rewritten links
 */
export function relativizeExtraResourceLinks({ resourcesDir, extraResource, projectDir }) {
  const entries = mapExtraResources(extraResource, projectDir, resourcesDir);
  const rewritten = [];

  for (const walked of entries) {
    if (!walked.isDirectory || !fs.existsSync(walked.dest)) continue;
    for (const link of walkSymlinks(walked.dest)) {
      const target = fs.readlinkSync(link);
      if (!path.isAbsolute(target)) continue;
      const newTarget = relativeTargetFor(link, target, entries);
      if (newTarget === null) continue;

      fs.unlinkSync(link);
      fs.symlinkSync(newTarget, link);
      rewritten.push({ link, from: target, to: newTarget });
    }
  }
  return rewritten;
}

/**
 * Build the `afterCopyExtraResources` hook. Uses @electron/packager >= 19's
 * single-object signature (`{ buildPath, platform, ... }`); the positional
 * `(buildPath, electronVersion, platform, arch, callback)` form is packager 18.
 *
 * @param {{ projectDir: string, getExtraResources: () => string | string[] | undefined }} args
 *   `getExtraResources` is read at hook time so the hook always sees the final list.
 */
export function createAfterCopyExtraResources({ projectDir, getExtraResources }) {
  return async ({ buildPath, platform }) => {
    const resourcesDir = resourcesDirFor(buildPath, platform);
    const rewritten = relativizeExtraResourceLinks({
      resourcesDir,
      extraResource: getExtraResources(),
      projectDir,
    });
    console.log(`[relativize-extra-resource-links] rewrote ${rewritten.length} absolute link(s) in ${resourcesDir}`);
  };
}
