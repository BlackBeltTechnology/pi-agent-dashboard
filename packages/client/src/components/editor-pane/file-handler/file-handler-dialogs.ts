/**
 * Dialog request model shared by the handler host (first-overwrite notice,
 * conflict dialog), the instance store (guards, eviction) and the layer that
 * renders them. A request is `ask`ed through the store's queue and resolves to
 * the chosen action id, or `null` for Cancel / dismissal.
 *
 * See change: add-editor-pane-file-handlers (D3, D5).
 */

interface HandlerDialogAction {
  id: string;
  label: string;
  intent?: "primary" | "danger" | "neutral";
}

export interface HandlerDialogRequest {
  title: string;
  message: string;
  /** Extra lines (e.g. the unsaved tabs an eviction dialog names). */
  list?: string[];
  /** Action buttons; a Cancel button is always added by the renderer. */
  actions: HandlerDialogAction[];
  /** `data-testid` of the dialog root. */
  testId?: string;
}

/** Resolves to the chosen action id, or `null` for Cancel / dismissal. */
export type AskHandlerDialog = (req: HandlerDialogRequest) => Promise<string | null>;
