/**
 * Jujutsu (jj) tool module — Recipe-based API for jj operations the
 * dashboard runs from multiple call sites (bridge VCS probe, jj-plugin
 * server routes, session-diff regime-aware enrichment).
 *
 * Mirror of `platform/git.ts`: every function is a thin wrapper over
 * `run(recipe, input)`. No `child_process` imports, no `process.platform`
 * branches, no inline shell-escape logic.
 *
 * **Minimum jj version**: target `>= 0.18.0` for `workspace add -r`,
 * `op restore`, `fork_point()`, and `--no-pager`. The version is
 * captured in tool-registry metadata only; no runtime gate yet.
 *
 * **Output parsing strategy**: `jj` does not have a stable `--json` flag
 * across the commands we use. Where parsing is required (`workspaceList`,
 * `workspaceRoot`, `version`), we parse the human-readable output with
 * defensive regexes. Mutation commands (`workspaceAdd`, `bookmarkCreate`,
 * etc.) just check exit codes.
 *
 * See change: add-jj-workspace-plugin.
 */
import { run, unwrap, type Recipe, type Result } from "./runner.js";

// ── Recipes (pure data) ─────────────────────────────────────────────────────

const JJ_TIMEOUT = 15_000;

interface WithCwd {
  cwd: string;
}

/** `jj --version` → semver string (e.g. "jj 0.18.0"). */
export const JJ_VERSION: Recipe<{}, string | undefined> = {
  argv: () => ["jj", "--version"],
  parse: (out) => {
    const m = out.match(/jj\s+([0-9]+\.[0-9]+\.[0-9]+)/);
    return m ? m[1] : out.trim() || undefined;
  },
  timeout: JJ_TIMEOUT,
};

/**
 * `jj workspace root` → absolute path of the current workspace's root.
 * Errors when cwd is not inside a jj repo.
 */
export const JJ_WORKSPACE_ROOT: Recipe<WithCwd, string | undefined> = {
  argv: () => ["jj", "workspace", "root"],
  parse: (out) => out.trim() || undefined,
  timeout: JJ_TIMEOUT,
};

/**
 * `jj workspace list` → raw output, one workspace per line.
 * Format (jj 0.18+): `<name>: <change-id-short> <commit-id-short> (...) <desc>`
 * Caller parses via `parseWorkspaceList`.
 */
export const JJ_WORKSPACE_LIST: Recipe<WithCwd, string> = {
  argv: () => ["jj", "workspace", "list", "--no-pager"],
  parse: (out) => out,
  timeout: JJ_TIMEOUT,
};

/**
 * `jj workspace add <abs-path> [-r <rev>]` — non-destructive on the
 * source workspace; creates a new working-copy commit on top of `rev`.
 */
export const JJ_WORKSPACE_ADD: Recipe<
  WithCwd & { destPath: string; baseRev?: string },
  void
> = {
  argv: ({ destPath, baseRev }) => {
    const argv: string[] = ["jj", "workspace", "add", destPath];
    if (baseRev) argv.push("-r", baseRev);
    return argv;
  },
  parse: () => undefined,
  timeout: JJ_TIMEOUT,
};

/** `jj workspace forget <name>` — detaches without deleting files on disk. */
export const JJ_WORKSPACE_FORGET: Recipe<WithCwd & { name: string }, void> = {
  argv: ({ name }) => ["jj", "workspace", "forget", name],
  parse: () => undefined,
  timeout: JJ_TIMEOUT,
};

/** `jj bookmark create <name> -r <rev>`. */
export const JJ_BOOKMARK_CREATE: Recipe<
  WithCwd & { name: string; rev: string },
  void
> = {
  argv: ({ name, rev }) => ["jj", "bookmark", "create", name, "-r", rev],
  parse: () => undefined,
  timeout: JJ_TIMEOUT,
};

/**
 * `jj bookmark list -T 'name ++ "\n"'` — list bookmark names, one per line.
 * Used by fold-back to check whether a bookmark name already exists.
 */
export const JJ_BOOKMARK_LIST: Recipe<WithCwd, string> = {
  argv: () => ["jj", "bookmark", "list", "-T", 'name ++ "\\n"', "--no-pager"],
  parse: (out) => out,
  timeout: JJ_TIMEOUT,
};

/** `jj git init --colocate` — converts a plain-git cwd into a jj-colocated repo. */
export const JJ_GIT_INIT_COLOCATE: Recipe<WithCwd, void> = {
  argv: () => ["jj", "git", "init", "--colocate"],
  parse: () => undefined,
  timeout: JJ_TIMEOUT,
};

/** `jj git push --bookmark <name>` — translates jj history to git refs. */
export const JJ_GIT_PUSH: Recipe<WithCwd & { bookmark: string }, void> = {
  argv: ({ bookmark }) => ["jj", "git", "push", "--bookmark", bookmark],
  parse: () => undefined,
  timeout: JJ_TIMEOUT,
};

