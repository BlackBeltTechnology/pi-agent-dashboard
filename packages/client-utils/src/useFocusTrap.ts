import { useEffect, type RefObject } from "react";

/**
 * Focus management for modal dialogs.
 *
 * On `open` transition to true: stores the previously-focused element,
 * moves focus to the first focusable child inside `ref` (or the container
 * itself if none), and traps `Tab` / `Shift+Tab` within the container.
 * On close (or unmount): restores focus to the previously-focused element
 * if it is still in the document.
 *
 * See change: unify-dialog-system (design.md D4).
 */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((el) => !el.hasAttribute("hidden") && el.getAttribute("aria-hidden") !== "true");
}

export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
): void {
  useEffect(() => {
    if (!open) return;
    const container = ref.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusable = getFocusable(container);
    if (focusable.length > 0) {
      focusable[0].focus();
    } else {
      container.focus();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const node = ref.current;
      if (!node) return;
      const items = getFocusable(node);
      if (items.length === 0) {
        e.preventDefault();
        node.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !node.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !node.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [ref, open]);
}
