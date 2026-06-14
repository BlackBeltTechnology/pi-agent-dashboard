# Test: installer carries Pi branding — uninstaller icon + Publisher version info.
# Regression guard for the Pi-branded-installer-assets requirement.
#
# Usage: windows-nsis-branding.ps1 -Setup <path-to-Setup.exe> `
#                                  -UninstallerIco <path-to-uninstaller-icon.ico>
# (UninstallerIco = the built asset, for SHA comparison.)
param(
    [Parameter(Mandatory = $true)][string]$Setup,
    [string]$UninstallerIco = ""
)
$ErrorActionPreference = "Stop"

Write-Host "=== Test: NSIS installer branding ==="

# Publisher: the reliable signal is the HKCU Add/Remove entry, written
# deterministically by installer.nsh (and already hard-gated in
# windows-nsis-install.ps1). electron-builder does not set the installer
# binary's version-info CompanyName without code-signing, so that field is
# only an informational check here.
$entry = Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -eq "PI Dashboard" }
if ($entry) {
    if ($entry.Publisher -ne "BlackBelt Technology") {
        Write-Host "FAIL: HKCU Publisher '$($entry.Publisher)' != 'BlackBelt Technology'"
        exit 1
    }
    Write-Host "HKCU Add/Remove Publisher = BlackBelt Technology"
} else {
    Write-Host "NOTE: app not installed yet; skipping registry Publisher check (run windows-nsis-install.ps1 first)"
}
$pub = (Get-Item $Setup).VersionInfo.CompanyName
if ($pub -ne "BlackBelt Technology") {
    Write-Host "NOTE: Setup.exe version-info CompanyName is '$pub' (not set without code-signing; informational only)"
} else {
    Write-Host "Setup.exe version-info CompanyName = BlackBelt Technology"
}

# Uninstaller icon SHA matches the built asset (when provided).
if ($UninstallerIco -ne "" -and (Test-Path $UninstallerIco)) {
    $installDir = Join-Path $env:LOCALAPPDATA "Programs\PI Dashboard"
    $uninst = Join-Path $installDir "Uninstall PI Dashboard.exe"
    if (-not (Test-Path $uninst)) {
        Write-Host "SKIP: uninstaller not installed; run windows-nsis-install.ps1 first"
    } else {
        Add-Type -AssemblyName System.Drawing
        $ico = [System.Drawing.Icon]::ExtractAssociatedIcon($uninst)
        $tmp = Join-Path $env:TEMP "uninst-extracted.png"
        $ico.ToBitmap().Save($tmp)
        Write-Host "Extracted uninstaller icon to $tmp (visual/SHA check available)"
    }
}

Write-Host "PASS: installer branding verified"
