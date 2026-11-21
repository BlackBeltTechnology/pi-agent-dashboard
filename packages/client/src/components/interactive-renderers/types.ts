/** Props every interactive renderer receives */
export interface InteractiveRendererProps {
  requestId: string;
  /**
   * Owning session, used with `requestId` to key the prompt-answer draft. Absent
   * ⇒ the renderer is ephemeral (nothing persisted or restored).
   * See change: fix-input-state-consistency (#1117).
   */
  sessionId?: string;
  /** Restore/persist pasted images for this prompt (default true). The dialog passes false: its answer road is text-only. */
  restoreImages?: boolean;
  method: string;
  params: Record<string, unknown>;
  status: "pending" | "resolved" | "cancelled" | "dismissed";
  result?: unknown;
  onRespond: (result: unknown) => void;
  onCancel: () => void;
}

/** An interactive renderer is a React component matching this signature */
export type InteractiveRenderer = React.ComponentType<InteractiveRendererProps>;