/**
 * `jj diff [--from R1] [--to R2] [-- <path>]` — unified diff output.
 * Default invocation diffs the working copy (`@`) against its parent (`@-`).
 */
export const JJ_DIFF: Recipe<
  WithCwd & { fromRev?: string; toRev?: string; path?: string },
  string
> = {
  argv: ({ fromRev, toRev, path }) => {
    const argv: string[] = ["jj", "diff", "--no-pager"];
    if (fromRev) argv.push("--from", fromRev);
    if (toRev) argv.push("--to", toRev);
    if (path) argv.push("--", path);
    return argv;
  },
  parse: (out) => out,
  timeout: JJ_TIMEOUT,
};

/**
 * `jj resolve --list` — newline-separated list of files with conflicts.
 * Empty output means no conflicts; tolerated exit 1 for "nothing to resolve".
 */
export const JJ_RESOLVE_LIST: Recipe<WithCwd, string> = {
  argv: () => ["jj", "resolve", "--list", "--no-pager"],
  parse: (out) => out,
  timeout: JJ_TIMEOUT,
  tolerate: [1],
};

/**
 * `jj op log -T 'id.short() ++ "\n"' --limit 1` — current op id (short).
 * Used by fold-back to capture pre-rebase state for `op restore`.
 */
export const JJ_OP_LOG_HEAD: Recipe<WithCwd, string | undefined> = {
  argv: () => [
    "jj", "op", "log",
    "-T", 'id.short() ++ "\\n"',
    "--limit", "1",
    "--no-pager",
  ],
  parse: (out) => out.trim().split("\n")[0]?.trim() || undefined,
  timeout: JJ_TIMEOUT,
};

/** `jj op restore <op-id>` — undo back to the given operation. */
export const JJ_OP_RESTORE: Recipe<WithCwd & { opId: string }, void> = {
  argv: ({ opId }) => ["jj", "op", "restore", opId],
  parse: () => undefined,
  timeout: JJ_TIMEOUT,
};

/** `jj rebase -d <dest> -s <src>` — rebase src and descendants onto dest. */
export const JJ_REBASE: Recipe<
  WithCwd & { dest: string; src: string },
  void
> = {
  argv: ({ dest, src }) => ["jj", "rebase", "-d", dest, "-s", src],
  parse: () => undefined,
  timeout: JJ_TIMEOUT,
};

/**
 * `jj log -r '<revset>' -T 'change_id.short() ++ "\n"'` —
 * list change ids matching a revset, one per line.
 * Used to check for unfolded commits and resolve `fork_point()`.
 */
export const JJ_LOG_REVSET: Recipe<
  WithCwd & { revset: string; template?: string },
  string
> = {
  argv: ({ revset, template }) => [
    "jj", "log",
    "-r", revset,
    "-T", template ?? 'change_id.short() ++ "\\n"',
    "--no-pager",
    "--no-graph",
  ],
  parse: (out) => out,
  timeout: JJ_TIMEOUT,
};

// ── Registry ────────────────────────────────────────────────────────────────

export const JJ_RECIPES = {
  JJ_VERSION,
  JJ_WORKSPACE_ROOT,
  JJ_WORKSPACE_LIST,
  JJ_WORKSPACE_ADD,
  JJ_WORKSPACE_FORGET,
  JJ_BOOKMARK_CREATE,
  JJ_BOOKMARK_LIST,
  JJ_GIT_INIT_COLOCATE,
  JJ_GIT_PUSH,
  JJ_DIFF,
  JJ_RESOLVE_LIST,
  JJ_OP_LOG_HEAD,
  JJ_OP_RESTORE,
  JJ_REBASE,
  JJ_LOG_REVSET,
} as const;

// ── Public typed API ────────────────────────────────────────────────────────

export function version(): Result<string | undefined> {
  return run(JJ_VERSION, {}, {});
}

export function workspaceRoot(input: WithCwd): Result<string | undefined> {
  return run(JJ_WORKSPACE_ROOT, input, { cwd: input.cwd });
}

export function workspaceList(input: WithCwd): Result<string> {
  return run(JJ_WORKSPACE_LIST, input, { cwd: input.cwd });
}

export function workspaceAdd(
  input: WithCwd & { destPath: string; baseRev?: string },
): Result<void> {
  return run(JJ_WORKSPACE_ADD, input, { cwd: input.cwd });
}

export function workspaceForget(
  input: WithCwd & { name: string },
): Result<void> {
  return run(JJ_WORKSPACE_FORGET, input, { cwd: input.cwd });
}

export function bookmarkCreate(
  input: WithCwd & { name: string; rev: string },
): Result<void> {
  return run(JJ_BOOKMARK_CREATE, input, { cwd: input.cwd });
}

