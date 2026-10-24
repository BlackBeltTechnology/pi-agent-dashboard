/**
 * Per-app switches (`plugins['craft-web'].apps.<app>.*`), read live so status, prepare and the validator
 * `enabled()` switch react without a restart.
 * See change: edit-office-in-pane-with-craft-web (D1), track-latest-craft-web-version (D1).
 */
import type { WebChannel } from "@blackbelt-technology/pi-dashboard-craft-apps/provision.js";

export interface CraftWebConfig {
  apps?: Record<string, { enabled?: boolean; version?: WebChannel } | undefined>;
  /** Kill switch of live agent control (add-craft-live-control); `false` = every request answers `disabled`. */
  liveControl?: boolean;
}

/** Live control is on unless the config explicitly sets `liveControl` to `false`. Read live. */
export const liveControlEnabled = (config: CraftWebConfig | undefined): boolean => config?.liveControl !== false;

/** Enabled unless the config explicitly sets `apps.<app>.enabled` to `false`. */
export function appEnabled(config: CraftWebConfig | undefined, app: string): boolean {
  return config?.apps?.[app]?.enabled !== false;
}

/** Version channel from config: `latest` only when `apps.<app>.version === "latest"`, else `pinned`. */
export function appChannel(config: CraftWebConfig | undefined, app: string): WebChannel {
  return config?.apps?.[app]?.version === "latest" ? "latest" : "pinned";
}
