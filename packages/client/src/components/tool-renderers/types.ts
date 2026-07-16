import type { BrowserToServerMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { ChatImage, SessionState } from "../../lib/event-reducer.js";

/** Context passed to every tool renderer */
export interface ToolContext {
  cwd?: string;
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
  status: "running" | "complete" | "error";
  result?: string;
  images?: ChatImage[];
  context: ToolContext;
  /** Structured metadata from tool (e.g. AgentDetails from pi-subagents) */
  toolDetails?: Record<string, unknown>;
}

/** A tool renderer is a React component matching this signature */
export type ToolRenderer = React.ComponentType<ToolRendererProps>;
