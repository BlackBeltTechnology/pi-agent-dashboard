# embedded-app-shell.tsx — index

Root-exported, app-kit-free. `EmbeddedAppShell` `{fetch, wsUrl, encodeFolder, decodeFolder, returnTarget}` + `EmbeddedAppShellProvider`/`useEmbeddedAppShell` (client injects). `isSafeDashboardPath(path,{allowApps})` — one leading `/`, no `\`/whitespace/control (raw+decoded), no `.`/`..` segment, not `/apps/*` unless allowed. `createReturnTargetStore`, `returnPillLabel`, `EmbeddedAppReturnPill` (shown while location = dest; click pushes recorded href, clears; leaving dest clears). See change: add-plugin-app-host.
