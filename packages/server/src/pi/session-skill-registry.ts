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
import type { CommandInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { PiResource, PiResourcesResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";

/** Resolve symlinks/hoisted copies so two spellings of one file join. */
function canonical(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
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
  const reporter = reporters[0];
  const live = skillCommands(reporter.commands);
  const withPath = live.filter((c) => typeof c.path === "string" && c.path.length > 0);
  if (live.length > 0 && withPath.length === 0) {
    // pi's `sourceInfo.path` is an internal shape; if it ever disappears the
    // join must say so loudly rather than flip every skill to `not-loaded`.
    return { ...result, scanOnly: true, pathlessCommands: true };
  }

  const livePaths = new Map<string, CommandInfo>();
  for (const cmd of withPath) livePaths.set(canonical(cmd.path as string), cmd);

  const matched = new Set<string>();
  for (const scope of everySkillScope(result)) {
    for (const skill of scope) {
      const key = canonical(skill.filePath);
      // A resolved path is never "elsewhere", disabled or not — claim it before
      // the leftover pass so it is not duplicated as `loaded-elsewhere`.
      if (livePaths.has(key)) matched.add(key);
      // Disabled takes precedence over the join: `getSkills()` applies no
      // `enabled` filter, so absence from the live set proves nothing.
      if (skill.enabled === false) continue;
      skill.status = livePaths.has(key) ? "active" : "not-loaded";
    }
  }

  // Live-but-unresolved: runtime registration, `~/.pi/agent/skills`, an
  // ancestor `.agents/skills` chain, `--skill`, or `skillPaths` in settings.
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

  return {
    ...result,
    contributingSession: {
      sessionId: reporter.sessionId,
      cwd: reporter.cwd,
      differsFromFolder: folderCwd !== undefined && canonical(reporter.cwd) !== canonical(folderCwd),
    },
  };
}

/**
 * Process-wide registry. The writer (`commands_list` in event-wiring) and the
 * reader (`/api/pi-resources`) live in different modules with no shared
 * dependency container, so the store is a module singleton.
 */
export const sessionCommandRegistry = new SessionCommandRegistry();
