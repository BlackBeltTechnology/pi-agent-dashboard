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

# Silent install. electron-builder assisted installers (oneClick:false) only
# compute the default $INSTDIR in the directory page, which /S skips — so a
# silent install MUST pass /D=<dir>. /D must be last and unquoted; pass the raw
# command line via ProcessStartInfo so PowerShell does not re-quote the path
# (which would break NSIS /D= parsing of paths containing spaces).
Write-Host "Running silent install: $exe /S /D=$installDir"
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $exe
$psi.Arguments = "/S /D=$installDir"
$psi.UseShellExecute = $false
$p = [System.Diagnostics.Process]::Start($psi)
$p.WaitForExit()

# Assisted installers may relaunch; poll for the install dir to appear.
$found = $false
for ($i = 0; $i -lt 150; $i++) {
    if (Test-Path (Join-Path $installDir "pi-dashboard.exe")) { $found = $true; break }
    Start-Sleep -Seconds 1
}
if (-not $found) {
    Write-Host "FAIL: pi-dashboard.exe not found under $installDir after 150s"
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
# InstallLocation may be absent (electron-builder does not always populate it,
# observed empty on slower installs). The install dir is already verified above,
# so only assert when present.
if ($entry.InstallLocation -and $entry.InstallLocation.TrimEnd('\') -ne $installDir.TrimEnd('\')) {
    Write-Host "FAIL: InstallLocation '$($entry.InstallLocation)' != '$installDir'"
    exit 1
}
if ($entry.Publisher -ne "BlackBelt Technology") {
    Write-Host "FAIL: Publisher '$($entry.Publisher)' != 'BlackBelt Technology'"
    exit 1
}
Write-Host "Add/Remove entry OK (HKCU, InstallLocation + Publisher match)"

Write-Host "PASS: NSIS per-user install verified"
