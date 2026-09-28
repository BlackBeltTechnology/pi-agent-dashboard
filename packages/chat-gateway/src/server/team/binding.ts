/**
 * cwd resolution with the workspace source inserted into chat-gateway's
 * precedence chain, and the `allowedRoots`-narrowing invariant.
 *
 * Precedence: (1) persisted binding, (2) the channel's bound workspace's
 * folders, (3) the fixed channel→cwd map, (4) the configured default.
 *
 * A workspace folder outside `allowedRoots` is INERT — never resolved, never
 * spawned into — rather than adopted, so this convenience feature can only
 * narrow chat-gateway's spawn boundary, never widen it.
 *
 * See change: add-chat-gateway-team-controls (D8).
 */
import type { BindingSource } from "../../shared/types.js";
import { canonicalizePath, isWithinAllowedRoots, resolveCwd } from "../binding.js";

export interface WorkspaceCwdInput {
  persisted?: { cwd: string };
  /** Folders of the channel's bound workspace, in order. */
  workspaceFolders?: string[];
  fixedMap: Record<string, string>;
  channelKey: string;
  defaultCwd?: string;
  allowedRoots: string[];
}

export type WorkspaceResolveOutcome =
  | { kind: "resolved"; cwd: string; source: BindingSource }
  | { kind: "refused"; reason: string };

/**
 * Resolve a spawn cwd across all sources. The workspace source sits between the
 * persisted binding and the fixed map; inert workspace folders are skipped.
 */
export function resolveCwdWithWorkspace(input: WorkspaceCwdInput): WorkspaceResolveOutcome {
  // 1. A persisted binding still wins, and is still judged (and refused) as-is.
  if (input.persisted?.cwd) {
    return resolveCwd({
      persisted: input.persisted,
      fixedMap: input.fixedMap,
      channelKey: input.channelKey,
      allowedRoots: input.allowedRoots,
      ...(input.defaultCwd ? { defaultCwd: input.defaultCwd } : {}),
    });
  }

  // 2. The bound workspace's folders — first one inside allowedRoots wins.
  for (const folder of input.workspaceFolders ?? []) {
    if (!folder) continue;
    // Inert folders (outside allowedRoots) are skipped, not adopted.
    if (!isWithinAllowedRoots(folder, input.allowedRoots)) continue;
    return { kind: "resolved", cwd: canonicalizePath(folder), source: "workspace" };
  }

  // 3/4. fixedMap, then defaultCwd (both `allowedRoots`-gated by resolveCwd).
  return resolveCwd({
    fixedMap: input.fixedMap,
    channelKey: input.channelKey,
    allowedRoots: input.allowedRoots,
    ...(input.defaultCwd ? { defaultCwd: input.defaultCwd } : {}),
  });
}

/**
 * Report which workspace folders are inert (outside `allowedRoots`), for the
 * configuration surface.
 */
export function inertWorkspaceFolders(
  folders: string[],
  allowedRoots: string[],
): string[] {
  return folders.filter((f) => !isWithinAllowedRoots(f, allowedRoots));
}
