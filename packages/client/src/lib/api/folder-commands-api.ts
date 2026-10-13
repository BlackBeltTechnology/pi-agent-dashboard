/**
 * Client fetch helper for the folder command list
 * (`GET /api/pi-resources/commands?cwd=`): the slash commands/skills a composer
 * with no live bridge (folder home, ended session) can offer.
 *
 * NEVER throws: a 404 (old server without the route), a 5xx, a non-JSON body or
 * a network failure all resolve to an empty `none` list, so the composer simply
 * has no folder commands instead of an error.
 *
 * See change: redesign-directory-home-split.
 */
import type { CommandInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { getApiBase } from "./api-context.js";
import { fetchJsonResponse } from "./fetch-json.js";

export type FolderCommandOrigin = "live" | "scan" | "none";
type FolderCommandScope = "folder" | "global";
type FolderCommand = CommandInfo & { scope: FolderCommandScope };

export interface FolderCommandsResult {
  commands: FolderCommand[];
  origin: FolderCommandOrigin;
}

export const EMPTY_FOLDER_COMMANDS: FolderCommandsResult = { commands: [], origin: "none" };

export async function fetchFolderCommands(cwd: string): Promise<FolderCommandsResult> {
  try {
    const { res, json } = await fetchJsonResponse<{ data?: FolderCommandsResult }>(
      `${getApiBase()}/api/pi-resources/commands?cwd=${encodeURIComponent(cwd)}`,
    );
    if (!res.ok || !json?.data || !Array.isArray(json.data.commands)) return EMPTY_FOLDER_COMMANDS;
    return { commands: json.data.commands, origin: json.data.origin ?? "scan" };
  } catch {
    return EMPTY_FOLDER_COMMANDS;
  }
}
