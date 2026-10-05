/**
 * mcp-client-plugin · folder-scope view helpers.
 *
 * The folder override pre-fill: pi replaces a global entry WHOLE, so
 * "Override…" starts from the complete global entry EXCEPT the secret-bearing
 * fields (`headers`, `env`, `oauth.clientSecret`) and `auth` — those are left
 * out and flagged, never copied silently (the server's redaction markers are
 * never sent back either).
 *
 * See change: migrate-mcp-to-pi-builtin.
 */
import type { Provenance } from "../core/types.js";
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

/** A copy of a global entry for a folder override, without secrets or `auth`. */
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
