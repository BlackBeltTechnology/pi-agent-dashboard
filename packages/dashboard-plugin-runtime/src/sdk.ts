/**
 * `@blackbelt-technology/dashboard-plugin-runtime/sdk` — pure helpers a plugin
 * BUNDLES into its own build (design D6). Side-effect-free: no React, no module
 * state, no runtime context.
 *
 * Deliberately absent: `PLUGIN_HOST_API_VERSION` and `satisfiesHostApi`. A bundled
 * copy would carry the plugin's BUILD-time version and lie about the host; those
 * live on the root (`public.ts`), which the import map points at the host's copy.
 * Only the pure `satisfiesHostApiRange(version, range)` is exported here.
 *
 * See change: decouple-plugins-from-core.
 */

export type { HostApiRange } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/host-api.js";
export { satisfiesHostApiRange } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/host-api.js";
export { HOST_FX_CLASSES } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/host-fx-classes.js";
export type * from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
export type { UiPrimitiveMap } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
export { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";

/** Base64url (UTF-8) encode a folder path for `/folder/:encodedCwd/*` routes. */
export function encodeFolderPath(cwd: string): string {
  // UTF-8 encode first so non-ASCII folder names don't throw in btoa.
  const bytes = new TextEncoder().encode(cwd);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Inverse of {@link encodeFolderPath}; `null` for malformed input. */
export function decodeFolderPath(encoded: string): string | null {
  try {
    const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const pad = (4 - (padded.length % 4)) % 4;
    const binary = atob(padded + "=".repeat(pad));
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Href of a folder-scoped route: `/folder/<encoded cwd><suffix>`. `suffix` is a
 * path (`/automations`, `automations`) or a query/hash (`?path=x`); a bare
 * path segment gets its leading slash.
 */
export function folderRouteHref(cwd: string, suffix = ""): string {
  const tail = suffix === "" || /^[/?#]/.test(suffix) ? suffix : `/${suffix}`;
  return `/folder/${encodeFolderPath(cwd)}${tail}`;
}
