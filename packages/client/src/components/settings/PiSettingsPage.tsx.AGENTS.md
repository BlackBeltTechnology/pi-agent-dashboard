# PiSettingsPage.tsx — index

Settings → pi → pi settings page (`activeTab:"pi-settings"`): schema-driven Form (every typed pi key, categories, filter/changed-only/jump chips, link + Edit-in-JSON rows) / JSON modes, ONE draft at a time via `useSettingsDraftSource` (`id`/`page:"pi-settings"`, no private Save). `commit()`: validate → precompute patch → legacy cleanup → patch with the cleanup token (rebase, never `adopt`). 409 banner + reload, 400 field errors, drift action (`deriveMirror`). Injectable: `load`/`save`/`migrate`/`loadCatalogue`/`syncDefaults`/`onNavigate`/`JsonEditor`. See change: edit-pi-agent-settings; pi-settings-full-coverage.

`dashboardDefaults` = RESOLVED role default from SettingsPanel (`resolvedMirrorDefaults`); unresolved role → no drift. See change: default-model-follows-role.
