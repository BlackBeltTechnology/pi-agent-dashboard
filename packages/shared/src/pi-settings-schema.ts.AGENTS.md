# pi-settings-schema.ts — index

Typed key schema of pi's global `settings.json` (50 keys: bool/enum/mixed/int/string/`enabledModels`): `PI_SETTINGS_SCHEMA` (`key`,`kind`,`options`,`min`,`max`,`def`,`category`,`label`,`hint`), `PI_SETTING_CATEGORIES`, `PI_SETTINGS_BLOCKS`, `checkPiSettingValue`, `getPiSettingDef`. Drives server patch validation AND client rows. Excludes `PI_MANAGED_SETTINGS_KEYS`. Parity test reads upstream pi docs/settings.md. See change: pi-settings-full-coverage.
