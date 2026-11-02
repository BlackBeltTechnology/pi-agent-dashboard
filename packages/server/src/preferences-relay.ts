/**
 * Builds the server → bridge `preferences_update` snapshot.
 *
 * Every sender (register push, initial-prompt arm, PATCH broadcasts) sends the
 * FULL snapshot of bridge-relevant preferences, so a message never resets a
 * value it did not mean to change. See change: retire-anthropic-messages-bridge
 * (design D3).
 */
import type { PreferencesUpdateExtensionMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import type { PreferencesStore } from "./persistence/preferences-store.js";

export function buildPreferencesUpdate(
  store: Pick<PreferencesStore, "getAutoNameSessions" | "getClaudeSubscriptionCompat">,
): PreferencesUpdateExtensionMessage {
  return {
    type: "preferences_update",
    autoNameSessions: store.getAutoNameSessions(),
    claudeSubscriptionCompat: store.getClaudeSubscriptionCompat(),
  };
}
