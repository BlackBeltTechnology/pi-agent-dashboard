# DOX — packages/kb-plugin

Files in this directory. One row per source file. See change: add-kb-folder-slot.

| File | Purpose |
|------|---------|
| `package.json` | pi-dashboard-plugin manifest. id `kb`, priority 100. Claims `sidebar-folder-section`→`FolderKbSection`, `shell-overlay-route` `/folder/:encodedCwd/kb`→`KbSettingsClaim`. server `./src/server/index.ts`. Layer-3 dashboard plugin. Imports Layer-1 `@blackbelt-technology/pi-dashboard-kb`. Independent of Layer-2 kb-extension. See change: add-kb-folder-slot. |
