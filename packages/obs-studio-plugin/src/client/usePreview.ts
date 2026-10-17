/**
 * Program-scene preview polling (design D6, spike F5): ≤ 1 fps, ONLY while
 * `document.visibilityState === "visible"`; after 3 consecutive errors it backs
 * off to 0.2 fps and returns to 1 fps on the first success. Pure scheduling in
 * `createPreviewPoller` (fake-timer testable); `usePreview` binds it to React.
 * See change: add-obs-studio-plugin (test-plan P1).
 */
import { useEffect, useState } from "react";

const PREVIEW_INTERVAL_MS = 1000;
const PREVIEW_BACKOFF_MS = 5000;
const PREVIEW_ERRORS_BEFORE_BACKOFF = 3;

export interface PreviewPoller {
  stop(): void;
}

export function createPreviewPoller(
  fetchFrame: () => Promise<string>,
  onFrame: (src: string | null, error?: unknown) => void,
  doc: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener"> = document,
): PreviewPoller {
  let errors = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inflight = false;
  let stopped = false;

  const delay = () => (errors >= PREVIEW_ERRORS_BEFORE_BACKOFF ? PREVIEW_BACKOFF_MS : PREVIEW_INTERVAL_MS);
  const schedule = (ms: number) => {
    clearTimeout(timer);
    if (!stopped && doc.visibilityState === "visible") timer = setTimeout(tick, ms);
  };
  async function tick() {
    if (stopped || inflight || doc.visibilityState !== "visible") return;
    inflight = true;
    try {
      const src = await fetchFrame();
      errors = 0;
      onFrame(src);
    } catch (e) {
      errors++;
      onFrame(null, e);
    } finally {
      inflight = false;
      schedule(delay());
    }
  }
  const onVisibility = () => {
    if (doc.visibilityState === "visible") schedule(0);
    else clearTimeout(timer);
  };
  doc.addEventListener("visibilitychange", onVisibility);
  schedule(0);
  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
      doc.removeEventListener("visibilitychange", onVisibility);
    },
  };
}

export function usePreview(fetchFrame: (() => Promise<string>) | null): { src: string | null; error: unknown } {
  const [state, setState] = useState<{ src: string | null; error: unknown }>({ src: null, error: null });
  useEffect(() => {
    if (!fetchFrame) return;
    const p = createPreviewPoller(fetchFrame, (src, error) => setState((prev) => ({ src: src ?? prev.src, error: error ?? null })));
    return () => p.stop();
  }, [fetchFrame]);
  return state;
}
