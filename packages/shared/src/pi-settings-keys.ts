/**
 * Keys of pi's global `settings.json` owned by the dashboard Default model
 * control. Read-only in the pi settings editor, excluded from its concurrency
 * token, and substituted from disk on raw writes.
 * See change: edit-pi-agent-settings (design D2/D4).
 */
export const PI_MANAGED_SETTINGS_KEYS = ["defaultProvider", "defaultModel", "defaultThinkingLevel"] as const;

export type PiManagedSettingsKey = (typeof PI_MANAGED_SETTINGS_KEYS)[number];
