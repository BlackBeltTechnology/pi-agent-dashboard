# Test: NSIS Setup.exe is per-user ONLY — never registers per-machine.
# Regression guard for design D2 (per-user only, no per-machine mode).
#
# Assumes windows-nsis-install.ps1 already ran a default-path /S install.
$ErrorActionPreference = "Stop"

Write-Host "=== Test: NSIS installer is per-user only (no per-machine) ==="

# No HKLM Add/Remove Programs entry for PI Dashboard (32- or 64-bit view).
$hklmKeys = @(
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
)
foreach ($k in $hklmKeys) {
    $hit = Get-ItemProperty $k -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -eq "PI Dashboard" }
    if ($hit) {
        Write-Host "FAIL: found per-machine (HKLM) entry under $k"
        exit 1
    }
}
Write-Host "No HKLM Add/Remove entry (correct)"

# Install dir must NOT be under Program Files.
$entry = Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -eq "PI Dashboard" }
if (-not $entry) {
    Write-Host "FAIL: expected HKCU entry missing (did the install run?)"
    exit 1
}
$loc = $entry.InstallLocation
if ($loc -like "$env:ProgramFiles*" -or $loc -like "${env:ProgramFiles(x86)}*") {
    Write-Host "FAIL: install dir '$loc' is under Program Files (per-machine)"
    exit 1
}
Write-Host "Install dir '$loc' is per-user (not Program Files)"

Write-Host "PASS: installer is per-user only"
