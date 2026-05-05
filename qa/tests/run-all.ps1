# Run all QA tests in order (Windows)
$ErrorActionPreference = "Continue"

$tests = @(
    "01-install.ps1",
    "02-server-start.ps1",
    "03-websocket.ps1",
    "04-terminal.ps1",
    "05-git-ops.ps1",
    "07-electron-bootstrap-v2.ps1"  # skips when ZIP artifact absent
)

$passed = 0
$failed = 0
$skipped = 0
$results = @()

Write-Host "========================================"
Write-Host "           QA Test Suite (Windows)"
Write-Host "========================================"
Write-Host ""

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

foreach ($test in $tests) {
    $testPath = Join-Path $scriptDir $test
    if (-not (Test-Path $testPath)) {
        Write-Host "SKIP: $test (not found)"
        $results += "SKIP  $test"
        $skipped++
        continue
    }

    Write-Host "----------------------------------------"
    Write-Host "Running: $test"
    Write-Host "----------------------------------------"

    try {
        & $testPath
        if ($LASTEXITCODE -eq 0) {
            $passed++
            $results += "PASS  $test"
        } else {
            $failed++
            $results += "FAIL  $test"
        }
    } catch {
        $failed++
        $results += "FAIL  $test ($_)"
    }
    Write-Host ""
}

# Cleanup
try { pi-dashboard stop 2>$null } catch {}

# Summary
Write-Host "========================================"
Write-Host "           Test Results"
Write-Host "========================================"
foreach ($r in $results) {
    Write-Host "  $r"
}
$total = $passed + $failed
Write-Host "========================================"
Write-Host "  Total: $total  Passed: $passed  Failed: $failed  Skipped: $skipped"
Write-Host "========================================"

# Fail the suite if anything was skipped or failed — skipped tests mean the
# suite is incomplete and could hide real breakage on Windows.
if ($failed -gt 0 -or $skipped -gt 0) { exit 1 }
exit 0
