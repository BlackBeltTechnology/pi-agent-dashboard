/**
 * AI-drafted commit message via an ephemeral in-process fork-subagent.
 *
 * The bridge seeds a throwaway in-memory `AgentSession` with the live
 * session's context + the staged diff, prompts once for a conventional-commit
 * message, captures the assistant text, and disposes the subagent. The visible
 * conversation is never appended to — zero pollution.
 *
 * This module is self-contained and dependency-injected so a later `git mv`
 * into `packages/git-plugin/` is clean and so the ladder is unit-testable with
 * a stub agent (no real model spawn).
 *
 * Fallback ladder (design.md §4):
 *   1. fork-subagent with full session context   (default)
 *   2. diff-only one-shot (no context)           (context unavailable)
 *   3. deterministic stub from the file list     (no model / errors / timeout)
 *
 * See change: add-session-uncommitted-indicator-and-commit.
 */

export type DraftSource = "fork-subagent" | "diff-only" | "stub";

export interface DraftResult {
  message: string;
  source: DraftSource;
}

export interface DraftDeps {
  /** Repo-relative files chosen for the commit (drives the stub fallback). */
  files: string[];
  /** Build `git diff HEAD -- <files>` (already scoped to the chosen files). */
  buildDiff: () => Promise<string> | string;
  /**
   * Compact text summary of the live session's context (from
   * `buildSessionContext()`), or `undefined` when unavailable → forces the
   * diff-only rung.
   */
  buildContext?: () => string | undefined;
  /**
   * Run one ephemeral agent turn on `seed` and resolve with the assistant
   * text. Encapsulates createAgentSession → prompt → capture → dispose so the
   * ladder can be tested with a stub. Throws / rejects to trigger a fallback.
   */
  runAgent?: (seed: string) => Promise<string>;
  /** Draft timeout (ms). On elapse the current rung is abandoned. Default 30s. */
  timeoutMs?: number;
  /** Cap the diff bytes fed to the model. Default 24_000. */
  maxDiffBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_DIFF = 24_000;

const INSTRUCTION =
  "Write a single Conventional Commits message for the staged changes below. " +
  "Output ONLY the commit message: a concise `type(scope): subject` line (<=72 chars), " +
  "then an optional blank line and body. No code fences, no preamble, no explanation.";

/** Truncate a diff to a byte budget, appending a marker when clipped. */
export function clampDiff(diff: string, maxBytes: number): string {
  if (diff.length <= maxBytes) return diff;
  return `${diff.slice(0, maxBytes)}\n\n[diff truncated at ${maxBytes} bytes]`;
}

/** Deterministic fallback message derived from the chosen file list. */
export function stubMessage(files: string[]): string {
  if (files.length === 0) return "chore: update files";
  if (files.length === 1) return `chore: update ${files[0]}`;
  return `chore: update ${files.length} files\n\n${files.map((f) => `- ${f}`).join("\n")}`;
}

/** Reject after `ms` so a hung agent turn cannot stall the dialog. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("draft-timeout")), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/** Strip code fences / stray leading labels a model may wrap the message in. */
export function sanitizeDraft(text: string): string {
  let s = text.trim();
  // Remove a leading ```lang fence and trailing fence.
  s = s.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "");
  return s.trim();
}

/**
 * Produce a commit message via the fallback ladder. Never throws — always
 * resolves with a usable message (worst case, the deterministic stub).
 */
export async function draftCommitMessage(deps: DraftDeps): Promise<DraftResult> {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxDiff = deps.maxDiffBytes ?? DEFAULT_MAX_DIFF;

  let diff = "";
  try {
    diff = clampDiff(String(await deps.buildDiff()), maxDiff);
  } catch {
    diff = "";
  }

  // No agent available → straight to stub.
  if (!deps.runAgent) {
    return { message: stubMessage(deps.files), source: "stub" };
  }

  // Rung 1: fork-subagent with full context.
  const context = deps.buildContext?.();
  if (context) {
    try {
      const seed = `${INSTRUCTION}\n\n## Session context\n${context}\n\n## Diff\n\`\`\`diff\n${diff}\n\`\`\``;
      const text = await withTimeout(deps.runAgent(seed), timeoutMs);
      const msg = sanitizeDraft(text);
      if (msg) return { message: msg, source: "fork-subagent" };
    } catch {
      /* fall through */
    }
  }

  // Rung 2: diff-only one-shot.
  try {
    const seed = `${INSTRUCTION}\n\n## Diff\n\`\`\`diff\n${diff}\n\`\`\``;
    const text = await withTimeout(deps.runAgent(seed), timeoutMs);
    const msg = sanitizeDraft(text);
    if (msg) return { message: msg, source: "diff-only" };
  } catch {
    /* fall through */
  }

  // Rung 3: deterministic stub.
  return { message: stubMessage(deps.files), source: "stub" };
}
