/**
 * OBS Studio plugin English messages (the `useT()` fallback map) + `tr`. Lazy-only
 * code imports this (NOT the eager catalog module), so the English strings stay out
 * of the dashboard's cold entry chunk. Keys are unprefixed; zh-CN / hu live in
 * `i18n.ts` and MUST keep the same key set. See change: add-obs-studio-plugin (design D6).
 */
export const en = {
  title: "OBS Studio",
  intro: "Scenes, virtual camera and recording of the OBS instances provisioned on this dashboard.",
  none: "No OBS is provisioned yet.",
  provisionHint: "Ask the agent to set up OBS (it runs `pi-obs provision`), or run `pi-obs provision` in a terminal on the OBS computer.",
  openPanel: "Open OBS panel",
  state: "State",
  version: "Version",
  auth: "Authentication",
  authOk: "Password accepted",
  authFailed: "OBS rejected the stored password. Re-provision with `pi-obs provision --update`.",
  authUnknown: "Not checked yet",
  exposureWarning: "obs-websocket listens on all network interfaces. Block its port for other hosts in the firewall.",
  recoverySuspended: "Automatic crash recovery is suspended. Answer OBS's prompt on the host, then run `pi-obs launch --reset-recovery`.",
  instance: "OBS instance",
  scenes: "Scenes",
  programScene: "Program scene: {scene}",
  switchTo: "Switch to {scene}",
  virtualCam: "Virtual camera",
  recording: "Recording",
  on: "On",
  off: "Off",
  preview: "Program preview",
  previewUnavailable: "Preview unavailable",
  blocked: "OBS is waiting for input on the host (for example its safe-mode prompt). Answer it on that computer.",
  start: "Start",
  retry: "Retry",
  notHealthy: "OBS is {state}.",
  reason: "Reason: {reason}",
  loading: "Loading…",
  error: "Request failed: {error}",
  operateRequired: "The preview and the controls need operate access (an operate-tier device or a signed-in operator).",
  liveUnavailable: "Live OBS data appears once the panel is opened by an operator.",
  vcamRestart: "After the virtual camera starts for the first time, fully restart apps such as Meet or Zoom so they list it.",
} as const;

export type MessageKey = keyof typeof en;

type T = (key: string, vars?: Record<string, string | number>, fallback?: string) => string;

/** `useT()` lookup with the English fallback from `en`. */
export function tr(t: T, key: MessageKey, vars?: Record<string, string | number>): string {
  return t(key, vars, en[key]);
}
