# windows-nsis-install-custom-dir.ps1 — index

NSIS silent install to user-chosen dir (design D3 regression guard). Runs `Setup.exe /S /D=<Dir>` via ProcessStartInfo (raw arg, no re-quoting), polls for `pi-dashboard.exe`, asserts HKCU `InstallLocation` matches. Param: `-Setup`, `-Dir` (default `D:\TestApps\PI Dashboard`).
