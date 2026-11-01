/**
 * Contract for the flows plugin's flow catalog: what the bridge publishes, how
 * it is forwarded, and the browser→server ask. Import-free leaf so the bridge,
 * server and client share it without pulling each other.
 * See change: flows-dock-chip-and-panel-actions (D1, D3).
 */

/** One flow pi-flows reports for a session (plugin-owned; core carries no flow list). */
export interface FlowCatalogEntry {
  name: string;
  description: string;
  source: string;
  taskRequired: boolean;
}

/** pi bus channel the bridge emits the catalog on (no `flow:` prefix: core owns it). */
export const FLOW_CATALOG_CHANNEL = "dashboard-flows:catalog";
/** Forwarded dashboard event type (falls under the plugin's `flow_*` ownership). */
export const FLOW_CATALOG_EVENT = "flow_catalog";
/** `latest` key field + its one fixed value. */
export const FLOW_CATALOG_KEY_FIELD = "catalogKey";
export const FLOW_CATALOG_KEY = "catalog";

/** Forwarded payload. */
export interface FlowCatalogPayload {
  catalogKey: typeof FLOW_CATALOG_KEY;
  flows: FlowCatalogEntry[];
}

/** `plugin_action` the client sends to ask a session to (re)publish its catalog. */
export const FLOW_REQUEST_CATALOG_ACTION = "flow.request-catalog";

/** Coerce one raw pi-flows entry; null when it has no name. */
export function toCatalogEntry(raw: unknown): FlowCatalogEntry | null {
  const r = raw as { name?: unknown; description?: unknown; source?: unknown; taskRequired?: unknown } | null;
  if (!r || typeof r.name !== "string" || !r.name) return null;
  return {
    name: r.name,
    description: typeof r.description === "string" ? r.description : "",
    source: typeof r.source === "string" ? r.source : "",
    taskRequired: r.taskRequired === true,
  };
}

/** Parse a forwarded catalog payload; undefined when malformed. */
export function parseCatalogPayload(data: unknown): FlowCatalogEntry[] | undefined {
  const flows = (data as { flows?: unknown } | null)?.flows;
  if (!Array.isArray(flows)) return undefined;
  const out: FlowCatalogEntry[] = [];
  for (const f of flows) {
    const e = toCatalogEntry(f);
    if (e) out.push(e);
  }
  return out;
}

/** Order-insensitive equality over the fields the UI shows. */
export function sameCatalog(a: readonly FlowCatalogEntry[] | undefined, b: readonly FlowCatalogEntry[] | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.length !== b.length) return false;
  const key = (e: FlowCatalogEntry) => `${e.name}\u0000${e.description}\u0000${e.source}\u0000${e.taskRequired}`;
  const sa = a.map(key).sort();
  const sb = b.map(key).sort();
  return sa.every((v, i) => v === sb[i]);
}
