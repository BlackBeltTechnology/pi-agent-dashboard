# Test: pi-dashboard server starts and health endpoint responds (Windows)
$ErrorActionPreference = "Stop"

Write-Host "=== Test: Server start ==="

# Start server in background
$proc = Start-Process -FilePath "pi-dashboard" -ArgumentList "start" -PassThru -WindowStyle Hidden

# Cleanup on exit
try {
    # Wait for health endpoint (up to 15 seconds)
    $timeout = 15
    $elapsed = 0
    $ready = $false
    while ($elapsed -lt $timeout) {
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:8000/api/health" -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -eq 200) {
                Write-Host "Health endpoint responded HTTP 200"

                # --- Windows native-separator subpath derivation (test-plan #X13) ---
                # See change: adopt-piai-factory-api-registry (task 6.26).
                #
                # The pre-change registry derived pi-ai's oauth sibling with the
                # POSIX-only regex `/\/dist\/index\.js$/`, which SILENTLY no-ops on
                # a native-separator `C:\...\dist\index.js` path. The seam derives
                # with `path` operations instead. If derivation regresses on
                # Windows the registry never reaches ready, so /api/models answers
                # 503 forever — which is exactly what is asserted here (200, and
                # the same runtime-tracking ids the POSIX smoke checks).
                $catalogueOk = $false
                for ($i = 0; $i -lt 20; $i++) {
                    try {
                        $models = Invoke-RestMethod -Uri "http://localhost:8000/api/models?annotated=1" -TimeoutSec 10
                        $ids = @($models.data | ForEach-Object { $_.id })
                        if ($ids.Count -gt 0) {
                            $want = @("anthropic/claude-opus-5", "zai/glm-5.3", "deepseek/deepseek-flash")
                            $missing = @($want | Where-Object { $ids -notcontains $_ })
                            if ($missing.Count -gt 0) {
                                Write-Host "FAIL: registry reached ready but the catalogue is missing $($missing -join ', ') (got $($ids.Count) models)"
                                exit 1
                            }
                            Write-Host "OK: registry reached ready on a native-separator path — $($ids.Count) models incl. $($want -join ', ')"
                            $catalogueOk = $true
                            break
                        }
                    } catch {
                        # 503 = registry still initializing, or derivation failed.
                        Start-Sleep -Seconds 1
                    }
                }
                if (-not $catalogueOk) {
                    Write-Host "FAIL: /api/models never returned a populated catalogue — registry did not reach ready (subpath derivation failed on a Windows path?)"
                    exit 1
                }

                # --- Native TS loader on Windows, incl. a B: drive (test-plan #X4) ---
                # See change: fix-appimage-cold-boot-latency. The default launch
                # boots on native-ts-register.mjs with a RAW entry path; the B:
                # relaunch below checks that a raw drive-letter entry is not
                # parsed as a URL scheme (ERR_UNSUPPORTED_ESM_URL_SCHEME).
                $logPath = Join-Path $env:USERPROFILE ".pi\dashboard\server.log"
                function Get-LastLaunchHeader {
                    (Get-Content $logPath -ErrorAction SilentlyContinue | Select-String -SimpleMatch "launch (parent pid" | Select-Object -Last 1).Line
                }
                $header = Get-LastLaunchHeader
                if (-not $header -or $header -notmatch "native-ts-register\.mjs") {
                    Write-Host "FAIL (#X4): default launch header does not name native-ts-register.mjs: $header"
                    exit 1
                }
                Write-Host "OK: default launch header names the native TS loader"

                # Relaunch from a subst B: drive mapped onto the install root.
                try { pi-dashboard stop 2>$null } catch {}
                Start-Sleep -Seconds 3
                $prefix = (npm prefix -g).Trim()
                $wrapper = Get-ChildItem -Path (Join-Path $prefix "node_modules") -Recurse -Filter "pi-dashboard.mjs" -ErrorAction SilentlyContinue |
                    Where-Object { $_.FullName -match "pi-dashboard-server\\bin\\pi-dashboard\.mjs$" } | Select-Object -First 1
                if (-not $wrapper) {
                    Write-Host "FAIL (#X4): could not locate pi-dashboard-server\bin\pi-dashboard.mjs under $prefix"
                    exit 1
                }
                subst B: /D 2>$null | Out-Null
                subst B: $prefix
                try {
                    $bWrapper = "B:" + $wrapper.FullName.Substring($prefix.Length)
                    Write-Host "Launching from the B: drive: $bWrapper"
                    $bProc = Start-Process -FilePath "node" -ArgumentList "`"$bWrapper`" start" -PassThru -WindowStyle Hidden -WorkingDirectory "B:\"
                    $bReady = $false
                    for ($j = 0; $j -lt 30; $j++) {
                        try {
                            $r = Invoke-WebRequest -Uri "http://localhost:8000/api/health" -UseBasicParsing -TimeoutSec 2
                            if ($r.StatusCode -eq 200) { $bReady = $true; break }
                        } catch {}
                        Start-Sleep -Seconds 1
                    }
                    $bHeader = Get-LastLaunchHeader
                    $logText = Get-Content $logPath -Raw -ErrorAction SilentlyContinue
                    if (-not $bReady) {
                        Write-Host "FAIL (#X4): B: drive launch never reached /api/health. Last header: $bHeader"
                        exit 1
                    }
                    # Node may realpath the subst drive back to its target, so the
                    # header's cli path is not asserted — only the loader and the
                    # absence of the URL-scheme failure.
                    if ($bHeader -notmatch "native-ts-register\.mjs") {
                        Write-Host "FAIL (#X4): B: launch header does not name native-ts-register.mjs: $bHeader"
                        exit 1
                    }
                    if ($logText -match "ERR_UNSUPPORTED_ESM_URL_SCHEME") {
                        Write-Host "FAIL (#X4): server.log carries ERR_UNSUPPORTED_ESM_URL_SCHEME"
                        exit 1
                    }
                    Write-Host "OK (#X4): native launch from B: is healthy, no ERR_UNSUPPORTED_ESM_URL_SCHEME"
                } finally {
                    try { pi-dashboard stop 2>$null } catch {}
                    Start-Sleep -Seconds 2
                    subst B: /D 2>$null | Out-Null
                }

                Write-Host "PASS: Server started successfully"
                $ready = $true
                break
            }
        } catch {
            # Keep polling
        }
        Start-Sleep -Seconds 1
        $elapsed++
    }

    if (-not $ready) {
        Write-Host "FAIL: Health endpoint did not respond HTTP 200 within ${timeout}s"
        exit 1
    }
} finally {
    # Try graceful stop first
    try { pi-dashboard stop 2>$null } catch {}
    if ($proc -and -not $proc.HasExited) {
        try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch {}
    }
}

exit 0
