/**
 * Session skill registry — the live half of the Resources view's skill list.
 *
 * The scanner answers "what does pi resolve for this folder?"; a session's
 * `commands_list` answers "what did pi actually load?". Joining the two on
 * canonicalized real paths turns a flat list into provenance:
 *
 *   | resolved | live | status            |
 *   |----------|------|-------------------|
 *   | yes      | yes  | `active`          |
 *   | yes      | no   | `not-loaded`      |
 *   | no       | yes  | `loaded-elsewhere`|
 *
 * No new protocol message is involved: `commands_list` already carries
 * `source: "skill"` and (since the bridge's `filterHiddenCommands` mapping) a
 * `path`. See change: fix-skill-discovery-parity.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { PiResource, PiResourcesResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import type { CommandInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/**
 * Resolve symlinks/hoisted copies so two spellings of one file join.
 *
 * On ENOENT the raw string is returned. That is the right fallback for a path
 * that never existed, but it means a skill deleted between the scan and the
 * join can miss its counterpart (one side canonicalizes, the other does not)
 * and be mislabelled for one request. The next poll corrects it.
 */
export function canonicalPath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * True when `child` is `folder` itself or a path beneath it, compared on
 * canonicalized paths.
 *
 * The reporter set is folder-scoped but a session resolves against its own
 * `cwd`, and a worktree or subdirectory session is legitimately attached to the
 * folder card. Requiring exact equality would exclude it, degrade the payload
 * to scan-only, and make `differsFromFolder` unreachable — the very state the
 * spec asks the surface to explain. See change: fix-skill-discovery-parity.
 */
export function isWithinFolder(child: string, folder: string): boolean {
  const c = canonicalPath(child);
  const f = canonicalPath(folder);
  return c === f || c.startsWith(f.endsWith(path.sep) ? f : f + path.sep);
}

/**
 * Per-join memo over `canonicalPath`. `realpathSync` walks the filesystem and
 * the join calls it once per resolved skill plus once per live skill, on an
 * HTTP path the client polls; one workspace easily has ~60 of each.
 */
function makeCanonicalizer(): (p: string) => string {
  const memo = new Map<string, string>();
  return (p) => {
    const hit = memo.get(p);
    if (hit !== undefined) return hit;
    const resolved = canonicalPath(p);
    memo.set(p, resolved);
    return resolved;
  };
}

function skillCommands(commands: CommandInfo[]): CommandInfo[] {
  return commands.filter((c) => c.source === "skill");
}

/**
 * Per-session store of the latest `commands_list`.
 *
 * Settling rule (test-plan C2): a non-empty skill set is **never** replaced by
 * an empty one. A reload sends a transitional list with no skills, and without
 * this rule every resolved skill would momentarily read `not-loaded`.
 *
 * Accepted consequence: a session that genuinely drops to zero skills (every
 * skill file deleted or disabled) keeps reporting its last non-empty set until
 * it sends a non-empty list again or unregisters. C2 chose the unconditional
 * rule over a time window; masking a rare real-zero state is preferred to the
 * mass `not-loaded` flip a window would still let through.
 */
export class SessionCommandRegistry {
  private readonly bySession = new Map<string, CommandInfo[]>();

  retain(sessionId: string, commands: CommandInfo[]): void {
    const incoming = commands ?? [];
    const previous = this.bySession.get(sessionId);
    if (previous && skillCommands(previous).length > 0 && skillCommands(incoming).length === 0) {
      return; // transitional empty list — keep the populated set
    }
    this.bySession.set(sessionId, incoming);
  }

  get(sessionId: string): CommandInfo[] | undefined {
    return this.bySession.get(sessionId);
  }

  /** True when this session has ever reported — the "has reported" signal. */
  hasReported(sessionId: string): boolean {
    return this.bySession.has(sessionId);
  }

  remove(sessionId: string): void {
    this.bySession.delete(sessionId);
  }
}

/** One session that has reported a `commands_list` for the folder being rendered. */
export interface SkillReporter {
  sessionId: string;
  cwd: string;
  commands: CommandInfo[];
}

/**
 * Copy the payload down to the skill objects the join stamps. The scan result
 * is cached per cwd, so mutating it in place would leak one session's
 * provenance into every later read.
 */
