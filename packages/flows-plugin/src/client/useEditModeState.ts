/**
 * Effective flows edit mode for one session (project `.pi/settings.json`
 * overriding the global `~/.pi/agent/settings.json`), resolved read-only by
 * the plugin server.
 *
 *   - GET `/api/plugins/flows/edit-mode-state?sessionId` while `active`
 *     becomes true and again each time the session actions menu opens (picks
 *     up out-of-band changes: `/flows:edit-mode`, hand edits).
 *   - Live `flows_edit_mode_state` frames for THIS session update the value;
 *     a frame carrying `error` surfaces it once.
 *   - `enabled === undefined` = unknown (not fetched yet, or the request
 *     failed); callers hide edit-mode UI then.
 *
 * Never sends anything. See change: stop-flows-edit-mode-project-writes (D4).
 */
import { usePluginMessage } from "@blackbelt-technology/dashboard-plugin-runtime";
import { useCallback, useEffect, useRef, useState } from "react";

type EditModeError = "not-delivered" | "timeout";

interface EditModeFrame {
  sessionId?: unknown;
  enabled?: unknown;
  error?: unknown;
}

export interface EditModeState {
  enabled: boolean | undefined;
  error: EditModeError | null;
  clearError: () => void;
}

export function useEditModeState(sessionId: string, opts: { active: boolean; menuOpen?: boolean }): EditModeState {
  const { active, menuOpen } = opts;
  const [enabled, setEnabled] = useState<boolean | undefined>(undefined);
  const [error, setError] = useState<EditModeError | null>(null);
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    let next: boolean | undefined;
    try {
      const r = await fetch(`/api/plugins/flows/edit-mode-state?sessionId=${encodeURIComponent(sessionId)}`);
      const body = r.ok ? ((await r.json()) as { enabled?: unknown }) : null;
      next = typeof body?.enabled === "boolean" ? body.enabled : undefined;
    } catch {
      next = undefined;
    }
    if (mine === seq.current) setEnabled(next);
  }, [sessionId]);

  // Fetch when the gate opens (and on session change).
  useEffect(() => {
    if (!active) return;
    void refresh();
    return () => {
      seq.current++; // drop an in-flight response for a stale session / unmount
    };
  }, [active, refresh]);

  // Re-fetch on each menu open transition (closed → open).
  const wasOpen = useRef(menuOpen);
  useEffect(() => {
    if (active && menuOpen && !wasOpen.current) void refresh();
    wasOpen.current = menuOpen;
  }, [active, menuOpen, refresh]);

  usePluginMessage<EditModeFrame>("flows_edit_mode_state", (msg) => {
    if (msg.sessionId !== sessionId || typeof msg.enabled !== "boolean") return;
    seq.current++; // a pushed value supersedes any in-flight GET
    setEnabled(msg.enabled);
    if (msg.error === "not-delivered" || msg.error === "timeout") setError(msg.error);
  });

  const clearError = useCallback(() => setError(null), []);
  return { enabled, error, clearError };
}
