#!/usr/bin/env node
/**
 * CI wrapper: inject `minimumSystemVersion` into the EMITTED `latest-mac.yml`.
 *
 * Usage:  node scripts/inject-update-min-system-version.mjs <latest-mac.yml>
 *
 * Why this exists as a post-build step rather than an `electron-builder.yml`
 * key: `mac.minimumSystemVersion` never reaches update metadata.
 * `app-builder-lib`'s update-info builder does not write the field at all, and
 * its only consumer (`macPackager`) is skipped entirely under the
 * `--prepackaged` invocation this pipeline uses. Setting the config key would
 * be a plausible-looking no-op. See design.md Decision 5, Trap 2.
 *
 * macOS ONLY. `checkIfUpdateSupported` applies no platform guard, so the same
 * field in `latest-linux.yml` / `latest.yml` would compare a Linux kernel
 * (`6.5.0`) or a Windows version (`10.0.19045`) against the Darwin value and
 * deny updates to EVERY client on those platforms — a fail-CLOSED hazard.
 * This script refuses any file that is not `latest-mac.yml`.
 *
 * The edit is line-based rather than a YAML round-trip: the field is a plain
 * root scalar, and re-serialising the document would needlessly churn the
 * sha512/files block electron-builder just wrote.
 *
 * See change: upgrade-electron-runtime.
 */
import fs from "node:fs";
import path from "node:path";
import { UPDATE_MINIMUM_SYSTEM_VERSION } from "./macos-floor.mjs";

const target = process.argv[2];

if (!target) {
  console.error(
    "::error::inject-update-min-system-version.mjs: no latest-mac.yml path given",
  );
  process.exit(1);
}

if (path.basename(target) !== "latest-mac.yml") {
  console.error(
    `::error::Refusing to inject minimumSystemVersion into '${path.basename(target)}'. ` +
      "The gate has no platform guard in electron-updater, so injecting it anywhere but " +
      "latest-mac.yml denies updates to every client on that platform.",
  );
  process.exit(1);
}

if (!fs.existsSync(target)) {
  console.error(`::error::${target} not found — nothing to inject into`);
  process.exit(1);
}

const original = fs.readFileSync(target, "utf8");
const line = `minimumSystemVersion: ${UPDATE_MINIMUM_SYSTEM_VERSION}`;
const existing = /^minimumSystemVersion:.*$/m;

const updated = existing.test(original)
  ? original.replace(existing, line)
  : `${original.replace(/\n*$/, "\n")}${line}\n`;

fs.writeFileSync(target, updated);
console.log(`✓ ${target}: ${line}`);
