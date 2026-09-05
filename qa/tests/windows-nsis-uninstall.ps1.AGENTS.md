# windows-nsis-uninstall.ps1 — index

NSIS uninstall preserves user data (design D4). Seeds `~/.pi/qa-preserve-marker.txt`, runs uninstaller `/S` (resolved from registry `UninstallString` or `Uninstall*.exe` glob), polls install dir gone, HKCU entry gone, `~/.pi` + `~/.pi-dashboard` intact. Param: `-Dir`.
