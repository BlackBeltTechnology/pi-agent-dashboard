/**
 * `useIsNarrow` — a reactive `matchMedia` viewport check.
 *
 * The folder page needs one boolean to switch its presentation below the
 * 640px floor (editor bottom sheet is CSS; the chip's inline remove control is
 * not). jsdom has no `matchMedia`, so the hook degrades to `false` (desktop)
 * and tests stub it when they need the narrow branch. See change:
 * extract-mcp-client-plugin (task 8.4).
 */
import { useEffect, useState } from "react";

export function useIsNarrow(query = "(max-width: 639px)"): boolean {
  const read = (): boolean =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : false;
  const [narrow, setNarrow] = useState(read);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const onChange = (): void => setNarrow(mql.matches);
    onChange();
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  }, [query]);

  return narrow;
}
