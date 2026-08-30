# Test: keeper-log rotation bound on Windows (change: fix-runaway-keeper-log-growth, test-plan #E16)
#
# Drives a REAL keeper.cjs (from the cloned repo) with a 64 KiB cap and
# capture ON while a mock pi child floods the shared stdout fd. Asserts the
# core Windows contract (design D4):
#   - the log size DROPS below the cap (ftruncate works, or the path-truncate
#     fallback carries the rotation),
#   - the file is NOT renamed or removed (same path, same inode semantics as
#     far as the filesystem exposes),
#   - the keeper is still alive and still forwarding RPC lines to pi.
#
# VM cadence only (qa README test list) — deliberately NOT wired into the
# windows-latest CI leg (resolved clarification in the change's test plan).
$ErrorActionPreference = "Stop"

Write-Host "=== Test: Keeper log rotation (64 KiB cap, capture on) ==="

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$keeper = Join-Path $repoRoot "packages\server\src\rpc-keeper\keeper.cjs"
if (-not (Test-Path $keeper)) {
    Write-Host "FAIL: keeper.cjs not found at $keeper"
    exit 1
}

$CAP_BYTES = 65536
$CHECK_MS = 250
$sid = "qa" + [guid]::NewGuid().ToString("N").Substring(0, 12)
$work = Join-Path ([System.IO.Path]::GetTempPath()) ("keeper-qa-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Path $work | Out-Null
$sessionsDir = Join-Path $env:USERPROFILE ".pi\dashboard\sessions"
$logPath = Join-Path $sessionsDir "keeper-$sid.log"
$pidPath = Join-Path $sessionsDir "pi-rpc-$sid.pid"
$pipeName = "pi-rpc-$sid"

# Self-contained mock pi: floods stdout with 'a' blocks (keeper captures
# stdout into the shared log fd when PI_KEEPER_CAPTURE_PI_OUTPUT=1) and
# appends stdin lines to a side log so RPC forwarding is observable.
$mockPi = Join-Path $work "mock-pi.cjs"
@"
"use strict";
const fs = require("fs");
const sideLog = process.env.MOCK_PI_SIDE_LOG;
const chunk = Buffer.alloc(2048, 0x61); // 'a'
setInterval(() => { process.stdout.write(chunk); }, 5); // ~400 KB/s
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => {
  buf += c;
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    if (sideLog) fs.appendFileSync(sideLog, line + "\n");
  }
});
process.stdin.resume();
"@ | Set-Content -Path $mockPi -Encoding UTF8
$sideLog = Join-Path $work "mock-pi-side.log"

# Keeper env (children of this shell inherit; keeper reads them directly).
$env:PI_KEEPER_LOG_MAX_BYTES = "$CAP_BYTES"
$env:PI_KEEPER_LOG_CHECK_INTERVAL_MS = "$CHECK_MS"
$env:PI_KEEPER_CAPTURE_PI_OUTPUT = "1"
$env:PI_KEEPER_PI_CMD = ConvertTo-Json @("node", $mockPi) -Compress
$env:MOCK_PI_SIDE_LOG = $sideLog

$keeperProc = $null
function Cleanup {
    # Tree-kill the keeper: /T takes the mock pi child with it (a bare
    # Stop-Process -Force skips the keeper's shutdown handler, which is the
    # only thing that SIGKILLs pi).
    if ($keeperProc -and -not $keeperProc.HasExited) {
        try { taskkill /PID $keeperProc.Id /T /F 2>$null | Out-Null } catch { Write-Verbose "taskkill failed: $_" }
    }
    # Fallback for a keeper that already exited: the mock pi's command line
    # carries the unique work-dir marker, NOT the session id.
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like "*$work*" } |
        ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch { Write-Verbose "mock-pi stop failed: $_" } }
    Remove-Item Env:PI_KEEPER_LOG_MAX_BYTES -ErrorAction SilentlyContinue
    Remove-Item Env:PI_KEEPER_LOG_CHECK_INTERVAL_MS -ErrorAction SilentlyContinue
    Remove-Item Env:PI_KEEPER_CAPTURE_PI_OUTPUT -ErrorAction SilentlyContinue
    Remove-Item Env:PI_KEEPER_PI_CMD -ErrorAction SilentlyContinue
    Remove-Item Env:MOCK_PI_SIDE_LOG -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}

