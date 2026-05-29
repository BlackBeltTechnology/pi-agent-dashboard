/**
 * OpenSpec tool module — Recipe-based API for the openspec CLI.
 *
 * Replaces the ad-hoc spawnSync/execFile calls in `openspec-poller.ts`
 * with typed Recipes executed through the runner. The higher-level
 * `pollOpenSpec` / `pollOpenSpecAsync` functions remain in
 * `openspec-poller.ts` (they aggregate list + per-change status into
 * the dashboard's OpenSpecData shape) and now use these primitives.
 *
 * See change: platform-command-executor.
 */
import { run, unwrap, type Recipe, type Result } from "./runner.js";

const OPENSPEC_TIMEOUT = 10_000;

interface WithCwd {
  cwd: string;
}

/** Parse JSON from stdout; returns null on parse failure. */
function parseJsonOrNull(out: string): unknown | null {
  const trimmed = out.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

// ── Recipes ─────────────────────────────────────────────────────────────────

export const OPENSPEC_LIST: Recipe<WithCwd, unknown | null> = {
  argv: () => ["openspec", "list", "--json"],
  parse: parseJsonOrNull,
  timeout: OPENSPEC_TIMEOUT,
};

export const OPENSPEC_STATUS: Recipe<WithCwd & { change: string }, unknown | null> = {
  argv: ({ change }) => ["openspec", "status", "--change", change, "--json"],
  parse: parseJsonOrNull,
  timeout: OPENSPEC_TIMEOUT,
};

/**
 * `openspec archive --completed` — bulk-archives all completed changes.
 * Stdout is human-readable (not JSON); callers typically don't parse it,
 * they just await success/failure.
 */
export const OPENSPEC_ARCHIVE_COMPLETED: Recipe<WithCwd, string> = {
  argv: () => ["openspec", "archive", "--completed"],
  parse: (out) => out,
  // Archive operations can be slow when many changes are processed.
  timeout: 30_000,
};

/**
 * `openspec config list --json` — returns the global workflow config
 * (profile / delivery / enabled workflow commands) for the calling user.
 * See change: redesign-session-card-and-composer (config-driven-workflow).
 */
export const OPENSPEC_CONFIG_LIST: Recipe<WithCwd, unknown | null> = {
  argv: () => ["openspec", "config", "list", "--json"],
  parse: parseJsonOrNull,
  timeout: OPENSPEC_TIMEOUT,
};

export const OPENSPEC_RECIPES = {
  OPENSPEC_LIST,
  OPENSPEC_STATUS,
  OPENSPEC_ARCHIVE_COMPLETED,
  OPENSPEC_CONFIG_LIST,
} as const;

// ── Public API ──────────────────────────────────────────────────────────────

/** Run `openspec list --json` and return the parsed JSON, or null on failure. */
export function list(input: WithCwd): Result<unknown | null> {
  return run(OPENSPEC_LIST, input, { cwd: input.cwd });
}

/** Run `openspec status --change <name> --json` and return parsed JSON or null. */
export function status(input: WithCwd & { change: string }): Result<unknown | null> {
  return run(OPENSPEC_STATUS, input, { cwd: input.cwd });
}

/** Run `openspec archive --completed`. Returns raw stdout on success. */
export function archiveCompleted(input: WithCwd): Result<string> {
  return run(OPENSPEC_ARCHIVE_COMPLETED, input, { cwd: input.cwd });
}

/** Run `openspec config list --json`. Returns parsed JSON or null. */
export function configList(input: WithCwd): Result<unknown | null> {
  return run(OPENSPEC_CONFIG_LIST, input, { cwd: input.cwd });
}

export function configListOr(input: WithCwd, fallback: unknown | null = null): unknown | null {
  return unwrap(configList(input), fallback);
}

// ── Best-effort variants (mirror the pattern established in git.ts) ─────────

export function listOr(input: WithCwd, fallback: unknown | null = null): unknown | null {
  return unwrap(list(input), fallback);
}

export function statusOr(
  input: WithCwd & { change: string },
  fallback: unknown | null = null,
): unknown | null {
  return unwrap(status(input), fallback);
}
