import type { BrowserToServerMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { ChatImage, SessionState } from "../../lib/chat/event-reducer.js";

/**
 * Renders a file mention as a clickable link. Injected on `ToolContext` so
 * `MarkdownContent` (a generic markdown renderer) depends on this contract
 * rather than importing the concrete `tool-renderers/FileLink` component — an
 * upward dependency that closed the cycle `MarkdownContent -> FileLink ->
 * FilePreviewOverlay -> MarkdownContent`.
 *
 * See change: cleanup-import-cycles (D4b).
 */
export type FileLinkRenderer = (props: {
  key?: string;
  path: string;
  line?: number;
  col?: number;
  absolute?: boolean;
  context: ToolContext;
  children: React.ReactNode;
}) => React.ReactNode;

/** Context passed to every tool renderer */
export interface ToolContext {
  cwd?: string;
  /**
   * File-mention link renderer. Optional to keep `ToolContext` non-breaking for
   * external embedders (it is re-exported from `chat-embed`), but linkification
   * is gated on its PRESENCE — a context built without it renders plain text.
   * Attach it via `makeToolContext`; `ChatView` merges a default for embedders.
   * See change: cleanup-import-cycles (D4b).
   */
  fileLink?: FileLinkRenderer;
  /** Current session id — used by renderers that need to build session-scoped URLs (e.g. subagent popout). Optional for backward-compat. */
  sessionId?: string;
  /** Current session state — used by renderers that drill into per-session sub-state (e.g. subagent inspector). Optional. */
  session?: SessionState;
  /** Send a message to the server (e.g. subagent resync request). Optional for backward-compat / tests. See change: fix-subagent-live-detail-reliability. */
  send?: (message: BrowserToServerMessage) => void;
}

/** Props every tool renderer receives */
export interface ToolRendererProps {
  toolName: string;
  args?: Record<string, unknown>;
  /** `elided` = result not loadable. See change: fix-lazy-history-backfill-ux (D5). */
  status: "running" | "complete" | "error" | "elided";
  result?: string;
  images?: ChatImage[];
  context: ToolContext;
  /** Structured metadata from tool (e.g. AgentDetails from pi-subagents) */
  toolDetails?: Record<string, unknown>;
}

/** A tool renderer is a React component matching this signature */
export type ToolRenderer = React.ComponentType<ToolRendererProps>;
