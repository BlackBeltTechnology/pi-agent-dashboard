/**
 * In-memory FIFO queue of pending initial-prompt intents per cwd.
 *
 * Lifecycle (mirrors pending-attach-registry):
 *   1. Browser sends `spawn_session { cwd, initialPrompt }` → server enqueues.
 *   2. Bridge later issues `session_register { sessionId, cwd }` → server
 *      consumes the head intent for that cwd and dispatches it as the first
 *      `send_prompt` into the session.
 *
 * Used by the no-hook Initialize button (folder-action-bar): it spawns an
 * interactive session and pre-injects `/skill:project-init` so the guided
 * scaffolder starts without the user typing anything.
 *
 * Constraints match pending-attach-registry: per-cwd FIFO, capped at 8,
 * entries older than 60 s discarded, cwd normalized via `safeRealpathSync`.
 * In-memory only; NOT persisted across restarts.
 *
 * See change: project-init-skill-and-profiles.
 */
import { safeRealpathSync } from "./resolve-path.js";

interface PendingPrompt {
  prompt: string;
  enqueuedAt: number;
}

export const PENDING_INITIAL_PROMPT_TTL_MS = 60_000;
export const PENDING_INITIAL_PROMPT_QUEUE_CAP = 8;

export interface PendingInitialPromptRegistry {
  enqueue(cwd: string, prompt: string): boolean;
  consume(cwd: string): string | null;
  size(cwd: string): number;
}

export interface PendingInitialPromptRegistryOptions {
  now?: () => number;
  normalize?: (cwd: string) => string;
  warn?: (msg: string) => void;
}

export function createPendingInitialPromptRegistry(
  opts: PendingInitialPromptRegistryOptions = {},
): PendingInitialPromptRegistry {
  const now = opts.now ?? (() => Date.now());
  const normalize = opts.normalize ?? ((cwd: string) => safeRealpathSync(stripTrailingSep(cwd)));
  const warn = opts.warn ?? ((m: string) => console.warn(m));

  const store = new Map<string, PendingPrompt[]>();

  function pruneStale(key: string): PendingPrompt[] {
    const queue = store.get(key);
    if (!queue) return [];
    const cutoff = now() - PENDING_INITIAL_PROMPT_TTL_MS;
    while (queue.length > 0 && queue[0]!.enqueuedAt < cutoff) {
      const stale = queue.shift()!;
      warn(
        `[pending-initial-prompt-registry] dropping stale intent: cwd=${key} ageMs=${now() - stale.enqueuedAt}`,
      );
    }
    if (queue.length === 0) {
      store.delete(key);
      return [];
    }
    return queue;
  }

  return {
    enqueue(cwd: string, prompt: string): boolean {
      if (!prompt) return false;
      const key = normalize(cwd);
      const queue = pruneStale(key);
      if (queue.length >= PENDING_INITIAL_PROMPT_QUEUE_CAP) {
        warn(
          `[pending-initial-prompt-registry] queue cap reached (${PENDING_INITIAL_PROMPT_QUEUE_CAP}) for cwd=${key}; dropping`,
        );
        return false;
      }
      queue.push({ prompt, enqueuedAt: now() });
      store.set(key, queue);
      return true;
    },

    consume(cwd: string): string | null {
      const key = normalize(cwd);
      const queue = pruneStale(key);
      if (queue.length === 0) return null;
      const head = queue.shift()!;
      if (queue.length === 0) store.delete(key);
      return head.prompt;
    },

    size(cwd: string): number {
      const key = normalize(cwd);
      return pruneStale(key).length;
    },
  };
}

function stripTrailingSep(p: string): string {
  if (p.length > 1 && (p.endsWith("/") || p.endsWith("\\"))) {
    return p.replace(/[/\\]+$/, "");
  }
  return p;
}
