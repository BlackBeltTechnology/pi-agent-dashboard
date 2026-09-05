# windows-nsis-launch.ps1 — index

Launches installed `pi-dashboard.exe`, polls `/api/health` for 200 within `TimeoutSec` (default 60). On failure dumps Electron stdout/stderr + `~/.pi/dashboard/server.log` tail. Params: `-Dir`, `-Port`, `-TimeoutSec`.
