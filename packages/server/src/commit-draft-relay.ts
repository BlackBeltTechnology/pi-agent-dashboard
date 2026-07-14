/**
 * Server-side relay for the AI-draft commit message: correlates an HTTP
 * request to the bridge's async `git_commit_draft_result`.
 *
 * The `/api/git/commit-draft` route calls `request(...)`, which sends
 * `git_commit_draft { requestId }` to the owning bridge and returns a promise.
 * When the bridge replies, `event-wiring` calls `resolve(msg)` to settle it.
 * A timeout guarantees the route never hangs — on elapse it resolves with a
 * stub so the dialog degrades gracefully.
 *
 * Self-contained + plugin-ready (clean `git mv` into `packages/git-plugin/`).
 * See change: add-session-uncommitted-indicator-and-commit.
 */
import { randomUUID } from "node:crypto";
import type { GitCommitDraftResultMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";

export interface CommitDraftResult {
  message: string;
  source: "fork-subagent" | "diff-only" | "stub";
}

export interface CommitDraftRelay {
  /**
   * Send `git_commit_draft` to `sessionId` and await the reply. Resolves with
   * a stub on timeout (never rejects). `send` returns false when the bridge is
   * not connected → immediate stub.
   */
  request(args: {
    sessionId: string;
    cwd: string;
    files: string[];
    send: (msg: {
      type: "git_commit_draft";
      sessionId: string;
      requestId: string;
      cwd: string;
      files: string[];
    }) => boolean;
    timeoutMs?: number;
  }): Promise<CommitDraftResult>;
  /** Settle the pending request for `msg.requestId` (from event-wiring). */
  resolve(msg: GitCommitDraftResultMessage): void;
  /** Pending request count (for tests). */
  size(): number;
}

const DEFAULT_TIMEOUT_MS = 35_000;

function stub(files: string[]): CommitDraftResult {
  const message =
    files.length === 1 ? `chore: update ${files[0]}` : `chore: update ${files.length} files`;
  return { message, source: "stub" };
}

export function createCommitDraftRelay(): CommitDraftRelay {
  const pending = new Map<
    string,
    { resolve: (r: CommitDraftResult) => void; timer: ReturnType<typeof setTimeout>; files: string[] }
  >();

  return {
    request({ sessionId, cwd, files, send, timeoutMs }) {
      const requestId = randomUUID();
      return new Promise<CommitDraftResult>((resolve) => {
        const settle = (r: CommitDraftResult) => {
          const entry = pending.get(requestId);
          if (!entry) return;
          clearTimeout(entry.timer);
          pending.delete(requestId);
          resolve(r);
        };
        const timer = setTimeout(() => settle(stub(files)), timeoutMs ?? DEFAULT_TIMEOUT_MS);
        pending.set(requestId, { resolve: settle, timer, files });

        const ok = send({ type: "git_commit_draft", sessionId, requestId, cwd, files });
        if (!ok) settle(stub(files));
      });
    },
    resolve(msg) {
      const entry = pending.get(msg.requestId);
      if (!entry) return;
      entry.resolve({ message: msg.message, source: msg.source });
    },
    size() {
      return pending.size;
    },
  };
}
