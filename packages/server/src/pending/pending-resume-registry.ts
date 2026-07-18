/**
 * Tracks pending auto-resume operations: prompts queued for ended sessions
 * being resumed. Entries expire after 30 seconds if not consumed.
 */

import type { ImageContent } from "@blackbelt-technology/pi-dashboard-shared/types.js";

const EXPIRY_MS = 30_000;

export interface PendingResumeEntry {
  text: string;
  images?: ImageContent[];
  oldSessionId: string;
  sessionFile: string;
}

interface InternalEntry extends PendingResumeEntry {
  timer: ReturnType<typeof setTimeout>;
}

export interface PendingResumeRegistryOptions {
  /** Called when a pending resume expires without being consumed. */
  onTimeout?: (oldSessionId: string) => void;
}

export interface PendingResumeRegistry {
  /** Record a pending resume for a cwd. Overwrites any previous entry for the same cwd. */
  record(cwd: string, entry: PendingResumeEntry): void;
  /** Consume and return the pending resume for a cwd, or undefined if none pending. */
  consume(cwd: string): PendingResumeEntry | undefined;
  /** Clear all pending entries and timers. */
  dispose(): void;
}

export function createPendingResumeRegistry(
  options?: PendingResumeRegistryOptions,
): PendingResumeRegistry {
  const pending = new Map<string, InternalEntry>();

  return {
    record(cwd: string, entry: PendingResumeEntry): void {
      const existing = pending.get(cwd);
      if (existing) {
        clearTimeout(existing.timer);
      }
      const timer = setTimeout(() => {
        pending.delete(cwd);
        options?.onTimeout?.(entry.oldSessionId);
      }, EXPIRY_MS);
      pending.set(cwd, { ...entry, timer });
    },

    consume(cwd: string): PendingResumeEntry | undefined {
      const entry = pending.get(cwd);
      if (!entry) return undefined;
      clearTimeout(entry.timer);
      pending.delete(cwd);
      const { timer: _, ...result } = entry;
      return result;
    },

    dispose(): void {
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
      }
      pending.clear();
    },
  };
}
