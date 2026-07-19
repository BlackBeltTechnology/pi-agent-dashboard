import { useEffect, useId, useRef } from "react";

/**
 * Shared escape-dismiss stack.
 *
 * A **single module-stable** `keydown` listener maintains a LIFO stack of
 * registered dismissible layers (dialogs, image lightbox, file-preview overlay).
 * On `Escape` it invokes the `onEscape` of **only the topmost** registered layer,
 * so stacked full-screen surfaces peel one-per-press instead of all closing at
 * once. Topmost-only dismissal is enforced by the stack itself — no cross-listener
 * arbitration is required.
 *
 * ## Listener phase — `document`, bubble
 *
 * The listener attaches on `document` in the **bubble** phase (not capture) so a
 * focused input / typeahead's own Escape handler runs FIRST and can opt out:
 * - `e.defaultPrevented` → the stack skips dismissal (Escape-to-clear on a
 *   focused field does not also dismiss the surrounding layer).
 * On consume the handler calls `preventDefault()` + `stopImmediatePropagation()`.
 * This reliably suppresses `window`-level listeners (bubble reaches `window`
 * after `document`) and any `document`-bubble listener registered *after* this
 * one. It does NOT suppress a `document` listener registered *before* it (the DOM
 * fires same-target listeners in registration order) — a best-effort bound on
 * interference with unmigrated peers, not a correctness dependency.
 *
 * ## Attach-once / never-detach
 *
 * The listener is attached lazily on the first registration and then **stays
 * attached** (it early-returns when the stack is empty). Detaching on empty would
 * let another `document` listener slip ahead in registration order during an idle
 * window and permanently sit in front of the stack.
 *
 * ## React-synthetic interaction (documented constraint)
 *
 * A child that calls React's synthetic `e.stopPropagation()` on Escape halts the
 * native event at the React root before it reaches `document`, so this shared
 * listener never runs and the layer will not dismiss on that keypress. This is
 * the CORRECT behavior for an **open** combobox/typeahead (Escape closes the
 * child, not the layer — it opts out by design). Migration rule: a stack-eligible
 * surface MUST NOT contain a child that *unconditionally* `stopPropagation`s
 * Escape.
 */

interface EscapeEntry {
  id: string;
  onEscape: () => void;
}

const stack: EscapeEntry[] = [];
let attached = false;

function handleKeydown(e: KeyboardEvent): void {
  if (e.key !== "Escape") return;
  // Held Escape must peel one layer per press, not auto-repeat through the stack.
  if (e.repeat) return;
  // A focused input already handled it (Escape-to-clear) → do not also dismiss.
  if (e.defaultPrevented) return;
  if (stack.length === 0) return;
  const top = stack[stack.length - 1];
  e.preventDefault();
  e.stopImmediatePropagation();
  top.onEscape();
}

function ensureAttached(): void {
  if (attached) return;
  if (typeof document === "undefined") return;
  document.addEventListener("keydown", handleKeydown);
  attached = true;
}

/** Register (or refresh) a dismissible layer by stable id. Idempotent per id. */
export function registerEscapeLayer(id: string, onEscape: () => void): void {
  ensureAttached();
  const existing = stack.findIndex((entry) => entry.id === id);
  if (existing !== -1) {
    stack[existing].onEscape = onEscape;
    return;
  }
  stack.push({ id, onEscape });
}

/** Unregister a layer by its own identity (order-independent — never `pop()`). */
export function unregisterEscapeLayer(id: string): void {
  const idx = stack.findIndex((entry) => entry.id === id);
  if (idx !== -1) stack.splice(idx, 1);
}

/**
 * Register `onEscape` with the shared stack while `active` is true.
 *
 * - Stable `useId` id survives a StrictMode mount→unmount→mount, so the remount's
 *   cleanup removes the right entry and the duplicate-guard keeps a single live
 *   entry.
 * - `onEscape` is ref-backed: the latest callback is used on Escape without
 *   re-registering (no stack churn when the callback identity changes).
 * - Removal is by id (order-independent), so interleaved non-LIFO lifecycles are
 *   safe.
 */
export function useEscapeDismiss(active: boolean, onEscape: () => void): void {
  const id = useId();
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    registerEscapeLayer(id, () => onEscapeRef.current());
    return () => unregisterEscapeLayer(id);
  }, [active, id]);
}

/**
 * Test-only reset: empties the stack and detaches the listener so each test
 * starts from a clean module state. Dev/test-gated — a no-op under
 * `NODE_ENV=production` so production code cannot wipe global dismissal.
 */
export function __resetEscapeStack(): void {
  if (typeof process !== "undefined" && process.env?.NODE_ENV === "production") {
    return;
  }
  stack.length = 0;
  if (attached && typeof document !== "undefined") {
    document.removeEventListener("keydown", handleKeydown);
  }
  attached = false;
}
