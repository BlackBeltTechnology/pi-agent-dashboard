/**
 * Shared keyboard model for `role="menu"` panels in the editor pane (the `+`
 * menu, the document `⋯` menu, the tab context menu). Mirrors the precedent in
 * `components/session/SessionActionsPanel.tsx`: ↑/↓ wrap, Home/End, Escape
 * closes and refocuses the trigger, disabled items are skipped; Enter/Space
 * activate natively (items are `<button>`s).
 *
 * See change: scope-anchor-editor-pane-controls (D9).
 */

/** Enabled menu items under `root`, in DOM order. */
export function enabledMenuItems(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>("[role='menuitem']")).filter(
    (el) => !(el as HTMLButtonElement).disabled && el.getAttribute("aria-disabled") !== "true",
  );
}

/** Roving index for a navigation key (wrapping), or `null` when the key is not navigation. */
export function nextMenuIndex(key: string, at: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case "Home":
      return 0;
    case "End":
      return count - 1;
    case "ArrowDown":
      return at < 0 ? 0 : (at + 1) % count;
    case "ArrowUp":
      return at < 0 ? count - 1 : (at - 1 + count) % count;
    default:
      return null;
  }
}

/** `onKeyDown` for the menu container. `onEscape` closes the menu and refocuses its trigger. */
export function handleMenuKeyDown(e: React.KeyboardEvent<HTMLElement>, root: HTMLElement | null, onEscape: () => void): void {
  // Nothing inside the menu may reach the tab strip / pane key handlers.
  e.stopPropagation();
  if (e.key === "Escape" || e.key === "Tab") {
    e.preventDefault();
    onEscape();
    return;
  }
  const items = enabledMenuItems(root);
  const next = nextMenuIndex(e.key, items.indexOf(document.activeElement as HTMLElement), items.length);
  if (next === null) return;
  e.preventDefault();
  items[next]?.focus();
}
