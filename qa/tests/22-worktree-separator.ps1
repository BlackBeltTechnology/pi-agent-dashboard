# Test: worktree in-tree classification on Windows path separators (Windows)
#
# The manage-worktrees list derives `inTree` from the main worktree's own path.
# Windows porcelain output uses `\` separators; without normalisation EVERY row
# classifies out-of-tree and the default view collapses to the main row alone.
#
# Process-level assertion only: fetch `GET /api/git/worktrees` and evaluate the
# same predicate the client applies. No rendered-UI assert (that is Playwright's
# job, and Playwright does not run on this VM matrix).
#
# test-plan #X14. See change: manage-worktrees-filter-cleanup.
$ErrorActionPreference = "Stop"

Write-Host "=== Test: worktree separator classification ==="

try {
    $health = Invoke-WebRequest -Uri "http://localhost:8000/api/health" -UseBasicParsing -TimeoutSec 3
    if ($health.StatusCode -ne 200) { Write-Host "FAIL: Server not running"; exit 1 }
} catch {
    Write-Host "FAIL: Server not running ($_)"
    exit 1
}

$testDir = Join-Path $env:TEMP ("qa-wt-sep-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $testDir -Force | Out-Null

Push-Location $testDir
try {
    git init | Out-Null
    git config user.email "qa@test.com"
    git config user.name "QA"
    "test" | Out-File -FilePath "README.md" -Encoding ascii
    git add . | Out-Null
    git commit -m "init" | Out-Null

    # One `.worktrees/` entry — the case that must classify in-tree.
    git worktree add ".worktrees\feat-x" -b feat-x | Out-Null

    $encoded = [Uri]::EscapeDataString($testDir)
    $response = Invoke-WebRequest -Uri "http://localhost:8000/api/git/worktrees?cwd=$encoded" `
        -UseBasicParsing -TimeoutSec 10
    $json = $response.Content | ConvertFrom-Json
    if (-not $json.success) { Write-Host "FAIL: /api/git/worktrees returned success=false"; exit 1 }

    $entries = $json.data.worktrees
    if ($entries.Count -lt 2) { Write-Host "FAIL: expected >= 2 worktree entries, got $($entries.Count)"; exit 1 }

    $main = $entries | Where-Object { $_.isMain } | Select-Object -First 1
    if (-not $main) { Write-Host "FAIL: no main worktree entry"; exit 1 }

    # The client-side predicate, verbatim: normalise `\` -> `/`, then prefix-test.
    function Normalise([string]$p) { return ($p -replace '\\', '/').TrimEnd('/') }
    $mainNorm = Normalise $main.path
    $prefix = "$mainNorm/.worktrees/"

    $inTree = @($entries | Where-Object { -not $_.isMain -and (Normalise $_.path).StartsWith($prefix) })
    if ($inTree.Count -lt 1) {
        Write-Host "FAIL: the .worktrees entry did not classify in-tree"
        Write-Host "  main:  $($main.path)"
        foreach ($e in $entries) { Write-Host "  entry: $($e.path)" }
        exit 1
    }
    Write-Host "In-tree classification holds on Windows separators ($($inTree.Count) in-tree entry)"

    # The default view is `isMain || (!detached && inTree)` — it must NOT collapse
    # to the main row alone.
    $defaultVisible = @($entries | Where-Object {
        $_.isMain -or ((-not $_.detached) -and (Normalise $_.path).StartsWith($prefix))
    })
    if ($defaultVisible.Count -lt 2) {
        Write-Host "FAIL: default view collapsed to $($defaultVisible.Count) row(s)"
        exit 1
    }
    Write-Host "Default view shows $($defaultVisible.Count) rows (not collapsed)"

    Write-Host "PASS: worktree separator classification"
    exit 0
} finally {
    Pop-Location
    try {
        Push-Location $testDir
        git worktree remove ".worktrees\feat-x" --force 2>$null | Out-Null
        Pop-Location
    } catch { }
    Remove-Item -Recurse -Force $testDir -ErrorAction SilentlyContinue
}
