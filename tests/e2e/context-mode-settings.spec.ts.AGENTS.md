# context-mode-settings.spec.ts — index

L3 spec (change: add-context-mode-settings-plugin). F1: set `search.windowMs` 30000 via the settings section, Save Bar save, reload → field 30000 without DEFAULT badge, GET `/api/plugins/context-mode-settings/config` returns it. F2: `0` into `search.blockAfter` → inline error, API keeps default. Real harness, no routing; `beforeEach` resets the file with an empty PUT.
