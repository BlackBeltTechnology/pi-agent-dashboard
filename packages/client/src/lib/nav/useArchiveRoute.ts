/**
 * Matches the three archive route shapes in one place so `App` and
 * `ShellContent` cannot drift:
 *   /folder/:cwd/openspec/archive
 *   /folder/:cwd/openspec/archive/:entry
 *   /folder/:cwd/openspec/archive/:entry/:artifact
 * See change: resolve-archived-attached-proposal (D6).
 */
import { useRoute } from "wouter";
import { decodeFolderPath } from "../util/folder-encoding.js";

export interface ArchiveRoute {
  cwd: string;
  entry?: string;
  artifact?: string;
}

/** `decodeURIComponent` that returns null on a malformed escape instead of throwing. */
function safeDecode(segment: string | null | undefined): string | null {
  try {
    return decodeURIComponent(segment ?? "");
  } catch {
    return null;
  }
}

export function useArchiveRoute(): ArchiveRoute | null {
  const [listMatch, listParams] = useRoute("/folder/:encodedCwd/openspec/archive");
  const [entryMatch, entryParams] = useRoute("/folder/:encodedCwd/openspec/archive/:entry");
  const [artifactMatch, artifactParams] = useRoute("/folder/:encodedCwd/openspec/archive/:entry/:artifact");
  // An undecodable entry/artifact segment degrades to the archive list (never throws).
  const route = (encodedCwd: string | null | undefined, entry?: string | null, artifact?: string | null): ArchiveRoute => {
    const cwd = decodeFolderPath(encodedCwd ?? "") ?? "";
    const e = entry === undefined ? null : safeDecode(entry);
    if (e === null) return { cwd };
    const a = artifact === undefined ? null : safeDecode(artifact);
    return a === null ? { cwd, entry: e } : { cwd, entry: e, artifact: a };
  };
  if (artifactMatch && artifactParams) return route(artifactParams.encodedCwd, artifactParams.entry, artifactParams.artifact);
  if (entryMatch && entryParams) return route(entryParams.encodedCwd, entryParams.entry);
  if (listMatch && listParams) return route(listParams.encodedCwd);
  return null;
}
