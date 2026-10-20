/**
 * Archive-member safety checks shared by the overlay stager
 * (`packages/server/src/runtime-overlay/runtime-io.ts`) and the release-lock
 * bundle fetch (`packages/electron/scripts/lib/release-lock.mjs`).
 *
 * Plain ESM (the bundle script runs under plain Node). Pure: callers list the
 * archive (`tar -tzf`, `tar -tvzf`) and pass the output in.
 *
 * See change: pin-electron-bundle-dependency-tree (D2).
 */
import path from "node:path";

/**
 * Throw `unsafe_archive …` when a listed member is absolute, climbs out
 * (`..`), or when the verbose listing contains a link entry (a link could
 * point out of the staging dir and a later member write through it).
 * Returns the member names.
 *
 * @param {string} namesOutput  stdout of `tar -tzf <tgz>`
 * @param {string} verboseOutput  stdout of `tar -tvzf <tgz>` (starts each line with the entry type)
 * @returns {string[]}
 */
export function assertSafeArchiveListing(namesOutput, verboseOutput) {
  const names = String(namesOutput).split(/\r?\n/).filter(Boolean);
  for (const name of names) {
    if (path.isAbsolute(name) || /^[a-zA-Z]:/.test(name) || name.startsWith("\\") || name.split(/[\\/]/).includes("..")) {
      throw new Error(`unsafe_archive member ${JSON.stringify(name)}`);
    }
  }
  const link = String(verboseOutput).split(/\r?\n/).find((line) => /^[lh]/.test(line));
  if (link) throw new Error(`unsafe_archive link member ${JSON.stringify(link.trim())}`);
  return names;
}
