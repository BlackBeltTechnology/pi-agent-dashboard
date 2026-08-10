/**
 * Shared per-session diff context (change: add-change-summary-table).
 *
 * Hoists ONE `useSessionDiff(sessionId)` per session so the `DiffViewer` tab,
 * the `ChangesRailSection`, and the fallback `FileDiffView` all read the same
 * cached `files[].gitDiff` + numstat counts — no per-tab / per-file fetch
 * (design D5). Refreshes on a caller-supplied change signal (new Edit/Write
 * count) and via the manual `refresh()`.
 */

import type { SessionDiffResponse } from "@blackbelt-technology/pi-dashboard-shared/diff-types.js";
import type React from "react";
import { createContext, useContext, useEffect, useRef } from "react";
import { useSessionDiff } from "../../hooks/useSessionDiff.js";

export interface SessionDiffContextValue {
  sessionId: string;
  data: SessionDiffResponse | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

/** Exported for test injection of a controlled diff `data` value. */
export const SessionDiffContext = createContext<SessionDiffContextValue | null>(null);

export function SessionDiffProvider({
  sessionId,
  changeSignal = 0,
  children,
}: {
  sessionId: string;
  /**
   * Monotonic count of Edit/Write events for this session. When it grows, the
   * shared diff refetches so the rail / diff tabs reflect the newest edits.
   */
  changeSignal?: number;
  children: React.ReactNode;
}) {
  const { data, isLoading, error, refresh } = useSessionDiff(sessionId);

  // Refetch when new edits land (skip the mount value; useSessionDiff already
  // fetches on mount / sessionId change).
  const prevSignal = useRef(changeSignal);
  useEffect(() => {
    if (changeSignal !== prevSignal.current) {
      prevSignal.current = changeSignal;
      refresh();
    }
  }, [changeSignal, refresh]);

  return (
    <SessionDiffContext.Provider value={{ sessionId, data, isLoading, error, refresh }}>
      {children}
    </SessionDiffContext.Provider>
  );
}

/** Access the shared session diff, or `null` outside the provider. */
export function useOptionalSessionDiff(): SessionDiffContextValue | null {
  return useContext(SessionDiffContext);
}

/** Access the shared session diff. Throws outside the provider. */
export function useSessionDiffContext(): SessionDiffContextValue {
  const ctx = useContext(SessionDiffContext);
  if (!ctx) throw new Error("useSessionDiffContext must be used within a SessionDiffProvider");
  return ctx;
}
