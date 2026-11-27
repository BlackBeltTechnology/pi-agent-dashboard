# preferences-relay.ts — index

`buildPreferencesUpdate(store)` → full `preferences_update` snapshot (`autoNameSessions` + `claudeSubscriptionCompat`). Every sender (register push, initial-prompt arm, PATCH broadcasts) uses it so no message resets the other value. See change: retire-anthropic-messages-bridge.
