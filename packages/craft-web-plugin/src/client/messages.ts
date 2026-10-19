/**
 * English source strings for the craft-web client, keyed by the UNPREFIXED catalog
 * leaf key. `src/i18n.ts` carries the zh-CN / hu translations (same key set, pinned
 * by `__tests__/i18n.test.ts`). `useCraftT()` resolves `plugin.craft-web.<key>` via the
 * shell translator and falls back to the English text here.
 * See change: edit-office-in-pane-with-craft-web.
 */
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";

export const EN = {
  checking: "Checking {app}…",
  statusUnreachable: "Could not reach the dashboard server to check {app}.",
  disabled: "{app} is disabled in plugin settings.",
  restartRequired: "A server restart is required before {app} can load.",
  notVerified: "{app} is not verified for this dashboard version.",
  notPrepared: "{app} must be downloaded first (about {size}).",
  notPreparedNoSize: "{app} must be downloaded first.",
  shimOutdated: "{app} needs an update before it can load (about {size}).",
  shimOutdatedNoSize: "{app} needs an update before it can load.",
  launcherSource: "{app} is not available from the launcher source.",
  unavailable: "{app} is unavailable.",
  prepareFailed: "{app} could not be prepared ({reason}).",
  reasonOffline: "offline",
  reasonChecksum: "checksum mismatch",
  reasonExtract: "extract failed",
  reasonUnknown: "unknown error",
  prepare: "Download {app}",
  preparing: "Preparing {app}…",
  retry: "Retry",
  readingFile: "Reading the file…",
  snapshotFailed: "Could not read the file: {message}",
  noRenderer: "This browser cannot run {app}.",
  starting: "Starting {app}…",
  opening: "Opening the document…",
  startFailed: "{app} could not start.",
  openFailed: "The document could not be opened.",
  reloadedLost: "The editor reloaded. Unsaved edits were lost.",
  reloaded: "Editor reloaded",
  resume: "Resume",
  blockedToast: "Open other files from the dashboard",
  navigateOffer: "{app} tried to open {url}. Open it in a new tab?",
  navigateUnsafe: "{app} tried to leave the page; the address was not opened.",
  openNewTab: "Open in new tab",
  dismiss: "Dismiss",
  saveAsTitle: "{app} wants to save as {name}",
  saveAsCopy: "Save as copy next to {file}",
  saveAsOverwrite: "Overwrite {file}",
  cancel: "Cancel",
  tooLarge: "The document is too large to save to the workspace (limit {limit}). Nothing was written.",
  downloadDoc: "Download to this device",
  saveBusy: "Another save is already in progress.",
  saveFailed: "Not saved: {message}",
  saveTarget: "Save target",
  targetOverwrite: "Overwrite",
  targetCopy: "Copy",
  frameTitle: "{app} editor",
  // Settings section. See change: track-latest-craft-web-version.
  settingsEnable: "Enable {app}",
  settingsEnableHint: "When off, the Edit in {app} mode is unavailable and saves through it are refused.",
  settingsVersion: "Version",
  settingsVersionHint: "Latest follows new releases (checked at most once a day). Latest builds are not verified with this dashboard. The {env} environment variable overrides this.",
  settingsPinned: "Verified (recommended)",
  settingsLatest: "Latest release",
  settingsInstalled: "Installed",
  settingsLatestKnown: "Latest release",
  settingsNotChecked: "Not checked yet",
  statusInstalled: "Installed",
  statusUpdate: "Update available",
  statusNotDownloaded: "Not downloaded",
  statusDisabled: "Disabled",
  statusRestart: "Restart required",
  statusUnavailable: "Unavailable",
  statusFailed: "Failed: {reason}",
  updateTo: "Update to {version}",
  saveFirst: "Save your changes first.",
  settingsStatusRestart: "Restart the server to load the plugin, then reload this page.",
  settingsStatusUnreachable: "Could not load the editor status.",
} as const;

export type MsgKey = keyof typeof EN;
export type Translate = (key: MsgKey, vars?: Record<string, string | number>) => string;

/** Scoped translator: `plugin.craft-web.<key>` via the shell, English fallback from {@link EN}. */
export function useCraftT(): Translate {
  const t = useT();
  return (key, vars) => t(key, vars, EN[key]);
}

/** Human size ("15.8 MB"); `undefined`/non-finite → `null` so callers pick the size-less message. */
export function formatSize(bytes: number | undefined): string | null {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return null;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
