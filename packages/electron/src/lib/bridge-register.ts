/**
 * Register the bundled bridge extension in pi's settings.json.
 * Thin wrapper around the shared bridge-register module,
 * with Electron-specific logic for locating the extension.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerBridgeExtension } from "@blackbelt-technology/pi-dashboard-shared/bridge-register.js";
import { getBundledExtensionDir } from "./runtime-overlay.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Find the bundled extension directory — `<resources>/server/node_modules/@blackbelt-technology/pi-dashboard-extension`
 *  (the workspace source ships once, under node_modules; `server/packages/<dir>` is gone).
 *  - macOS: /Applications/PI Dashboard.app/Contents/Resources/server/node_modules/@blackbelt-technology/pi-dashboard-extension
 *  - Linux (deb/rpm): /usr/lib/pi-dashboard/resources/server/node_modules/@blackbelt-technology/pi-dashboard-extension
 *  - Linux (AppImage): /tmp/.mount_PIxxxx/... (rejected — unstable!)
 *  - Windows (NSIS per-user): %LOCALAPPDATA%\Programs\PI Dashboard\resources\server\node_modules\@blackbelt-technology\pi-dashboard-extension
 *  - Windows (.zip): <extracted dir>\PI-Dashboard-win32-<arch>\resources\server\node_modules\@blackbelt-technology\pi-dashboard-extension
 *    (resolved dynamically via process.resourcesPath — never hardcoded)
 * A stale `…/server/packages/extension` registration from an older install is dropped by
 * `registerBridgeExtension`. See change: slim-windows-install-file-count (D2).
 *
 * `resourcesPath` / `devCandidate` are injectable for tests.
 */
export function findBundledExtension(
  resourcesPath: string | undefined = (process as any).resourcesPath,
  devCandidate: string = path.resolve(__dirname, "..", "..", "..", "extension"),
): string | null {
  // Packaged app: use Electron's resourcesPath
  if (resourcesPath) {
    const candidate = getBundledExtensionDir(resourcesPath);
    if (existsSync(candidate) && existsSync(path.join(candidate, "package.json"))) {
      if (candidate.includes("/tmp/.mount_")) {
        console.warn("[bridge-register] AppImage detected — extension path is temporary. Use 'Install global package' instead.");
        return null;
      }
      return candidate;
    }
  }

  // Dev: relative to packages/electron/src/lib/ → ../../../extension/
  if (existsSync(devCandidate) && existsSync(path.join(devCandidate, "package.json"))) {
    return devCandidate;
  }

  return null;
}

/**
 * Register the bundled bridge extension in ~/.pi/agent/settings.json.
 * Throws if no bundled extension is found.
 */
export function registerBundledBridgeExtension(): void {
  const extPath = findBundledExtension();
  if (!extPath) {
    throw new Error("Bundled extension not found. Try installing the global package instead.");
  }
  registerBridgeExtension(extPath);
}
