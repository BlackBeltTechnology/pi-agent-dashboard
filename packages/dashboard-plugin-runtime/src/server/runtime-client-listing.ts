/**
 * The payload of `GET /api/plugins/runtime-clients`: admitted runtime plugins only, every URL under
 * `/plugin-assets/<id>/<sha>/`. A claim keeps EVERY manifest field; its package-relative `module` is
 * replaced by its asset URL. No i18n URL: `i18nCatalog` names an export of the client entry, which the
 * loader reads from the entry module (R10).
 *
 * See change: decouple-plugins-from-core (task 6.11).
 */
import type { PluginClaim } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/manifest-types.js";
import { PLUGIN_ASSETS_PREFIX } from "./plugin-assets-route.js";
import { type AdmittedRuntimePlugin, assetRelPath } from "./runtime-client-registry.js";

/** Serializable back-action descriptor of a `shell-overlay-route` claim (the client rebuilds `computeParent` from `parentPath`). */
export interface RuntimeRouteDescriptor {
  pattern: string;
  depth: 1 | 2;
  parentPath?: string;
}

export interface RuntimeClientListingEntry {
  id: string;
  displayName: string;
  priority: number;
  /** Content hash of the served bundle (also the URL path segment). */
  sha256: string;
  /** URL of the entry module. */
  entry: string;
  /** URL of the stylesheet, when the manifest declares `clientStyles`. */
  styles?: string;
  /** Export name of the i18n catalog inside the entry module (not a URL). */
  i18nCatalog?: string;
  eventTypes: string[];
  claims: Array<Omit<PluginClaim, "module"> & { module?: string }>;
  routes: RuntimeRouteDescriptor[];
}

export function assetUrl(id: string, sha256: string, rel: string): string {
  return `${PLUGIN_ASSETS_PREFIX}/${encodeURIComponent(id)}/${sha256}/${rel.split("/").map(encodeURIComponent).join("/")}`;
}

function routeDescriptors(claims: readonly PluginClaim[]): RuntimeRouteDescriptor[] {
  const out: RuntimeRouteDescriptor[] = [];
  for (const claim of claims) {
    if (claim.slot !== "shell-overlay-route" || typeof claim.path !== "string" || claim.path.length === 0) continue;
    const depth: 1 | 2 = claim.depth === 1 ? 1 : 2;
    out.push({
      pattern: claim.path,
      depth,
      ...(depth === 2 && claim.parentPath ? { parentPath: claim.parentPath } : {}),
    });
  }
  return out;
}

export function toListingEntry(admitted: AdmittedRuntimePlugin): RuntimeClientListingEntry {
  const { id, sha256, plugin } = admitted;
  const m = plugin.manifest;
  const claims = m.claims.map((claim) => {
    const { module: pkgModule, ...rest } = claim;
    const rel = pkgModule ? assetRelPath(plugin, pkgModule) : undefined;
    return { ...rest, ...(rel ? { module: assetUrl(id, sha256, rel) } : {}) };
  });
  return {
    id,
    displayName: admitted.displayName,
    priority: m.priority ?? 1000,
    sha256,
    entry: assetUrl(id, sha256, admitted.entry),
    ...(admitted.styles ? { styles: assetUrl(id, sha256, admitted.styles) } : {}),
    ...(m.i18nCatalog ? { i18nCatalog: m.i18nCatalog } : {}),
    eventTypes: m.eventTypes ? [...m.eventTypes] : [],
    claims,
    routes: routeDescriptors(m.claims),
  };
}

export function buildRuntimeClientListing(admitted: readonly AdmittedRuntimePlugin[]): RuntimeClientListingEntry[] {
  return admitted.map(toListingEntry);
}
