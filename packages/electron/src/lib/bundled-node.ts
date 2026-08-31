/**
 * Resolves paths to the bundled Node.js runtime in Electron's extraResources.
 * The bundled Node is used as a fallback when system Node is not available.
 *
 * Layout in packaged app:
 *   <app>/resources/node/bin/node       (macOS/Linux)
 *   <app>/resources/node/node.exe       (Windows)
 *   <app>/resources/node/lib/node_modules/npm/bin/npm-cli.js
 */
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Detect whether we're running in a packaged Electron app. */
function isPackaged(): boolean {
  // In packaged apps, app.isPackaged is true and __dirname is inside the asar
  return typeof process !== "undefined" && (process as any).resourcesPath !== undefined;
}

/** Get the resources path (works in both packaged and dev). */
export function getResourcesPath(): string {
  // In packaged app: process.resourcesPath = <app>/Contents/Resources (macOS)
  if ((process as any).resourcesPath) {
    return (process as any).resourcesPath;
  }
  // In dev: relative to this file → packages/electron/src/lib/ → project root → resources/
  return path.resolve(__dirname, "..", "..", "..", "..", "resources");
}

/**
 * Returns the absolute path to the bundled Node.js binary, or null if not present.
 */
export function getBundledNodePath(): string | null {
  const resources = getResourcesPath();

  if (process.platform === "win32") {
    const p = path.join(resources, "node", "node.exe");
    return existsSync(p) ? p : null;
  }

  const p = path.join(resources, "node", "bin", "node");
  return existsSync(p) ? p : null;
}

/**
 * Returns the bundled Node.js installation **directory** (the dir laid out as
 * the upstream Node distribution), or null if not present.
 *
 * Both layouts share `<resources>/node` as the dir pickNodeForServer expects:
 *   POSIX  : <resources>/node/bin/node
 *   Windows: <resources>/node/node.exe
 *
 * Callers MUST prefer this helper over computing the dir via
 * `path.dirname(path.dirname(getBundledNodePath()))` — the dirname-arithmetic
 * is Linux-only (Windows `node.exe` is one segment shallower) and silently
 * resolved to `<resources>` on Windows, making `pickNodeForServer` fall through
 * to `execpath-fallback` and producing the pre-fix `code=0` symptom.
 */
export function getBundledNodeDir(): string | null {
  return getBundledNodePath() ? path.join(getResourcesPath(), "node") : null;
}

/**
 * Returns the absolute path to the bundled npm CLI script, or null if not present.
 */
export function getBundledNpmPath(): string | null {
  const resources = getResourcesPath();
  // Unix layout: node/lib/node_modules/npm/bin/npm-cli.js
  // Windows layout: node/node_modules/npm/bin/npm-cli.js
  const candidates = [
    path.join(resources, "node", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(resources, "node", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}
