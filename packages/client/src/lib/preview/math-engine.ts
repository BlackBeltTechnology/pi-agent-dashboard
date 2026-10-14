/**
 * Lazy math engine: `katex` + `rehype-katex` + the KaTeX stylesheet, fetched on
 * demand the first time rendered content contains math. All three are imported
 * together so they land in the single `katex` manual chunk and the stylesheet
 * leaves the entry CSS. `remark-math` (6 KB) stays static in `MarkdownContent`
 * to detect math nodes, so parsing is identical before and after load.
 *
 * One memoized promise per page, shared by `MarkdownContent` and
 * `AsciiDocPreview`. A failed load is permanent for the page (logged once):
 * callers stay on literal source rather than retrying on every render.
 *
 * See change: shrink-client-entry-lazy-islands.
 */
import { useEffect, useSyncExternalStore } from "react";
import { reportError } from "../report-error.js";

export interface MathEngine {
  rehypeKatex: typeof import("rehype-katex").default;
  katex: typeof import("katex").default;
}

let promise: Promise<MathEngine> | null = null;
let loaded: MathEngine | null = null;
const listeners = new Set<() => void>();

/** Start (or join) the single shared load. Rejects if any part fails to load. */
export function loadMathEngine(): Promise<MathEngine> {
  if (promise !== null) return promise;
  promise = (async () => {
    const [katex, rehype] = await Promise.all([
      import("katex"),
      import("rehype-katex"),
      import("katex/dist/katex.min.css"),
    ]);
    loaded = { katex: katex.default, rehypeKatex: rehype.default };
    for (const notify of listeners) notify();
    return loaded;
  })();
  promise.catch((e) => reportError(e, "math-engine.load"));
  return promise;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = (): MathEngine | null => loaded;

/**
 * The loaded engine, or `null` until it has loaded (or forever after a failed
 * load). `needed` triggers the load; `false` never starts one.
 */
export function useMathEngine(needed: boolean): MathEngine | null {
  const engine = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    if (needed) loadMathEngine().catch(() => {}); // failure already reported once in loadMathEngine
  }, [needed]);
  return engine;
}
