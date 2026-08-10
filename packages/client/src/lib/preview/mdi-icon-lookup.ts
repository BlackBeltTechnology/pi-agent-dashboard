/**
 * MDI icon lookup helper for the Extension UI System (Phase 1).
 *
 * Extensions declare icons by MDI key string (e.g. `"mdiCheckCircle"`); the
 * dashboard resolves the key against the `@mdi/js` module exports at
 * runtime. Unknown keys render no icon — never an error — to keep the
 * surface XSS-safe and predictable. See change: add-extension-ui-modal,
 * design.md \u00a78.
 */
import * as mdi from "@mdi/js";

const allowlist = mdi as unknown as Record<string, string>;

/**
 * Resolve an MDI key string (e.g. `"mdiCheckCircle"`) to its SVG path,
 * or `null` if the key is missing, mistyped, or not present in the
 * installed `@mdi/js` version.
 *
 * Pure: no side effects, safe to call during render.
 */
export function resolveMdiIcon(key: string | undefined | null): string | null {
  if (!key || typeof key !== "string") return null;
  if (!key.startsWith("mdi")) return null;
  const path = allowlist[key];
  return typeof path === "string" && path.length > 0 ? path : null;
}
