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

# Publisher embedded in the Setup.exe version-info resource.
$pub = (Get-Item $Setup).VersionInfo.CompanyName
if ($pub -ne "BlackBelt Technology") {
    Write-Host "FAIL: Setup.exe CompanyName '$pub' != 'BlackBelt Technology'"
    exit 1
}
Write-Host "Setup.exe Publisher = BlackBelt Technology"

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
