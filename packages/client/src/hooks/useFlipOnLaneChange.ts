/**
 * Tiny hand-rolled FLIP for session cards changing lane (design D5) — no
 * animation dependency. When `fingerprint` changes, the card rects are read
 * during render (the DOM still shows the OLD layout), then after commit each
 * moved card gets an inverted transform that transitions back to zero.
 * Skipped under `prefers-reduced-motion: reduce` and while a drag is active.
 * Targets `[data-session-id]` nodes inside `containerRef`.
 * See change: session-list-group-by.
 */
import { type RefObject, useLayoutEffect, useMemo } from "react";

const FLIP_DURATION_MS = 220;
const FLIP_EASING = "cubic-bezier(.2,.8,.2,1)";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

/** FLIP "Invert + Play" for one card that moved from rect `a` to rect `b`. */
function playFlip(el: HTMLElement, a: DOMRect, b: DOMRect): void {
  const dx = a.left - b.left;
  const dy = a.top - b.top;
  if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
  el.style.transition = "none";
  el.style.transform = `translate(${dx}px, ${dy}px)`;
  requestAnimationFrame(() => {
    el.style.transition = `transform ${FLIP_DURATION_MS}ms ${FLIP_EASING}`;
    el.style.transform = "";
  });
}

function measure(root: HTMLElement | null): Map<string, DOMRect> {
  const out = new Map<string, DOMRect>();
  if (!root) return out;
  for (const el of root.querySelectorAll<HTMLElement>("[data-session-id]")) {
    const id = el.dataset.sessionId;
    if (id) out.set(id, el.getBoundingClientRect());
  }
  return out;
}

export function useFlipOnLaneChange(
  containerRef: RefObject<HTMLElement | null>,
  fingerprint: string,
  disabled: boolean,
): void {
  // Render-phase read on fingerprint change: the committed DOM is still the
  // previous layout here, which is exactly the FLIP "First" snapshot.
  // biome-ignore lint/correctness/useExhaustiveDependencies: snapshot keyed on fingerprint only.
  const before = useMemo(
    () => (disabled || prefersReducedMotion() ? null : measure(containerRef.current)),
    [fingerprint],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per fingerprint commit.
  useLayoutEffect(() => {
    if (!before || before.size === 0 || disabled || prefersReducedMotion()) return;
    const root = containerRef.current;
    if (!root) return;
    for (const el of root.querySelectorAll<HTMLElement>("[data-session-id]")) {
      const id = el.dataset.sessionId;
      const a = id ? before.get(id) : undefined;
      if (a) playFlip(el, a, el.getBoundingClientRect());
    }
  }, [before]);
}
