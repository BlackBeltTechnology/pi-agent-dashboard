# settings-kit-guard.mjs — index

Settings-kit ratchet (design D7): scans every `.tsx` under each `settings-section` claim dir (`settingsClaims`/`settingsRoots`), counts checkbox/select/hex/rgb/palette/small-text/muted-text/identity; `settingsClosure` = settings render tree (must stay zero); `EXEMPT_FILES` = `mcp-client-plugin/src/client/ServerEditor.tsx`; `--write` shrink-only. `npm run settings-kit:guard`. See change: retro-ux-plugin-settings-wave-2.
