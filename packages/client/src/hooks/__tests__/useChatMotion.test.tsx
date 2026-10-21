/**
 * useChatMotion — test-plan #E6. Effective motion is true only for
 * (pref on, reduced-motion off, document visible) and flips within the same
 * tick of the media-query / visibilitychange event.
 * See change: add-fluid-chat-motion.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatMotion } from "../useChatMotion.js";

type Listener = () => void;

function installMatchMedia(initialReduced: boolean) {
  let reduced = initialReduced;
  const listeners = new Set<Listener>();
  const mql = {
    get matches() {
      return reduced;
    },
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: (_: string, l: Listener) => listeners.add(l),
    removeEventListener: (_: string, l: Listener) => listeners.delete(l),
    addListener: (l: Listener) => listeners.add(l),
    removeListener: (l: Listener) => listeners.delete(l),
  };
  vi.stubGlobal("matchMedia", () => mql);
  window.matchMedia = (() => mql) as unknown as typeof window.matchMedia;
  return {
    set(next: boolean) {
      reduced = next;
      for (const l of [...listeners]) l();
    },
  };
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("useChatMotion", () => {
  beforeEach(() => setVisibility("visible"));
  afterEach(() => {
    vi.unstubAllGlobals();
    setVisibility("visible");
  });

  it("is true only for (pref on, reduced off, visible) across all 8 combos", () => {
    for (const pref of [true, false]) {
      for (const reduced of [true, false]) {
        for (const hidden of [true, false]) {
          installMatchMedia(reduced);
          setVisibility(hidden ? "hidden" : "visible");
          const { result, unmount } = renderHook(() => useChatMotion({ chatMotion: pref }));
          expect(result.current, `pref=${pref} reduced=${reduced} hidden=${hidden}`).toBe(
            pref && !reduced && !hidden,
          );
          unmount();
        }
      }
    }
  });

  it("flips synchronously on a media-query change and on visibilitychange", () => {
    const media = installMatchMedia(false);
    const { result } = renderHook(() => useChatMotion({ chatMotion: true }));
    expect(result.current).toBe(true);

    act(() => media.set(true));
    expect(result.current).toBe(false);
    act(() => media.set(false));
    expect(result.current).toBe(true);

    act(() => setVisibility("hidden"));
    expect(result.current).toBe(false);
    act(() => setVisibility("visible"));
    expect(result.current).toBe(true);
  });

  it("follows the preference prop", () => {
    installMatchMedia(false);
    const { result, rerender } = renderHook(({ on }) => useChatMotion({ chatMotion: on }), {
      initialProps: { on: true },
    });
    expect(result.current).toBe(true);
    rerender({ on: false });
    expect(result.current).toBe(false);
  });
});
