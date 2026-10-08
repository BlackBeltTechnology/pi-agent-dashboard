/**
 * Push-navigate that records into the in-app nav tracker, exactly like App's
 * own `navigate`. Without the record, the depth-aware back action has no
 * proven predecessor and falls back to the computed parent route instead of
 * returning to the launching view.
 * See change: resolve-archived-attached-proposal (D6).
 */
import { useCallback } from "react";
import { useLocation } from "wouter";
import { recordNavigation } from "./nav-tracker.js";

export function useTrackedNavigate(): (to: string) => void {
  const [, rawNavigate] = useLocation();
  return useCallback(
    (to: string) => {
      recordNavigation(to);
      rawNavigate(to);
    },
    [rawNavigate],
  );
}
