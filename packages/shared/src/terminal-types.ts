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
}

/** Control messages sent as text frames on the terminal WebSocket. */
export type TerminalControlMessage =
  | { type: "resize"; cols: number; rows: number }
  | { type: "title"; title: string };
