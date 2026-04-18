/**
 * Resolve the jiti register hook from pi's process context.
 *
 * The bridge extension runs inside pi's Node.js process. process.argv[1]
 * points to pi's CLI entry (e.g., pi-coding-agent/dist/cli.js). Since
 * jiti is a dependency of pi-coding-agent, createRequire(process.argv[1])
 * can resolve it directly.
 */

import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const JITI_PACKAGES = [
  "@mariozechner/jiti",
  "@oh-my-pi/jiti",
];

/**
 * Pure helper: given a jiti package.json path, return the file:// URL of
 * its register hook. Exported for testing — no I/O.
 *
 * Returns a file:// URL (not a raw path) because Node >= 20 on Windows
 * rejects raw absolute paths with a drive letter for --import (parses
 * "C:" / "B:" as a URL scheme → ERR_UNSUPPORTED_ESM_URL_SCHEME). file://
 * URLs are accepted on every OS.
 * See change: fix-windows-server-parity.
 */
export function buildJitiRegisterUrl(pkgJsonPath: string): string {
  const registerPath = path.join(path.dirname(pkgJsonPath), "lib", "jiti-register.mjs");
  return pathToFileURL(registerPath).href;
}

/**
 * Returns jiti's register hook as a file:// URL suitable for `node --import`.
 * Uses process.argv[1] (pi's entry point) to anchor module resolution.
 *
 * The return value is ALWAYS a file:// URL (never a raw path). See
 * buildJitiRegisterUrl for the URL contract rationale.
 */
export function resolveJitiImport(): string {
  const anchor = process.argv[1];
  if (anchor) {
    try {
      // Resolve symlinks — process.argv[1] may be a symlink (e.g., bin/pi → dist/cli.js)
      const resolved = realpathSync(anchor);
      const req = createRequire(resolved);
      for (const jiti of JITI_PACKAGES) {
        try {
          const pkgJson = req.resolve(`${jiti}/package.json`);
          return buildJitiRegisterUrl(pkgJson);
        } catch { /* next */ }
      }
    } catch { /* fall through */ }
  }

  throw new Error(
    "Cannot find pi's TypeScript loader (jiti). " +
    "Is @mariozechner/pi-coding-agent or @oh-my-pi/pi-coding-agent installed?"
  );
}
