/**
 * Folder command list without a live session.
 *
 * Feeds the composers that have no bridge behind them (folder home, ended
 * sessions). Source precedence:
 *   1. `live`  — the latest accepted non-empty `commands_list` of a session
 *                whose bridge is CONNECTED and whose cwd equals the request cwd;
 *   2. `scan`  — enabled skills + prompts from the resource scan;
 *   3. `none`  — nothing found.
 *
 * Cwd equality is exact on purpose (after trailing-separator strip +
 * `canonicalPath`): a subdirectory/worktree session resolves a different
 * `.pi/`, so its list is not "what loads here".
 *
 * See change: redesign-directory-home-split (design D3).
 */
import * as path from "node:path";
import type { PiResource, PiResourceScope, PiResourcesResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import type { CommandInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { canonicalPath, type SessionCommandRegistry } from "./session-skill-registry.js";

type FolderCommandOrigin = "live" | "scan" | "none";
type FolderCommandScope = "folder" | "global";
type FolderCommand = CommandInfo & { scope: FolderCommandScope };
export interface FolderCommandsResult {
  commands: FolderCommand[];
  origin: FolderCommandOrigin;
}

/** Strip trailing separators (keeping a bare root), then resolve symlinks. */
function normalizeFolderCwd(cwd: string): string {
  let c = cwd;
  while (c.length > 1 && (c.endsWith("/") || c.endsWith("\\"))) c = c.slice(0, -1);
  return canonicalPath(c);
}

interface FolderCommandSession {
  id: string;
  cwd: string;
}

/** Latest non-empty accepted list among connected sessions whose cwd equals `cwd`. */
function liveCommands(
  cwd: string,
  sessions: FolderCommandSession[],
  registry: SessionCommandRegistry,
  isConnected: (sessionId: string) => boolean,
): CommandInfo[] | undefined {
  let best: { commands: CommandInfo[]; receivedAt: number } | undefined;
  for (const s of sessions) {
    if (!isConnected(s.id)) continue;
    if (normalizeFolderCwd(s.cwd) !== cwd) continue;
    const entry = registry.getEntry(s.id);
    if (!entry || entry.commands.length === 0) continue;
    if (!best || entry.receivedAt > best.receivedAt) best = entry;
  }
  return best?.commands;
}

function enabled(list: PiResource[]): PiResource[] {
  return list.filter((r) => r.enabled !== false);
}

function scopeResources(scope: PiResourceScope): PiResource[] {
  return [...scope.skills, ...scope.prompts];
}

/** Enabled skills + prompts of one scope as commands (name rules per design D3). */
function scopeToCommands(scope: PiResourceScope): CommandInfo[] {
  return [
    ...enabled(scope.skills).map<CommandInfo>((r) => ({
      name: `skill:${r.name}`,
      source: "skill",
      description: r.description,
      path: r.filePath,
    })),
    ...enabled(scope.prompts).map<CommandInfo>((r) => ({
      name: r.name,
      source: "prompt",
      description: r.description,
      path: r.filePath,
    })),
  ];
}

/** Scan → commands. Folder-origin resources first so a name clash resolves to the folder's. */
function scanCommands(scan: PiResourcesResult): CommandInfo[] {
  const ordered: CommandInfo[] = [
    ...scopeToCommands(scan.local),
    ...scan.packages.filter((p) => p.scope === "local").flatMap((p) => scopeToCommands(p.resources)),
    ...scopeToCommands(scan.global),
    ...scan.packages.filter((p) => p.scope !== "local").flatMap((p) => scopeToCommands(p.resources)),
  ];
  const seen = new Set<string>();
  return ordered.filter((c) => {
    if (seen.has(c.name)) return false;
    seen.add(c.name);
    return true;
  });
}

/** Canonical paths of the folder's own resources: `local.*` + local-scope packages. */
function folderPathSet(scan: PiResourcesResult | undefined): Set<string> {
  const set = new Set<string>();
  if (!scan) return set;
  for (const r of scopeResources(scan.local)) set.add(canonicalPath(r.filePath));
  for (const p of scan.packages) {
    if (p.scope !== "local") continue;
    for (const r of scopeResources(p.resources)) set.add(canonicalPath(r.filePath));
  }
  return set;
}

function scopeOf(cmd: CommandInfo, folder: Set<string>, folderPiDir: string): FolderCommandScope {
  if (!cmd.path) return "global";
  const p = canonicalPath(cmd.path);
  if (folder.has(p)) return "folder";
  return p.startsWith(folderPiDir + path.sep) ? "folder" : "global";
}

export interface ResolveFolderCommandsInput {
  /** Already-validated absolute cwd, as the client gave it. */
  cwd: string;
  /** Resource scan for the cwd; undefined when unavailable. */
  scan: PiResourcesResult | undefined;
  sessions: FolderCommandSession[];
  registry: SessionCommandRegistry;
  isSessionConnected: (sessionId: string) => boolean;
}

export function resolveFolderCommands(input: ResolveFolderCommandsInput): FolderCommandsResult {
  const cwd = normalizeFolderCwd(input.cwd);
  const live = liveCommands(cwd, input.sessions, input.registry, input.isSessionConnected);
  const origin: FolderCommandOrigin = live ? "live" : "none";
  const base = live ?? (input.scan ? scanCommands(input.scan) : []);
  const folder = folderPathSet(input.scan);
  const folderPiDir = path.join(cwd, ".pi");
  const commands = base.map<FolderCommand>((c) => ({ ...c, scope: scopeOf(c, folder, folderPiDir) }));
  if (live) return { commands, origin: "live" };
  return { commands, origin: commands.length > 0 ? "scan" : origin };
}
