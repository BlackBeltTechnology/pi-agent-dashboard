// Shared IntersectionObserver that pauses decorative / liveness animations
// while their element is outside (or far from) the viewport, by toggling the
// `fx-offscreen` class. The CSS rule for that class sets
// `animation-play-state: paused` on the element and its descendants — so a
// container carrying nested shimmer / spin / glow / neon animations pauses them
// all in one class toggle. One observer instance serves every FX element to
// keep bookkeeping cheap (the design's stated constraint).
//
// See change: reduce-chat-render-cpu-umbrella (Phase 1, task 2.5).

const OFFSCREEN_CLASS = "fx-offscreen";

let observer: IntersectionObserver | null = null;

function getObserver(): IntersectionObserver | null {
  // jsdom / SSR guard — no observer means animations simply always run.
  if (typeof IntersectionObserver === "undefined") return null;
  if (observer) return observer;
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        // Pause only when definitively off-screen; the generous rootMargin
        // keeps near-viewport elements running so nothing visibly stalls as it
        // scrolls into view.
        entry.target.classList.toggle(OFFSCREEN_CLASS, !entry.isIntersecting);
      }
    },
    { rootMargin: "200px 0px" },
  );
  return observer;
}

/**
 * Observe an element so its decorative/liveness animations pause while it is
 * off-screen. Returns a disposer that unobserves and clears the class.
 */
export function observeFx(el: Element): () => void {
  const obs = getObserver();
  if (!obs) return () => {};
  obs.observe(el);
  return () => {
    obs.unobserve(el);
    el.classList.remove(OFFSCREEN_CLASS);
  };
}
