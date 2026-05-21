/**
 * Type contracts for `MinimalChatView`.
 *
 * Producer adapters (e.g. `SubagentDetailView`, `FlowAgentDetail` shims)
 * convert their plugin-specific state shapes into these structural types
 * before passing them to `MinimalChatView`.
 *
 * See change: extract-minimal-chat-view.
 */
import type { ReactNode } from "react";

/** Layout mode of `MinimalChatView`. */
export type MinimalChatMode = "inline" | "popout" | "row";

/**
 * Normalized status union. Producer adapters MUST map their plugin-specific
 * status enum into this union; the view never sees producer-specific tokens.
 *
 * Mapping tables (see design §Decision 2):
 *  - SubagentState: created → pending, running → running, completed → complete, failed → error
 *  - FlowAgentState: identity (already uses these tokens)
 */
export type MinimalChatStatus =
  | "pending"
  | "running"
  | "complete"
  | "error"
  | "blocked";

/**
 * One timeline entry. The discriminated union is the structural intersection
 * of `SubagentTimelineEntry` and `FlowDetailEntry`. Producer-specific extras
 * (e.g. `ts: number` on `SubagentTimelineEntry`) are dropped at the shim
 * boundary.
 */
export type MinimalChatEntry =
  | {
      kind: "tool";
      toolName: string;
      input: unknown;
      output?: unknown;
      isError?: boolean;
    }
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "error"; text: string };

/**
 * Header-right meta. Renders only when fields are present; no placeholder
 * dashes for missing values.
 */
export interface MinimalChatMeta {
  modelName?: string;
  tokens?: { input?: number; output?: number };
  durationMs?: number;
}

export interface MinimalChatViewProps {
  /** Header title (e.g. agent name, "code-reviewer"). */
  title: string;
  /** Optional read-only path / sub-title under the title (e.g. agentMdPath). */
  subtitle?: string;
  status: MinimalChatStatus;
  entries: MinimalChatEntry[];
  /** Optional header-right meta block. Rendered only when supplied. */
  meta?: MinimalChatMeta;
  /** Default: "inline". */
  mode?: MinimalChatMode;
  /** Back button handler (renders the chevron-left when set). */
  onBack?: () => void;
  /** Optional empty-state message override; default is mode-aware. */
  emptyMessage?: string;
  /** Optional footer (e.g. flow's "Summary" markdown block). */
  footer?: ReactNode;
  /**
   * Optional live activity string. Rendered under the title in
   * `inline`/`popout` modes only when status is `running`. In `row` mode it
   * is shown inline next to the title.
   */
  activity?: string;
  /**
   * Optional session id. Forwarded to the registered `toolCallStep` UI
   * primitive so its per-tool renderers can build session-scoped links
   * (e.g. subagent popouts). When omitted, the renderers fall back to
   * non-session-scoped behavior.
   *
   * See change: fix-flows-plugin-polish (chat-view parity).
   */
  sessionId?: string;
}
