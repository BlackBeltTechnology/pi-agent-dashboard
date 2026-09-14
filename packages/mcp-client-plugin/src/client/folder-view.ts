/**
 * mcp-client-plugin · folder-scope view helpers.
 *
 * Pure derivation over an effective-view server for the folder page: the UI
 * provenance vocabulary (**Shared / Pi global / Pi folder / Other**), the
 * inherited-from layer, the set of fields the folder-layer entry does not
 * define, and the folder override's field names (the removable chip).
 *
 * `own` is the folder layer's OWN entry (`<cwd>/.pi/mcp.json`). Preferring it
 * is exact; when the server does not send it, a server with no Pi-folder
 * provenance is wholly inherited and a Pi-folder server's per-field ownership
 * is unknowable (no invented hints). See change: extract-mcp-client-plugin
 * (tasks 8.1-8.3).
 */
import type { EffectiveServerView, ProvenanceLayer } from "../core/effective-view.js";

/** The effective server plus the folder layer's own entry, when supplied. */
type FolderServerView = EffectiveServerView & {
  own?: Record<string, unknown>;
};

/** The folder-layer own entry, when the payload carries a plain object. */
function ownEntryOf(server: EffectiveServerView): Record<string, unknown> | undefined {
  const own = (server as FolderServerView).own;
  return own !== null && typeof own === "object" && !Array.isArray(own) ? own : undefined;
}

/** UI label for one defining layer (exactly the four-vocabulary set). */
function layerLabel(p: ProvenanceLayer): string {
  if (p.layer === "pi-global") return "Pi global";
  if (p.layer === "pi-folder") return "Pi folder";
  if (p.layer === "shared") return "Shared";
  return `Other: ${p.importKind ?? p.label}`;
}

/** The highest-precedence non-folder layer a folder-page field inherits from. */
export function inheritedLayerOf(server: EffectiveServerView): string | undefined {
  const layer = server.provenance.find((p) => p.layer !== "pi-folder");
  return layer ? layerLabel(layer) : undefined;
}

/**
 * Fields the folder entry does not define. `undefined` when unknowable — a
 * Pi-folder server whose own entry is absent must not invent per-field hints.
 */
export function inheritedFieldsOf(server: EffectiveServerView): Set<string> | undefined {
  const own = ownEntryOf(server);
  if (own !== undefined) {
    return new Set(Object.keys(server.entry).filter((key) => !(key in own)));
  }
  if (server.provenance.some((p) => p.layer === "pi-folder")) return undefined;
  return new Set(Object.keys(server.entry));
}

/** The folder entry's own field names — the override chip's list. */
export function overrideFieldsOf(server: EffectiveServerView): string[] {
  return Object.keys(ownEntryOf(server) ?? {});
}

/** True when `<cwd>/.pi/mcp.json` defines the server key. */
export function isFolderOwned(server: EffectiveServerView): boolean {
  return server.provenance.some((p) => p.layer === "pi-folder");
}
