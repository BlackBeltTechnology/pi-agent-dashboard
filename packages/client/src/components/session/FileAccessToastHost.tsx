/**
 * Mounts the non-modal "waiting for file access" toast for the whole app (both
 * layouts). Owns its OWN toast tray: the App-level `useToast` tray is rendered
 * only in the mobile branch, so a desktop toast routed through it would never
 * show. See change: ask-agent-file-access-in-chat (session-attention-routing).
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { useFileAccessToasts } from "../../hooks/useFileAccessToasts.js";
import { Toast, useToast } from "../primitives/Toast.js";

export function FileAccessToastHost({
  sessions,
  selectedId,
  onOpen,
}: {
  sessions: ReadonlyMap<string, DashboardSession>;
  selectedId: string | undefined;
  onOpen: (sessionId: string) => void;
}) {
  const { messages, showToast, dismissToast, dismissToastByKey } = useToast();
  useFileAccessToasts(sessions, selectedId, { showToast, dismissToastByKey }, onOpen);
  return <Toast messages={messages} onDismiss={dismissToast} />;
}
