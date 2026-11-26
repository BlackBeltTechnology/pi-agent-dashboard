/**
 * Anti-accident gate input (D7): which bash / `user_bash` commands are running
 * right now. Entries start at `tool_execution_start` (bash) or when a wrapped
 * `user_bash` operation begins to exec, and end at `tool_execution_end` or in the
 * operation's `finally`. The bridge never maps a sudo pid to one call (pi runs
 * tool calls in parallel), so the modal lists every command in flight.
 *
 * See change: add-sudo-credential-prompt (D4, D7).
 */

import type { BashOperationsLike } from "../vault-redaction.js";

export interface InFlightEntry {
  id: string;
  command: string;
}

export interface InFlightTracker {
  /** Start an entry for a bash tool call; idempotent per `toolCallId`. */
  beginTool(toolCallId: string, command: string): void;
  endTool(toolCallId: string): void;
  /** Start an anonymous entry (a `!` command); returns the id for `end`. */
  begin(command: string): string;
  end(id: string): void;
  /** Entries in start order. */
  list(): InFlightEntry[];
  size(): number;
  /** Wrap `user_bash` operations: increment with the command at exec start, decrement in `finally`. */
  wrapOperations(ops: BashOperationsLike): BashOperationsLike;
  clear(): void;
}

/** `onEnd` runs after an entry ended, with the remaining size and the ended id. */
export function createInFlightTracker(onEnd?: (endedId: string, remaining: number) => void): InFlightTracker {
  const entries = new Map<string, string>();
  let seq = 0;

  const remove = (id: string): void => {
    if (!entries.delete(id)) return;
    onEnd?.(id, entries.size);
  };

  const begin = (command: string): string => {
    const id = `user:${++seq}`;
    entries.set(id, command);
    return id;
  };

  return {
    beginTool(toolCallId, command) {
      const id = `tool:${toolCallId}`;
      if (!entries.has(id)) entries.set(id, command);
    },
    endTool(toolCallId) {
      remove(`tool:${toolCallId}`);
    },
    begin,
    end: remove,
    list() {
      return [...entries].map(([id, command]) => ({ id, command }));
    },
    size: () => entries.size,
    wrapOperations(ops) {
      return {
        exec: async (command, cwd, options) => {
          const id = begin(command);
          try {
            return await ops.exec(command, cwd, options);
          } finally {
            remove(id);
          }
        },
      };
    },
    clear() {
      entries.clear();
    },
  };
}
