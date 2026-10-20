/**
 * Non-modal "waiting for operator approval" toast (change: ask-agent-file-access-in-chat,
 * session-attention-routing; supervised kind added by add-supervised-tool-approval, D16).
 * Fires when a session transitions to `awaitingOperatorApproval` (file access OR a
 * supervised tool approval; one toast per session) while the operator is NOT viewing it; withdrawn when the
 * flag clears (answered / cancelled / timed out) or the operator opens it. Never
 * blocks interaction (no modal, no auto-focus).
 */

import { awaitingOperatorApproval } from "@blackbelt-technology/pi-dashboard-shared/awaiting-operator-approval.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { useEffect, useRef } from "react";
import { t as i18nT } from "../lib/i18n/i18n.js";

export const fileAccessToastKey = (sessionId: string): string => `file-access:${sessionId}`;

export interface FileAccessToastApi {
  showToast: (
    text: string,
    variant?: "warning",
    opts?: { action?: { label: string; onClick: () => void }; noAutoDismiss?: boolean; key?: string },
  ) => void;
  dismissToastByKey: (key: string) => void;
}

/** Tool approval wins the wording only when it is the sole pending kind. */
function toastText(s: DashboardSession, name: string): string {
  return s.awaitingToolApproval === true && s.awaitingFileAccess !== true
    ? i18nT("supervised.waiting", { name }, "Session {name} is waiting for tool approval")
    : i18nT("agentPathGate.waiting", { name }, "Session {name} is waiting for file access");
}

export function useFileAccessToasts(
  sessions: ReadonlyMap<string, DashboardSession>,
  selectedId: string | undefined,
  api: FileAccessToastApi,
  onOpen: (sessionId: string) => void,
): void {
  const shown = useRef(new Set<string>());
  const apiRef = useRef(api);
  apiRef.current = api;
  const openRef = useRef(onOpen);
  openRef.current = onOpen;

  useEffect(() => {
    const live = new Set<string>();
    for (const [id, s] of sessions) {
      const awaiting = awaitingOperatorApproval(s) && s.status !== "ended";
      if (!awaiting) continue;
      live.add(id);
      const viewing = id === selectedId;
      if (viewing) {
        if (shown.current.delete(id)) apiRef.current.dismissToastByKey(fileAccessToastKey(id));
        continue;
      }
      if (shown.current.has(id)) continue;
      shown.current.add(id);
      const name = (s as { name?: string }).name || id.slice(0, 8);
      apiRef.current.showToast(
        toastText(s, name),
        "warning",
        {
          key: fileAccessToastKey(id),
          noAutoDismiss: true,
          action: { label: i18nT("agentPathGate.open", undefined, "Open"), onClick: () => openRef.current(id) },
        },
      );
    }
    for (const id of [...shown.current]) {
      if (!live.has(id)) {
        shown.current.delete(id);
        apiRef.current.dismissToastByKey(fileAccessToastKey(id));
      }
    }
  }, [sessions, selectedId]);
}