function cloneForJoin(result: PiResourcesResult): PiResourcesResult {
  const cloneScope = <T extends { skills: PiResource[] }>(s: T): T => ({ ...s, skills: s.skills.map((k) => ({ ...k })) });
  return {
    ...result,
    local: cloneScope(result.local),
    global: cloneScope(result.global),
    packages: result.packages.map((p) => ({ ...p, resources: cloneScope(p.resources) })),
  };
}

function everySkillScope(result: PiResourcesResult): PiResource[][] {
  return [
    result.local.skills,
    result.global.skills,
    ...result.packages.map((p) => p.resources.skills),
  ];
}

/**
 * Stamp every resolved skill and return the live keys they claimed. A resolved
 * path is never "elsewhere", disabled or not, so it is claimed even when its
 * status is left alone — otherwise the leftover pass would duplicate it.
 */
function stampResolvedStatuses(
  result: PiResourcesResult,
  livePaths: Map<string, CommandInfo>,
  canonical: (p: string) => string,
): Set<string> {
  const matched = new Set<string>();
  for (const scope of everySkillScope(result)) {
    for (const skill of scope) {
      const key = canonical(skill.filePath);
      const isLive = livePaths.has(key);
      if (isLive) matched.add(key);
      // Disabled takes precedence over the join: `getSkills()` applies no
      // `enabled` filter, so absence from the live set proves nothing.
      if (skill.enabled === false) continue;
      skill.status = isLive ? "active" : "not-loaded";
    }
  }
  return matched;
}

/**
 * Add the session's live-but-unresolved skills: runtime registration,
 * `~/.pi/agent/skills`, an ancestor `.agents/skills` chain, an explicit
 * `--skill`, or `skillPaths` in settings.
 */
function appendLoadedElsewhere(
  result: PiResourcesResult,
  livePaths: Map<string, CommandInfo>,
  matched: Set<string>,
): void {
  for (const [key, cmd] of livePaths) {
    if (matched.has(key)) continue;
    result.local.skills.push({
      name: cmd.name,
      description: cmd.description,
      filePath: cmd.path as string,
      type: "skill",
      enabled: true,
      status: "loaded-elsewhere",
      sessionPath: cmd.path as string,
    });
  }
}

/**
 * Stamp `status` on every resolved skill and append the session's
 * unresolved-but-loaded skills as `loaded-elsewhere` entries.
 *
 * Scan-only (no statuses at all) when: the payload is degraded, no session has
 * reported, more than one has, or the retained skill commands carry no
 * joinable `path`. Selecting among several reporting sessions is an unresolved
 * design question — last-writer-wins is deliberately not adopted.
 */
export function joinSkillProvenance(
  scanned: PiResourcesResult,
  reporters: SkillReporter[],
  folderCwd?: string,
): PiResourcesResult {
  if (scanned.degraded) return scanned;
  if (reporters.length !== 1) return { ...scanned, scanOnly: true };

  const result = cloneForJoin(scanned);
  const canonical = makeCanonicalizer();
  const reporter = reporters[0];
  const live = skillCommands(reporter.commands);
  const withPath = live.filter((c) => typeof c.path === "string" && c.path.length > 0);
  if (live.length > 0 && withPath.length === 0) {
    // pi's `sourceInfo.path` is an internal shape; if it ever disappears the
    // join must say so loudly rather than flip every skill to `not-loaded`.
    return { ...result, scanOnly: true, pathlessCommands: true };
  }
  if (withPath.length < live.length) {
    // Partial loss is the same silent regression in miniature: the affected
    // entries simply vanish from the join. Say so rather than swallow it.
    console.warn(
      `[skill-join] ${live.length - withPath.length}/${live.length} skill commands from session ${reporter.sessionId} carry no path`,
    );
  }

  const livePaths = new Map<string, CommandInfo>();
  for (const cmd of withPath) livePaths.set(canonical(cmd.path as string), cmd);

  const matched = stampResolvedStatuses(result, livePaths, canonical);
  appendLoadedElsewhere(result, livePaths, matched);

  return {
    ...result,
    contributingSession: {
      sessionId: reporter.sessionId,
      cwd: reporter.cwd,
      differsFromFolder: folderCwd !== undefined && canonicalPath(reporter.cwd) !== canonicalPath(folderCwd),
    },
  };
}

/**
 * Process-wide registry. The writer (`commands_list` in event-wiring) and the
 * reader (`/api/pi-resources`) live in different modules with no shared
 * dependency container, so the store is a module singleton.
 */
export const sessionCommandRegistry = new SessionCommandRegistry();
