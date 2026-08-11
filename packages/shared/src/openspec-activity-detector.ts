/**
 * Detects OpenSpec activity from tool execution events.
 * Returns partial activity info (phase and/or changeName) or null if not openspec-related.
 */
import { isPathInside } from "./path-containment.js";
import type { OpenSpecPhase } from "./types.js";

export interface DetectedActivity {
  phase?: OpenSpecPhase;
  changeName?: string;
  /** True for write/CLI operations (active work), false for reads (passive browsing) */
  isActive?: boolean;
  /**
   * True when the evidence that produced `changeName` looked LOCAL to the
   * session: a path contained by the session cwd, or a change-creating CLI
   * invocation. Consumed by the auto-attach locality gate to suppress a
   * misleading "outside this folder" notice on the create-then-write flow.
   * See change: scope-openspec-auto-attach-to-session-cwd (design D4a).
   */
  localEvidence?: boolean;
}

/**
 * Matches a `cd`/`pushd` relocation target in a command string. Used by the
 * conservative CLI guard: any relocation to a path OUTSIDE the session cwd —
 * anywhere in the command, before or after the openspec invocation — disables
 * CLI-pattern detection for that command entirely.
 * See change: scope-openspec-auto-attach-to-session-cwd (design D3).
 */
const CD_TARGET_RE = /(?:^|[;&|(]|\s)(?:cd|pushd)\s+([^\s;&|)]+)/g;

/** True when `p` looks absolute on either POSIX or Windows. */
function isAbsolutePath(p: string): boolean {
  return p.startsWith("/") || p.startsWith("\\") || /^[a-zA-Z]:[\\/]/.test(p);
}

/** Resolve `p` against `cwd` when relative, then test containment by `cwd`. */
function isWithinCwd(p: string, cwd: string): boolean {
  if (!cwd) return false;
  const abs = isAbsolutePath(p) ? p : `${cwd.replace(/[\\/]+$/, "")}/${p}`;
  return isPathInside(cwd, abs);
}

/**
 * True when the command relocates to a directory that is provably outside the
 * session cwd. Quotes are stripped; `~`/variable/`-` targets are unknowable
 * and therefore NOT treated as outside (the gate in `event-wiring.ts` is the
 * load-bearing guard — this is defence in depth).
 */