export function bookmarkList(input: WithCwd): Result<string> {
  return run(JJ_BOOKMARK_LIST, input, { cwd: input.cwd });
}

export function gitInitColocate(input: WithCwd): Result<void> {
  return run(JJ_GIT_INIT_COLOCATE, input, { cwd: input.cwd });
}

export function gitPush(
  input: WithCwd & { bookmark: string },
): Result<void> {
  return run(JJ_GIT_PUSH, input, { cwd: input.cwd });
}

export function diff(
  input: WithCwd & { fromRev?: string; toRev?: string; path?: string },
): Result<string> {
  return run(JJ_DIFF, input, { cwd: input.cwd });
}

export function resolveList(input: WithCwd): Result<string> {
  return run(JJ_RESOLVE_LIST, input, { cwd: input.cwd });
}

export function opLogHead(input: WithCwd): Result<string | undefined> {
  return run(JJ_OP_LOG_HEAD, input, { cwd: input.cwd });
}

export function opRestore(
  input: WithCwd & { opId: string },
): Result<void> {
  return run(JJ_OP_RESTORE, input, { cwd: input.cwd });
}

export function rebase(
  input: WithCwd & { dest: string; src: string },
): Result<void> {
  return run(JJ_REBASE, input, { cwd: input.cwd });
}

export function logRevset(
  input: WithCwd & { revset: string; template?: string },
): Result<string> {
  return run(JJ_LOG_REVSET, input, { cwd: input.cwd });
}

// ── Best-effort wrappers ────────────────────────────────────────────────────

export function versionOr(fallback?: string): string | undefined {
  return unwrap(version(), fallback);
}

export function workspaceRootOr(
  input: WithCwd,
  fallback?: string,
): string | undefined {
  return unwrap(workspaceRoot(input), fallback);
}

export function workspaceListOr(input: WithCwd, fallback = ""): string {
  return unwrap(workspaceList(input), fallback);
}

export function diffOr(
  input: WithCwd & { fromRev?: string; toRev?: string; path?: string },
  fallback = "",
): string {
  return unwrap(diff(input), fallback);
}

export function resolveListOr(input: WithCwd, fallback = ""): string {
  return unwrap(resolveList(input), fallback);
}

export function opLogHeadOr(
  input: WithCwd,
  fallback?: string,
): string | undefined {
  return unwrap(opLogHead(input), fallback);
}

export function bookmarkListOr(input: WithCwd, fallback = ""): string {
  return unwrap(bookmarkList(input), fallback);
}

// ── Pure parsers (separate from I/O for unit testability) ───────────────────

export interface JjWorkspaceEntry {
  /** Workspace name (e.g. "default", "agent-1"). */
  name: string;
  /** Short change id of the workspace's working-copy commit. */
  changeIdShort?: string;
  /** Short commit id (the underlying git commit when colocated). */
  commitIdShort?: string;
  /** Working-copy description, if any. */
  description?: string;
}

/**
 * Parse `jj workspace list` output into structured entries.
 * Format: `<name>: <change-id-short> <commit-id-short> [(empty)] [(no description set) | <desc>]`
 *
 * Defensive: skips lines that don't match the expected shape.
 */
export function parseWorkspaceList(raw: string): JjWorkspaceEntry[] {
  const entries: JjWorkspaceEntry[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx <= 0) continue;
    const name = trimmed.slice(0, colonIdx).trim();
    const rest = trimmed.slice(colonIdx + 1).trim();
    if (!name) continue;
    // The remainder typically starts with two short ids separated by space.
    const idMatch = rest.match(/^([0-9a-z]+)\s+([0-9a-f]+)/i);
    const entry: JjWorkspaceEntry = { name };
    if (idMatch) {
      entry.changeIdShort = idMatch[1];
      entry.commitIdShort = idMatch[2];
      // Strip jj's parenthesized markers ((empty), (no description set),
      // (conflict), etc.) and only keep what's left as the description.
      let after = rest.slice(idMatch[0].length).trim();
      while (/^\([^)]*\)/.test(after)) {
        after = after.replace(/^\([^)]*\)\s*/, "");
      }
      if (after) {
        entry.description = after;
      }
    }
    entries.push(entry);
  }
  return entries;
}

/**
 * Given a workspace root absolute path and the parsed workspace list, find
 * the workspace name whose working copy lives at that path. Returns
 * `undefined` if no entry matches.
 *
 * Note: `jj workspace list` does not include the workspace path; resolution
 * by name happens via the bridge probe checking `<workspace-name>@` revsets
 * separately. For the bridge's purposes, we ALSO read `.jj/repo/working_copy/`
 * filesystem layout — this parser is a structural fallback only.
 */
export function findWorkspaceByName(
  entries: readonly JjWorkspaceEntry[],
  name: string,
): JjWorkspaceEntry | undefined {
  return entries.find((e) => e.name === name);
}
