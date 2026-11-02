# DRAFT remote-clean.ps1 (spike prototype for qa/remote/). Validated on windows-latest runs
# 40184762256 + 40186714826: idempotent (3x rc=0 on a clean host), uninstalls NSIS + npm-global.
# Idempotent: returns a Windows QA host to a "pi-dashboard never ran here" state.
# Exit 0 = clean. Exit 3 = residue remained (listed). Windows PowerShell 5.1 compatible.
param(
    [int[]]$Ports = @(8000, 8112, 9999),
    [string[]]$ExtraPaths = @()
)
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
function Log([string]$m) { Write-Output "[clean] $m" }

# 1. Graceful stop through the CLI when present (npm mode).
if (Get-Command pi-dashboard -ErrorAction SilentlyContinue) {
    $null = & pi-dashboard stop 2>&1
    Log "pi-dashboard stop rc=$LASTEXITCODE"
}

# 2. Kill by name. (node is broad on purpose: QA host must be dedicated.)
$procs = @(Get-Process -Name 'pi-dashboard', 'PI Dashboard', 'electron', 'node' -ErrorAction SilentlyContinue)
if ($procs.Count) {
    Log ("killing: " + (($procs | ForEach-Object { "$($_.Name):$($_.Id)" }) -join ' '))
    $procs | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

# 3. Port stragglers.
foreach ($p in $Ports) {
    Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
        if ($_.OwningProcess -gt 4) {
            Log "port $p held by pid $($_.OwningProcess) -> kill"
            Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
        }
    }
}

# 4. Per-user NSIS install -> run its own uninstaller silently.
$uninstRoot = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
$entries = @(Get-ItemProperty $uninstRoot -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq 'PI Dashboard' })
foreach ($e in $entries) {
    $exe = $null
    foreach ($cand in @($e.QuietUninstallString, $e.UninstallString)) {
        if ($cand -and ($cand -match '"([^"]+\.exe)"' -or $cand -match '^\s*(\S+\.exe)')) { $exe = $Matches[1]; break }
    }
    if ($exe -and (Test-Path $exe)) {
        Log "nsis uninstall: $exe /S"
        Start-Process -FilePath $exe -ArgumentList '/S' -Wait
        for ($i = 0; $i -lt 90; $i++) {
            if (-not (Get-ItemProperty $uninstRoot -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq 'PI Dashboard' })) { break }
            Start-Sleep -Seconds 1
        }
    }
    # Orphaned entry (uninstaller gone): drop the key.
    if (Test-Path $e.PSPath) { Remove-Item $e.PSPath -Recurse -Force -ErrorAction SilentlyContinue; Log "removed orphan key $($e.PSChildName)" }
}

# 5. npm-global package.
if (Get-Command npm -ErrorAction SilentlyContinue) {
    $root = (& npm root -g 2>$null | Out-String).Trim()
    if ($root -and (Test-Path (Join-Path $root '@blackbelt-technology\pi-agent-dashboard'))) {
        $null = & npm rm -g '@blackbelt-technology/pi-agent-dashboard' 2>&1
        Log "npm rm -g pi-agent-dashboard rc=$LASTEXITCODE"
    }
}

# 6. State paths.
$paths = @(
    (Join-Path $env:USERPROFILE '.pi'),
    (Join-Path $env:USERPROFILE '.pi-dashboard'),
    (Join-Path $env:APPDATA 'pi-dashboard'),
    (Join-Path $env:APPDATA 'PI Dashboard'),
    (Join-Path $env:APPDATA 'pi-agent-dashboard'),
    (Join-Path $env:LOCALAPPDATA 'pi-dashboard'),
    (Join-Path $env:LOCALAPPDATA '@blackbelt-technologypi-dashboard-electron-updater'),  # electron-updater cache (spike R7/R9 diff)
    (Join-Path $env:LOCALAPPDATA 'pi-agent-dashboard'),
    (Join-Path $env:LOCALAPPDATA 'Programs\PI Dashboard'),
    (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\PI Dashboard.lnk'),
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'PI Dashboard.lnk'),
    'C:\qa-artifacts',
    'C:\PI-Dashboard-test'
) + $ExtraPaths
$paths += @(Get-ChildItem -Path $env:TEMP -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^(pi-dash|qa-prefix-|~nsu)' } | ForEach-Object { $_.FullName })
$paths += 'HKCU:\Software\BlackBelt Technology'   # written by the NSIS installer, survives its uninstaller (spike R9 diff)

foreach ($p in $paths) {
    if (-not (Test-Path -LiteralPath $p)) { continue }
    for ($try = 1; $try -le 3; $try++) {
        Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction SilentlyContinue
        if (-not (Test-Path -LiteralPath $p)) { Log "removed $p"; break }
        Start-Sleep -Seconds 1
    }
}

# 7. Verify.
$residue = @()
$residue += @($paths | Where-Object { Test-Path -LiteralPath $_ } | ForEach-Object { "path:$_" })
$residue += @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in $Ports } | ForEach-Object { "port:$($_.LocalPort)" })
$residue += @(Get-Process -Name 'pi-dashboard', 'electron' -ErrorAction SilentlyContinue | ForEach-Object { "proc:$($_.Name):$($_.Id)" })
$residue += @(Get-ItemProperty $uninstRoot -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq 'PI Dashboard' } | ForEach-Object { "reg:$($_.PSChildName)" })
if ($residue.Count) { Log ("RESIDUE: " + ($residue -join ' | ')); exit 3 }
Log "clean"
exit 0
