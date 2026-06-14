# Test: NSIS Setup.exe installs per-user to the default location.
# Regression guard for restore-windows-nsis-installer (default-path install).
#
# Usage: windows-nsis-install.ps1 -Setup <path-or-url-to-Setup.exe>
param(
    [Parameter(Mandatory = $true)][string]$Setup
)
$ErrorActionPreference = "Stop"

Write-Host "=== Test: NSIS Setup.exe per-user install (default path) ==="

# Resolve a local path (download if a URL was passed).
$exe = $Setup
if ($Setup -match '^https?://') {
    $exe = Join-Path $env:TEMP "PI-Dashboard-Setup.exe"
    Write-Host "Downloading $Setup ..."
    Invoke-WebRequest -Uri $Setup -OutFile $exe
}

$installDir = Join-Path $env:LOCALAPPDATA "Programs\PI Dashboard"

# Silent install accepting the default location (/S = NSIS silent).
Write-Host "Running silent install: $exe /S"
Start-Process -FilePath $exe -ArgumentList "/S" -Wait
Start-Sleep -Seconds 5

if (-not (Test-Path $installDir)) {
    Write-Host "FAIL: install dir not found at $installDir"
    exit 1
}
Write-Host "Install dir present: $installDir"

# Start Menu shortcut.
$shortcut = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\PI Dashboard.lnk"
if (-not (Test-Path $shortcut)) {
    Write-Host "FAIL: Start Menu shortcut not found at $shortcut"
    exit 1
}
Write-Host "Start Menu shortcut present"

# Add/Remove Programs entry under HKCU (per-user).
$entry = Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -eq "PI Dashboard" }
if (-not $entry) {
    Write-Host "FAIL: no HKCU Add/Remove Programs entry named 'PI Dashboard'"
    exit 1
}
if ($entry.InstallLocation.TrimEnd('\') -ne $installDir.TrimEnd('\')) {
    Write-Host "FAIL: InstallLocation '$($entry.InstallLocation)' != '$installDir'"
    exit 1
}
if ($entry.Publisher -ne "BlackBelt Technology") {
    Write-Host "FAIL: Publisher '$($entry.Publisher)' != 'BlackBelt Technology'"
    exit 1
}
Write-Host "Add/Remove entry OK (HKCU, InstallLocation + Publisher match)"

Write-Host "PASS: NSIS per-user install verified"
