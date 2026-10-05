import { useEffect, useRef } from "react";

/**
 * Run `fn` now, whenever its identity changes (e.g. the target switched), and every `ms`
 * while the document is visible; the interval stops while hidden.
 */
export function usePoll(fn: () => void | Promise<void>, ms: number, enabled = true): void {
  const ref = useRef(fn);
  ref.current = fn;

  useEffect(() => {
    if (enabled) void fn();
  }, [fn, enabled]);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => void ref.current(), ms);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") stop();
      else {
        void ref.current();
        start();
      }
    };
    if (document.visibilityState !== "hidden") start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [ms, enabled]);
}
