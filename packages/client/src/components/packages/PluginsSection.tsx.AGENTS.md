# PluginsSection.tsx — index

Settings ▸ Plugins activation list. Renders every plugin (enabled or not) with display name, description, enable/disable toggle, missing-requirement chips + inline Install buttons (delegates to package-queue for pi-extension requires). Compares `/api/health.startedAt` to surface restart-required banner when toggle pending. See change: add-plugin-activation-ui.