function relocatesOutsideCwd(command: string, cwd: string): boolean {
  CD_TARGET_RE.lastIndex = 0;
  let m: RegExpExecArray | null = CD_TARGET_RE.exec(command);
  while (m !== null) {
    const raw = m[1].replace(/^["']|["']$/g, "");
    if (raw && raw !== "-" && !raw.startsWith("$") && !raw.startsWith("~")) {
      if (!isWithinCwd(raw, cwd)) return true;
    }
    m = CD_TARGET_RE.exec(command);
  }
  return false;
}

/** Map from skill directory name suffix to phase */
const SKILL_PHASE_MAP: Record<string, OpenSpecPhase> = {
  "apply-change": "apply",
  "archive-change": "archive",
  "bulk-archive-change": "archive",
  "continue-change": "continue",
  "explore": "explore",
  "ff-change": "ff",
  "new-change": "new",
  "onboard": "onboard",
  "sync-specs": "sync-specs",
  "verify-change": "verify",
};

/** Regex to match openspec skill SKILL.md reads */
const SKILL_PATH_RE = /\.pi\/skills\/openspec-([^/]+)\/SKILL\.md$/;

/** Regex to match openspec change file reads */
const CHANGE_PATH_RE = /openspec\/changes\/([^/]+)\//;

/** Regex to match --change "name" or --change name in CLI commands */
const CLI_CHANGE_FLAG_RE = /openspec\s+\S+.*--change\s+["']?([^\s"']+)["']?/;

/** Regex to match openspec archive <name> */
const CLI_ARCHIVE_RE = /openspec\s+archive\s+["']?([^\s"']+)["']?/;

/** Regex to match openspec new change "name" (positional arg) */
const CLI_NEW_CHANGE_RE = /openspec\s+new\s+change\s+["']?([^\s"']+)["']?/;

/**
 * OpenSpec change-slug shape: lowercase kebab-case, must start with a letter,
 * max 64 characters. Mirrors the validation enforced by `openspec new change`.
 *
 * Single source of truth for any code that needs to gate a captured token
 * before treating it as an OpenSpec change name (detector + auto-attach
 * defense-in-depth in event-wiring.ts).
 *
 * See change: fix-uuid-rename-bug.
 */
const OPENSPEC_CHANGE_SLUG_RE = /^[a-z][a-z0-9-]{0,63}$/;

export function isValidOpenSpecChangeSlug(name: string): boolean {
  return OPENSPEC_CHANGE_SLUG_RE.test(name);
}

export function detectOpenSpecActivity(
  toolName: string,
  args: Record<string, unknown> | undefined,
  /**
   * Session cwd from SERVER state, never from model-supplied arguments
   * (anti-traversal). Required so TypeScript fails closed at every call site.
   * See change: scope-openspec-auto-attach-to-session-cwd.
   */
  cwd: string,
): DetectedActivity | null {
  if (!args) return null;

  const tool = toolName.toLowerCase();

  if (tool === "read") {
    const path = args.path as string | undefined;
    if (!path) return null;

    // Check for skill file read → phase detection
    const skillMatch = path.match(SKILL_PATH_RE);
    if (skillMatch) {
      const suffix = skillMatch[1];
      const phase = SKILL_PHASE_MAP[suffix];
      if (phase) return { phase };
      return null;
    }

    // Check for openspec change file read → change name detection (passive)
    const changeMatch = path.match(CHANGE_PATH_RE);
    if (changeMatch && isValidOpenSpecChangeSlug(changeMatch[1]) && isWithinCwd(path, cwd)) {
      return { changeName: changeMatch[1], isActive: false, localEvidence: true };
    }

    return null;
  }

  if (tool === "write") {
    const path = args.path as string | undefined;
    if (!path) return null;

    const changeMatch = path.match(CHANGE_PATH_RE);
    if (changeMatch && isValidOpenSpecChangeSlug(changeMatch[1]) && isWithinCwd(path, cwd)) {
      return { changeName: changeMatch[1], isActive: true, localEvidence: true };
    }

    return null;
  }

  if (tool === "bash") {
      const command = args.command as string | undefined;
      if (!command || !command.includes("openspec")) return null;

      // Conservative cwd guard (D3): a relocation out of the session cwd
      // anywhere in the command disables ALL CLI-pattern detection for it.
      if (relocatesOutsideCwd(command, cwd)) return null;

      // Try each CLI regex in order; first match wins.
      const newChangeMatch = command.match(CLI_NEW_CHANGE_RE);
      const match =
        command.match(CLI_CHANGE_FLAG_RE) ??
        command.match(CLI_ARCHIVE_RE) ??
        newChangeMatch;
      if (!match) return null;

      const name = match[1];
      // Reject any token that is not a valid OpenSpec change slug. Subsumes the
      // earlier `-`-prefix guard (a leading `-` fails the `[a-z]` first-char
      // class) and additionally rejects UUIDs, mixed-case, underscored, or
      // overlong tokens that the CLI regexes' `[^\s"']+` capture group would
      // otherwise pass through into auto-attach + auto-rename.
      // See changes: fix-openspec-flag-rename-bug, fix-uuid-rename-bug.
      if (!isValidOpenSpecChangeSlug(name)) return null;

      // A change-CREATING invocation is local evidence by construction: the
      // change is being created here, the poll cache just does not list it
      // yet. See design D4a.
      const createdHere = newChangeMatch !== null && newChangeMatch[1] === name;
      return {
        changeName: name,
        isActive: true,
        ...(createdHere ? { localEvidence: true } : {}),
      };
    }

  return null;
}
