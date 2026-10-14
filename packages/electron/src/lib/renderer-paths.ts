/**
 * Resolve the bundled wizard preload and `renderer/*.html` pages (dev tree,
 * forge dev build, and packaged `resourcesPath`). Shared by the remote-connect
 * and connecting windows. Imports nothing from electron.
 *
 * See change: add-electron-server-windows.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** The wizard preload bundle (doctor + remote-connect + connecting bridges; trusted `file://` pages only). */
export function getWizardPreloadPath(): string {
  const packaged = path.join(__dirname, "preload.js");
  if (existsSync(packaged)) return packaged;
  const forgeDev = path.join(process.cwd(), ".vite", "build", "preload.js");
  if (existsSync(forgeDev)) return forgeDev;
  return packaged;
}

/** Absolute path of a bundled renderer page, e.g. `connecting.html`. */
export function getRendererHtmlPath(name: string): string {
  let p = path.join(__dirname, "..", "renderer", name);
  if (!existsSync(p) && (process as { resourcesPath?: string }).resourcesPath) {
    p = path.join((process as { resourcesPath: string }).resourcesPath, "renderer", name);
  }
  return p;
}
