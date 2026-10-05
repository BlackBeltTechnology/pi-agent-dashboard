/**
 * Shared types for the terminal emulator feature.
 */

export interface TerminalSession {
  id: string;
  cwd: string;
  shell: string;
  status: "active" | "ended";
  title?: string;
  manuallyRenamed?: boolean;
  createdAt: number;
  /**
   * Inline interactive terminal cards spawn ephemeral terminals. Ephemeral
   * terminals are excluded from the content-area TerminalsView tab bar so
   * they don't clutter a folder's terminal tabs.
   * See change: add-inline-terminal-card.
   */
  ephemeral?: boolean;
  /**
   * Owner `(iss, sub)` stamped at spawn while the identity plane is enforced
   * (design D11/D24, task 18.13). Same rule as sessions: exact equality, an
   * ownerless terminal is invisible/unreachable to every human principal; the
   * break-glass operator sees all. Absent in the inert era.
   */
  principalOwner?: { iss: string; sub: string };
}

/** Control messages sent as text frames on the terminal WebSocket. */
export type TerminalControlMessage =
  | { type: "resize"; cols: number; rows: number }
  | { type: "title"; title: string };
