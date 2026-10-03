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

export function useArchiveRoute(): ArchiveRoute | null {
  const [listMatch, listParams] = useRoute("/folder/:encodedCwd/openspec/archive");
  const [entryMatch, entryParams] = useRoute("/folder/:encodedCwd/openspec/archive/:entry");
  const [artifactMatch, artifactParams] = useRoute("/folder/:encodedCwd/openspec/archive/:entry/:artifact");
  if (artifactMatch && artifactParams) {
    return {
      cwd: (decodeFolderPath(artifactParams.encodedCwd ?? "") ?? ""),
      entry: decodeURIComponent(artifactParams.entry ?? ""),
      artifact: decodeURIComponent(artifactParams.artifact ?? ""),
    };
  }
  if (entryMatch && entryParams) {
    return { cwd: (decodeFolderPath(entryParams.encodedCwd ?? "") ?? ""), entry: decodeURIComponent(entryParams.entry ?? "") };
  }
  if (listMatch && listParams) return { cwd: (decodeFolderPath(listParams.encodedCwd ?? "") ?? "") };
  return null;
}
