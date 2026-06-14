/**
 * Deep-link plumbing between an inline chat MissingToolError and the
 * Settings → Tools `[Install ▾]` dropdown.
 *
 * Two delivery paths cover both states:
 *   1. Settings already open → the dispatched window event reaches the
 *      mounted ToolsSection listener immediately.
 *   2. Settings opening fresh (the common case from chat) → ToolsSection
 *      reads the pending target on mount via `consumePendingToolInstall`,
 *      since the event may fire before the listener attaches.
 *
 * Kept in a leaf module so both ToolsSection and MissingToolInlineError
 * import it without a circular dependency.
 *
 * See change: register-bash-and-tool-install-help.
 */

/** Window event name carrying `{ detail: { toolName } }`. */
export const OPEN_TOOL_INSTALL_EVENT = "pi:open-tool-install";

let pending: string | null = null;

/** Flag the tool whose install dropdown should open, and notify listeners. */
export function requestToolInstall(toolName: string): void {
  pending = toolName;
  try {
    window.dispatchEvent(
      new CustomEvent(OPEN_TOOL_INSTALL_EVENT, { detail: { toolName } }),
    );
  } catch {
    // Non-DOM context (tests) — the pending value still carries the target.
  }
}

/** Read and clear the pending install target. */
export function consumePendingToolInstall(): string | null {
  const p = pending;
  pending = null;
  return p;
}
