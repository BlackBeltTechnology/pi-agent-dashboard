/**
 * MDI icon lookup helper for the Extension UI System (Phase 1).
 *
 * Extensions declare icons by MDI key string (e.g. `"mdiCheckCircle"`); the
 * dashboard resolves the key against the full `@mdi/js` icon set. Unknown
 * keys render no icon — never an error — to keep the surface XSS-safe and
 * predictable. See change: add-extension-ui-modal, design.md §8.
 *
 * The full set is loaded lazily (off the cold landing load), so render sites
 * use the `useMdiIconByKey` hook, which re-renders once the set lands.
 * `resolveMdiIcon` is the synchronous lookup: `null` until the set has loaded.
 * See change: harden-ios-safari-memory-and-ws-diagnostics.
 */
export {
  loadMdiIconSet,
  resolveMdiIconSync as resolveMdiIcon,
  useMdiIconByKey,
} from "@blackbelt-technology/pi-dashboard-client-utils/mdi-by-key";