try {
    $keeperProc = Start-Process -FilePath "node" -ArgumentList "`"$keeper`" $sid" -PassThru -WindowStyle Hidden

    # 1. Keeper wrote its PID sidecar (bound + alive).
    $deadline = (Get-Date).AddSeconds(15)
    while (-not (Test-Path $pidPath)) {
        if ($keeperProc.HasExited) { Write-Host "FAIL: keeper exited before writing PID sidecar"; exit 1 }
        if ((Get-Date) -gt $deadline) { Write-Host "FAIL: PID sidecar never appeared"; exit 1 }
        Start-Sleep -Milliseconds 200
    }
    Write-Host "Keeper alive (pid $($keeperProc.Id)), PID sidecar written"

    # 2. Child floods the log past the cap.
    $deadline = (Get-Date).AddSeconds(60)
    while (-not (Test-Path $logPath) -or (Get-Item $logPath).Length -lt $CAP_BYTES) {
        if ($keeperProc.HasExited) { Write-Host "FAIL: keeper exited while log was growing"; exit 1 }
        if ((Get-Date) -gt $deadline) { Write-Host "FAIL: log never reached the cap"; exit 1 }
        Start-Sleep -Milliseconds 500
    }
    Write-Host "Log reached cap ($(Get-Item $logPath).Length bytes); waiting for rotation"

    # 3. THE assertion: size drops below the cap. On Windows this either
    #    proves ftruncateSync works on the append handle, or that the
    #    path-truncate fallback carries every rotation (design D4).
    $rotated = $false
    $deadline = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $deadline) {
        if ($keeperProc.HasExited) { Write-Host "FAIL: keeper exited during rotation wait"; exit 1 }
        if ((Test-Path $logPath) -and (Get-Item $logPath).Length -lt $CAP_BYTES) { $rotated = $true; break }
        Start-Sleep -Milliseconds 500
    }
    if (-not $rotated) {
        Write-Host "FAIL: log size never dropped below the cap (rotation silently not working on Windows)"
        exit 1
    }
    $sizeAfter = (Get-Item $logPath).Length
    Write-Host "Rotation happened: log is now $sizeAfter bytes (< $CAP_BYTES)"

    # 4. File NOT renamed/removed: same path still holds the live log, and it
    #    keeps growing (the child still writes into it through the shared fd).
    if (-not (Test-Path $logPath)) { Write-Host "FAIL: live log was removed"; exit 1 }
    $generations = Get-ChildItem $sessionsDir -Filter "keeper-$sid.log*" | Select-Object -ExpandProperty Name
    if ($generations.Count -ne 1) {
        Write-Host "FAIL: retained generations appeared: $($generations -join ', ')"
        exit 1
    }
    # Prove the child still writes through the shared fd by SAMPLING: the size
    # must CHANGE across the window (it may have rotated again between any two
    # samples, so a point-in-time comparison against $sizeAfter would flake).
    # Every sample must also stay under 2x cap — the bound still holds.
    $samples = @()
    for ($i = 0; $i -lt 8; $i++) {
        Start-Sleep -Milliseconds 300
        $samples += (Get-Item $logPath).Length
    }
    $maxSample = ($samples | Measure-Object -Maximum).Maximum
    if (($samples | Select-Object -Unique).Count -lt 2) {
        Write-Host "FAIL: log size never changed after rotation (child fd detached?)"
        exit 1
    }
    if ($maxSample -ge (2 * $CAP_BYTES)) {
        Write-Host "FAIL: post-rotation log reached $maxSample bytes (>= 2x cap) - bound not holding"
        exit 1
    }
    Write-Host "Live log flowing after rotation (samples: $($samples -join ','))"

    # 5. Keeper still forwards RPC: a line written to the named pipe must
    #    reach the mock pi's side log.
    $pipe = New-Object System.IO.Pipes.NamedPipeClientStream(".", $pipeName, [System.IO.Pipes.PipeDirection]::Out)
    $pipe.Connect(5000)
    $writer = New-Object System.IO.StreamWriter($pipe)
    $writer.NewLine = "`n"
    $marker = "qa-rpc-marker-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
    $writer.WriteLine('{"type":"prompt","message":"' + $marker + '","id":"1"}')
    $writer.Flush()
    $deadline = (Get-Date).AddSeconds(10)
    $forwarded = $false
    while ((Get-Date) -lt $deadline) {
        if ((Test-Path $sideLog) -and (Get-Content $sideLog -Raw -ErrorAction SilentlyContinue) -match $marker) {
            $forwarded = $true; break
        }
        Start-Sleep -Milliseconds 300
    }
    if (-not $forwarded) { Write-Host "FAIL: RPC line was not forwarded after rotation"; exit 1 }
    Write-Host "RPC line forwarded post-rotation"

    if ($keeperProc.HasExited) { Write-Host "FAIL: keeper exited before cleanup"; exit 1 }

    Write-Host "PASS: keeper log bounded on Windows (rotated in place, no generations, RPC intact)"
} finally {
    Cleanup
}

exit 0
