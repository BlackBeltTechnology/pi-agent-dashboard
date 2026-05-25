/**
 * Re-export shim — implementation lives in shared so the dashboard
 * server can call it without depending on the electron package.
 *
 * See change: fix-windows-path-system32-missing.
 */
export { ensureWindowsSystemPath } from "@blackbelt-technology/pi-dashboard-shared/platform/ensure-windows-path.js";
export type { EnsureWindowsSystemPathOpts } from "@blackbelt-technology/pi-dashboard-shared/platform/ensure-windows-path.js";
