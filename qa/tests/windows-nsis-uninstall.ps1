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

# Resolve the uninstaller path from the registry (UninstallString) rather than
# assuming a filename — electron-builder's uninstaller name can vary. Fall back
# to globbing the install dir for Uninstall*.exe.
$preEntry = Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -eq "PI Dashboard" }
$uninst = $null
foreach ($cand in @($preEntry.QuietUninstallString, $preEntry.UninstallString)) {
    if (-not $cand) { continue }
    if ($cand -match '"([^"]+\.exe)"' -or $cand -match '^\s*(\S+\.exe)') {
        $uninst = $Matches[1]; break
    }
}
if (-not $uninst -or -not (Test-Path $uninst)) {
    $uninst = (Get-ChildItem -Path $Dir -Filter "Uninstall*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
}
if (-not $uninst -or -not (Test-Path $uninst)) {
    Write-Host "FAIL: uninstaller not found (registry UninstallString + $Dir\Uninstall*.exe both empty)"
    Get-ChildItem -Path $Dir -ErrorAction SilentlyContinue | Format-Table Name
    exit 1
}

Write-Host "Running: $uninst /S"
Start-Process -FilePath $uninst -ArgumentList "/S" -Wait

# The uninstaller copies itself to a temp dir and relaunches, so the original
# process returns before removal completes. Poll for the dir to disappear.
$gone = $false
for ($i = 0; $i -lt 120; $i++) {
    if (-not (Test-Path (Join-Path $Dir "pi-dashboard.exe"))) { $gone = $true; break }
    Start-Sleep -Seconds 1
}
if (-not $gone) {
    Write-Host "FAIL: install dir still present at $Dir after 120s"
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
