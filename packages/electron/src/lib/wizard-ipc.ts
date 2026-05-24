/**
 * IPC handlers for the first-run wizard.
 *
 * Under the immutable-bundle architecture (see change:
 * eliminate-electron-runtime-install), the wizard no longer installs or
 * configures anything — every dependency ships inside the .app bundle.
 *
 * This module now exposes only:
 *   wizard:complete       — write the first-run-done marker
 *   wizard:open-doctor    — open the Doctor diagnostic window
 *
 * The legacy install / detection / installable-list / recommended-extensions
 * IPCs are deleted; the matching wizard renderer is rewritten in Phase 6.1
 * (task pending under the same change). Until then, the existing wizard
 * renderer's calls to removed methods will fail gracefully because the
 * channels are simply absent.
 */
import { ipcMain, type BrowserWindow } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getFirstRunMarkerPath } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";

/**
 * Mark first run as complete by writing
 * `~/.pi/dashboard/first-run-done`. Idempotent — overwrites are harmless.
 */
export function writeFirstRunMarker(): void {
  const markerPath = getFirstRunMarkerPath();
  mkdirSync(path.dirname(markerPath), { recursive: true });
  writeFileSync(markerPath, new Date().toISOString() + "\n");
}

/**
 * Register the slim wizard IPC handlers. Call once from main.ts.
 *
 * `getWizardWindow` retained in the signature for forward-compat with the
 * Phase 6.1 wizard rewrite; currently unused.
 */
export function registerWizardIpc(
  _getWizardWindow: () => BrowserWindow | null,
): void {
  ipcMain.handle("wizard:complete", async () => {
    writeFirstRunMarker();
  });
}
