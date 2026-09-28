/**
 * Shared 1 s clock hook. Moved from `lib/access-grants/yolo-status.ts`
 * (re-exported there). See change: show-session-history-load-state (design D6).
 */
import { useEffect, useState } from "react";

/** Epoch ms, re-rendered every second while `active`. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}
