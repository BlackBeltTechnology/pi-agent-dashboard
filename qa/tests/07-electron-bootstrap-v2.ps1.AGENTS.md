# 07-electron-bootstrap-v2.ps1 — index

Electron V2 LaunchSource bootstrap e2e on Windows ZIP. Extract `C:\qa-artifacts\PI-Dashboard-win32-x64.zip` → launch `pi-dashboard.exe` → wait `/api/health` (180s, ports 8000 + 8112). Asserts `starter==Electron`, `managedDir/.version`, `pi-coding-agent` + cliPath installed under `~/.pi-dashboard`, `~/.pi/dashboard/server.log` non-empty (catches spawnDetached stdio regression). Skips when ZIP absent.
