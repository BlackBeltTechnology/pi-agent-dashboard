# windows-nsis-install.ps1 — index

NSIS per-user default-path silent install (restore-windows-nsis-installer guard). Downloads URL or uses local `Setup.exe`, runs `/S /D=$LOCALAPPDATA\Programs\PI Dashboard`, polls for exe + Start Menu shortcut, asserts HKCU Add/Remove entry with `Publisher == "BlackBelt Technology"`. Param: `-Setup`.
