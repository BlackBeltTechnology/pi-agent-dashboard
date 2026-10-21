#!/usr/bin/env node
/**
 * Post-bundle assertion for release-lock builds: the bundle MUST record that it
 * was installed from X's runtime lock. Run by `_electron-build.yml` whenever its
 * `release_lock` input is true, so a release whose bundle step silently floated
 * (flag dropped, empty version) fails the build instead of shipping.
 *
 *   node packages/electron/scripts/assert-release-lock-bundle.mjs <bundleDir> [<version>]   (version defaults to $RELEASE_VERSION)
 *
 * Exits non-zero naming the failing field of `<bundleDir>/runtime-manifest.json`.
 *
 * See change: pin-electron-bundle-dependency-tree (design D1).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Returns an error message, or null when the manifest proves a release-lock install of `version`. */
export function checkReleaseLockBundle(bundleDir, version) {
  if (!version) return "no release version given";
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path.join(bundleDir, "runtime-manifest.json"), "utf8"));
  } catch (err) {
    return `runtime-manifest.json unreadable in ${bundleDir}: ${err instanceof Error ? err.message : String(err)}`;
  }
  if (manifest.installMode !== "release-lock") {
    return `runtime-manifest.json installMode is ${JSON.stringify(manifest.installMode)}, expected "release-lock"`;
  }
  if (manifest.lockVersion !== version) {
    return `runtime-manifest.json lockVersion is ${JSON.stringify(manifest.lockVersion)}, expected ${JSON.stringify(version)}`;
  }
  return null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // The version comes from argv, else $RELEASE_VERSION (the workflow passes it
  // through env, never interpolated into the shell command).
  const [bundleDir, argVersion] = process.argv.slice(2);
  const version = argVersion ?? process.env.RELEASE_VERSION ?? "";
  const problem = checkReleaseLockBundle(bundleDir ?? "", version);
  if (problem) {
    console.error(`::error::release-lock bundle assertion failed: ${problem}`);
    process.exit(1);
  }
  console.log(`release-lock bundle OK: installMode=release-lock lockVersion=${version}`);
}
