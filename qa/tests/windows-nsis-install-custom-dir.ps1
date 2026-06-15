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

# /D=<path> is the NSIS install-dir override (must be last, unquoted). Pass the
# raw command line via ProcessStartInfo so PowerShell does not re-quote a path
# with spaces (which breaks NSIS /D= parsing).
Write-Host "Running: $exe /S /D=$Dir"
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $exe
$psi.Arguments = "/S /D=$Dir"
$psi.UseShellExecute = $false
$p = [System.Diagnostics.Process]::Start($psi)
$p.WaitForExit()

$found = $false
for ($i = 0; $i -lt 150; $i++) {
    if (Test-Path (Join-Path $Dir "pi-dashboard.exe")) { $found = $true; break }
    Start-Sleep -Seconds 1
}
if (-not $found) {
    Write-Host "FAIL: pi-dashboard.exe not found under $Dir after 150s"
    exit 1
}
$uninst = Join-Path $Dir "Uninstall PI Dashboard.exe"
if (-not (Test-Path $uninst)) {
    Write-Host "FAIL: uninstaller not found at $uninst"
    exit 1
}

$entry = Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -eq "PI Dashboard" }
if (-not $entry) {
    Write-Host "FAIL: no HKCU Add/Remove entry named 'PI Dashboard'"
    exit 1
}
if ($entry.InstallLocation -and $entry.InstallLocation.TrimEnd('\') -ne $Dir.TrimEnd('\')) {
    Write-Host "FAIL: Add/Remove InstallLocation '$($entry.InstallLocation)' != '$Dir'"
    exit 1
}

Write-Host "PASS: NSIS custom-dir install verified ($Dir)"
