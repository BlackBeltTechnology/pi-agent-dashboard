# quit-guard.ts — index

`installQuitGuard(app, {isQuitting, requestQuit})`: `before-quit` → full quit (stop server, tray, exit) for App menu Quit / Cmd+Q / Dock; previously role:quit was cancelled by the macOS close-to-tray handler. No loop once `isQuitting`; duplicate quits swallowed. main.ts sets `isQuitting` before `quitAndInstall`. See change: electron-runtime-overlay-updates.
