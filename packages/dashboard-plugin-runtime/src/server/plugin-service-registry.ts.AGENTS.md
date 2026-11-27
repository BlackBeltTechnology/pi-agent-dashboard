# plugin-service-registry.ts — index

Host-owned cross-plugin service registry. `createPluginServiceRegistry({warn?})` → `provide(provider,name,value)` / `set(name,value)` (provider `host`) / `get` / `entries(prefix)` (fresh `{key,value,provider}` copies). `automation.action.<source>` key: provider id MUST equal `<source>` (first segment); mismatch or empty source refused + logged, never throws. Exports `automationActionSource`, `AUTOMATION_ACTION_KEY_PREFIX`, `HOST_PROVIDER`. See change: harden-git-terminal-plugin-boundaries (D16).
