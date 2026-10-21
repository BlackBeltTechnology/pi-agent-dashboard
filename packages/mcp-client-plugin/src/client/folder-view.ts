/**
 * mcp-client-plugin · folder-scope view helpers.
 *
 * The "Replace with folder entry…" pre-fill: a project entry with a transport
 * replaces a global entry WHOLE, so the editor starts from the complete global
 * entry EXCEPT the secret-bearing fields (`headers`, `env`,
 * `oauth.clientSecret`) and `auth` — those are left out and flagged, never
 * copied silently (the server's redaction markers are never sent back either).
 * Also the project-override presentation helpers (badge text, undo patch).
 *
 * See change: migrate-mcp-to-pi-builtin; mcp-client-project-overrides.
 */
import { displayExposure, OVERRIDE_KEYS } from "@blackbelt-technology/pi-dashboard-mcp-core/pi-rules.js";
import type { ProjectOverridePatch, Provenance } from "@blackbelt-technology/pi-dashboard-mcp-core/types.js";
import { stripRedacted } from "./schema.js";

/**
 * Secret-bearing fields a folder copy must NOT inherit silently. Copied from
 * `core/config-writer.ts` (`FOLDER_COPY_OMITTED`) — that module imports node
 * built-ins, so the browser bundle copies the constant instead.
 */
const FOLDER_COPY_OMITTED = ["headers", "env", "oauth.clientSecret", "auth"] as const;

export interface FolderOverridePrefill {
  /** The entry to open the editor with (secrets + auth removed, sentinels stripped). */
  draft: Record<string, unknown>;
  /** Dotted field names that were present on the global entry and dropped. */
  omitted: string[];
}

function hasPath(entry: Record<string, unknown>, path: string[]): boolean {
  let current: unknown = entry;
  for (const key of path) {
    if (current === null || typeof current !== "object") return false;
    current = (current as Record<string, unknown>)[key];
  }
  return current !== undefined;
}

function deletePath(draft: Record<string, unknown>, path: string[]): void {
  let parent: Record<string, unknown> = draft;
  for (let i = 0; i < path.length - 1; i++) {
    const next = parent[path[i] as string];
    if (next === null || typeof next !== "object") return;
    parent = next as Record<string, unknown>;
  }
  delete parent[path[path.length - 1] as string];
}

/** A copy of a global entry for a whole-entry folder replace, without secrets or `auth`. */
export function folderOverrideDraftOf(entry: Record<string, unknown>): FolderOverridePrefill {
  // Flag against the RAW entry (the server's redaction sentinels mark the
  // secret fields), then strip the markers and the flagged paths.
  const omitted = FOLDER_COPY_OMITTED.filter((dotted) => hasPath(entry, dotted.split(".")));
  const draft = (stripRedacted(entry) ?? {}) as Record<string, unknown>;
  for (const dotted of omitted) deletePath(draft, dotted.split("."));
  if (Object.keys(draft.oauth ?? {}).length === 0) delete draft.oauth;
  return { draft, omitted };
}

/** UI label for a row's defining layer. */
export function provenanceLabel(provenance: Provenance): string {
  return provenance === "pi-folder" ? "Pi folder" : "Pi global";
}

/** True when the FOLDER layer defines the server (row editor edits it directly). */
export function isFolderOwned(provenance: Provenance): boolean {
  return provenance === "pi-folder";
}

/** One text badge per overridden key ("Off in this folder", …) — text, never colour alone. */
export function overrideBadges(raw: Record<string, unknown>): Array<{ key: string; text: string }> {
  const out: Array<{ key: string; text: string }> = [];
  if (typeof raw.enabled === "boolean") {
    out.push({ key: "enabled", text: raw.enabled ? "On in this folder" : "Off in this folder" });
  }
  if (raw.exposure !== undefined) {
    out.push({ key: "exposure", text: `Exposure: ${displayExposure(raw.exposure)} in this folder` });
  }
  if (raw.toolExposure !== undefined) out.push({ key: "toolExposure", text: "Tool exposure set in this folder" });
  return out;
}

/** The patch that restores a removed override exactly: its raw keys, absent keys as `null`. */
export function overrideRestorePatch(removed: Record<string, unknown>): ProjectOverridePatch {
  const patch: Record<string, unknown> = {};
  for (const k of OVERRIDE_KEYS) patch[k] = removed[k] ?? null;
  return patch as ProjectOverridePatch;
}
