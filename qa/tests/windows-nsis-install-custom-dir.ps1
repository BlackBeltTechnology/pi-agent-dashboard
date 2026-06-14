# Test: NSIS Setup.exe installs to a user-chosen (non-default) directory.
# Regression guard for the install-path-as-variable trade (design D3).
#
# Usage: windows-nsis-install-custom-dir.ps1 -Setup <path-or-url> [-Dir <path>]
param(
    [Parameter(Mandatory = $true)][string]$Setup,
    [string]$Dir = "D:\TestApps\PI Dashboard"
)
$ErrorActionPreference = "Stop"

Write-Host "=== Test: NSIS Setup.exe install to custom dir '$Dir' ==="

$exe = $Setup
if ($Setup -match '^https?://') {
    $exe = Join-Path $env:TEMP "PI-Dashboard-Setup.exe"
    Write-Host "Downloading $Setup ..."
    Invoke-WebRequest -Uri $Setup -OutFile $exe
}

# /D=<path> is the NSIS standard install-dir override (must be last, unquoted).
Write-Host "Running: $exe /S /D=$Dir"
Start-Process -FilePath $exe -ArgumentList "/S", "/D=$Dir" -Wait
Start-Sleep -Seconds 5

if (-not (Test-Path (Join-Path $Dir "pi-dashboard.exe"))) {
    Write-Host "FAIL: pi-dashboard.exe not found under $Dir"
    exit 1
}
$uninst = Join-Path $Dir "Uninstall PI Dashboard.exe"
if (-not (Test-Path $uninst)) {
    Write-Host "FAIL: uninstaller not found at $uninst"
    exit 1
}

$entry = Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -eq "PI Dashboard" }
if (-not $entry -or $entry.InstallLocation.TrimEnd('\') -ne $Dir.TrimEnd('\')) {
    Write-Host "FAIL: Add/Remove InstallLocation does not reflect '$Dir'"
    exit 1
}

Write-Host "PASS: NSIS custom-dir install verified ($Dir)"
