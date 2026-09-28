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
