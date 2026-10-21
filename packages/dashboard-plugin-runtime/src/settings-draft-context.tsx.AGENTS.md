# settings-draft-context.tsx — index

Settings draft registry. `SettingsDraftProvider` + `useSettingsDraftSource({id,page,isDirty,commit,reset})`. Settings sections (built-in + plugin) buffer edits; host SettingsPanel commits dirty sources on unified Save. No-op without provider. See change: unify-settings-save-contract.
