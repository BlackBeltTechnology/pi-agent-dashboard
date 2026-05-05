/**
 * Detects OpenSpec activity from tool execution events.
 * Returns partial activity info (phase and/or changeName) or null if not openspec-related.
 */
import type { OpenSpecPhase } from "./types.js";

export interface DetectedActivity {
  phase?: OpenSpecPhase;
  changeName?: string;
  /** True for write/CLI operations (active work), false for reads (passive browsing) */
  isActive?: boolean;
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
    if (changeMatch && isValidOpenSpecChangeSlug(changeMatch[1])) {
      return { changeName: changeMatch[1], isActive: false };
    }

    return null;
  }

  if (tool === "write") {
    const path = args.path as string | undefined;
    if (!path) return null;

    const changeMatch = path.match(CHANGE_PATH_RE);
    if (changeMatch && isValidOpenSpecChangeSlug(changeMatch[1])) {
      return { changeName: changeMatch[1], isActive: true };
    }

    return null;
  }

  if (tool === "bash") {
      const command = args.command as string | undefined;
      if (!command || !command.includes("openspec")) return null;

      // Try each CLI regex in order; first match wins.
      const match =
        command.match(CLI_CHANGE_FLAG_RE) ??
        command.match(CLI_ARCHIVE_RE) ??
        command.match(CLI_NEW_CHANGE_RE);
      if (!match) return null;

      const name = match[1];
      // Reject any token that is not a valid OpenSpec change slug. Subsumes the
      // earlier `-`-prefix guard (a leading `-` fails the `[a-z]` first-char
      // class) and additionally rejects UUIDs, mixed-case, underscored, or
      // overlong tokens that the CLI regexes' `[^\s"']+` capture group would
      // otherwise pass through into auto-attach + auto-rename.
      // See changes: fix-openspec-flag-rename-bug, fix-uuid-rename-bug.
      if (!isValidOpenSpecChangeSlug(name)) return null;

      return { changeName: name, isActive: true };
    }

  return null;
}
