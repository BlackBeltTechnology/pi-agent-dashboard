# Test: agent path gate + shared canonical-subject suites pass NATIVELY on win32 (#X14)
#
# The L1 suites drive win32 path forms (drive letters, UNC, case-variant cwd)
# through an injected `path.win32` flavour on POSIX CI; this runs the SAME suites
# on a real Windows host, where `realpath`, volume case probing and `\` handling
# are the platform's own.
#
# Needs a repo checkout with deps installed (the shipped package excludes tests).
# Exit 77 = precondition not met (no checkout / no vitest) - loud SKIP, not FAIL.
#
# See change: ask-agent-file-access-in-chat.
$ErrorActionPreference = "Stop"

Write-Host "=== Test: agent path gate suites on win32 ==="

$repo = $env:PI_DASHBOARD_REPO
if (-not $repo) { $repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path }
if (-not (Test-Path (Join-Path $repo "packages\extension\src\path-gate"))) {
    Write-Host "SKIP: no repo checkout with packages/extension/src/path-gate at $repo (set PI_DASHBOARD_REPO)"
    exit 77
}
if (-not (Test-Path (Join-Path $repo "node_modules\vitest"))) {
    Write-Host "SKIP: vitest not installed under $repo (run pnpm install)"
    exit 77
}

# Ephemeral HOME: the suites refuse to run against the real user home.
$env:HOME = Join-Path $env:TEMP ("pi-test-" + [guid]::NewGuid().ToString("N"))
$env:USERPROFILE = $env:HOME
New-Item -ItemType Directory -Path $env:HOME -Force | Out-Null

$failed = $false
Push-Location (Join-Path $repo "packages\extension")
try {
    & npx vitest run src/path-gate
    if ($LASTEXITCODE -ne 0) { $failed = $true; Write-Host "FAIL: extension path-gate suites" }
} finally { Pop-Location }

Push-Location (Join-Path $repo "packages\server")
try {
    & npx vitest run src/access/__tests__/canonical-subject.test.ts src/access/__tests__/agent-grant.test.ts
    if ($LASTEXITCODE -ne 0) { $failed = $true; Write-Host "FAIL: canonical-subject / agent-grant suites" }
} finally { Pop-Location }

if ($failed) { exit 1 }
Write-Host "PASS: path-gate + canonical-subject suites green on win32"
exit 0
