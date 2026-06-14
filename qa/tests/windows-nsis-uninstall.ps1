# Test: uninstaller removes the app but PRESERVES user data (~/.pi, ~/.pi-dashboard).
# Regression guard for design D4 (selective uninstall).
#
# Usage: windows-nsis-uninstall.ps1 [-Dir <install dir>]
param(
    [string]$Dir = (Join-Path $env:LOCALAPPDATA "Programs\PI Dashboard")
)
$ErrorActionPreference = "Stop"

Write-Host "=== Test: NSIS uninstall preserves user data ==="

$piDir = Join-Path $env:USERPROFILE ".pi"
$pidashDir = Join-Path $env:USERPROFILE ".pi-dashboard"

# Seed marker files so we can prove preservation even on a fresh box.
New-Item -ItemType Directory -Force -Path $piDir, $pidashDir | Out-Null
$marker = Join-Path $piDir "qa-preserve-marker.txt"
"keep me" | Out-File -FilePath $marker

$uninst = Join-Path $Dir "Uninstall PI Dashboard.exe"
if (-not (Test-Path $uninst)) {
    Write-Host "FAIL: uninstaller not found at $uninst"
    exit 1
}

Write-Host "Running: $uninst /S"
Start-Process -FilePath $uninst -ArgumentList "/S" -Wait

# The uninstaller copies itself to a temp dir and relaunches, so the original
# process returns before removal completes. Poll for the dir to disappear.
$gone = $false
for ($i = 0; $i -lt 60; $i++) {
    if (-not (Test-Path (Join-Path $Dir "pi-dashboard.exe"))) { $gone = $true; break }
    Start-Sleep -Seconds 1
}
if (-not $gone) {
    Write-Host "FAIL: install dir still present at $Dir after 60s"
    exit 1
}
$entry = Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -eq "PI Dashboard" }
if ($entry) {
    Write-Host "FAIL: Add/Remove Programs entry still present"
    exit 1
}
if (-not (Test-Path $marker)) {
    Write-Host "FAIL: user data was deleted (~/.pi marker gone)"
    exit 1
}
if (-not (Test-Path $pidashDir)) {
    Write-Host "FAIL: ~/.pi-dashboard was deleted"
    exit 1
}

Write-Host "PASS: app removed; ~/.pi and ~/.pi-dashboard preserved"
