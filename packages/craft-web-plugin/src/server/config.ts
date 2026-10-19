/**
 * Per-app enable switch (`plugins['craft-web'].apps.<app>.enabled`, default true), read live so
 * status, prepare and the validator `enabled()` switch react without a restart.
 * See change: edit-office-in-pane-with-craft-web (D1).
 */

export interface CraftWebConfig {
  apps?: Record<string, { enabled?: boolean } | undefined>;
}

/** Enabled unless the config explicitly sets `apps.<app>.enabled` to `false`. */
export function appEnabled(config: CraftWebConfig | undefined, app: string): boolean {
  return config?.apps?.[app]?.enabled !== false;
}
