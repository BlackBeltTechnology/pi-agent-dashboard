import { useCallback, useState } from "react";

function read(key: string): boolean | null {
  try {
    const raw = localStorage.getItem(key);
    return raw === "true" ? true : raw === "false" ? false : null;
  } catch {
    return null;
  }
}

/**
 * Tri-state boolean persisted in localStorage: `null` = never chosen on this
 * browser, otherwise the last explicit choice. Storage failures degrade to an
 * in-memory value. See change: addons-hub-declutter (D7).
 */
export function usePersistedBoolean(key: string): [boolean | null, (value: boolean) => void] {
  const [value, setValue] = useState<boolean | null>(() => read(key));
  const set = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        localStorage.setItem(key, String(next));
      } catch {
        /* storage unavailable: keep the in-memory choice */
      }
    },
    [key],
  );
  return [value, set];
}
