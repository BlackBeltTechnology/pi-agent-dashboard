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
    // When a child renders NOTHING focusable on its first paint, the container
    // fallback below fires and focus is stranded on a non-interactive box even
    // though the surface fills with controls a tick later. That was masked while
    // every dialog rendered a built-in ✕ (always focusable[0]); suppressing it
    // for `flush` surfaces exposed it — measured on `/settings/general`, which
    // reaches 51 focusables but has 0 at mount. Watch for the first one and
    // hand focus over, at most once, and only while focus is still parked on
    // the container (never steal it back from the user).
    // See change: fix-flush-dialog-scroll-and-close-collision.
    let observer: MutationObserver | undefined;
    if (focusable.length > 0) {
      focusable[0].focus();
    } else {
      container.focus();
      if (typeof MutationObserver !== "undefined") {
        observer = new MutationObserver(() => {
          if (document.activeElement !== container) {
            observer?.disconnect();
            return;
          }
          const late = getFocusable(container);
          if (late.length === 0) return;
          observer?.disconnect();
          late[0].focus();
        });
        // Attributes matter as much as insertion: `getFocusable` keys on
        // `:not([disabled])`, `[hidden]` and `aria-hidden`, so a button that is
        // rendered DISABLED at mount and enables when data lands is a focusable
        // that appears without any node being inserted (`href` likewise, for
        // an anchor that gains one). Watching childList alone would strand
        // focus in exactly that case.
        //
        // Cost is bounded by construction: the observer only exists for a
        // dialog that opened with ZERO focusables, and it disconnects on the
        // first one it finds (or the moment focus leaves the container).
        observer.observe(container, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["disabled", "hidden", "aria-hidden", "tabindex", "href"],
        });
      }
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
      observer?.disconnect();
      document.removeEventListener("keydown", onKeyDown, true);
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [ref, open]);
}
