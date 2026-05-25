<#
.SYNOPSIS
  Windows port of scripts/test-standalone-npm-install.sh.

.DESCRIPTION
  End-to-end smoke for the standalone npm install path on Windows:
    1. npm pack every publishable workspace
    2. install them into an isolated temp HOME with no pi installed
    3. spawn pi-dashboard headless via node_modules\.bin\pi-dashboard.cmd
    4. poll /api/health until ok=true (or fail after 60s)
    5. assert the web UI is reachable
    6. tear down

  Mirrors the bash script's six-phase contract, [smoke] log prefixes,
  -Port / -Keep flags, and 60s deadline so CI logs are cross-grep-able
  across platforms.

  Probe rationale: after eliminate-electron-runtime-install (commit
  d3fe2163) the dashboard no longer installs pi lazily after server
  start — there is no "bootstrap" reconcile phase to wait for. The
  server is either listening on its port or it isn't, so a plain
  /api/health probe is the right readiness signal.

  Locks down three Windows-only spawn bugs fixed in 0f2d08aa:
    1. shouldUrlWrapEntry mis-wrapping jiti entries with file:///C:/…
    2. runNpmOnce spawn EFTYPE on npm.cmd (.cmd needs shell:true)
    3. nodeScriptToArgv missing node.exe prefix when registry.resolve fails

.PARAMETER Port
  Dashboard port (default 18000 to avoid colliding with a dev instance).

.PARAMETER Keep
  Leave the temp HOME on disk for inspection.

.EXAMPLE
  pwsh ./scripts/test-standalone-npm-install.ps1 -Port 18000
#>

[CmdletBinding()]
param(
  [int]$Port = 18000,
  [switch]$Keep
)

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $RepoRoot

# Create an isolated temp HOME so the install writes ~/.pi/dashboard/* into
# the temp tree, not the real user profile.
$Tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("pi-dash-standalone-" + [System.Guid]::NewGuid().ToString("N").Substring(0, 8))
$TmpHome = Join-Path $Tmp "home"
$PackDir = Join-Path $Tmp "packs"
$InstallDir = Join-Path $TmpHome "pi-dashboard-install"
$ServerLog = Join-Path $Tmp "server.log"
$ServerErr = Join-Path $Tmp "server.err.log"

New-Item -ItemType Directory -Force -Path $TmpHome | Out-Null
New-Item -ItemType Directory -Force -Path $PackDir | Out-Null

$server = $null

try {
  Write-Host "[smoke] temp HOME: $TmpHome"
  Write-Host "[smoke] packing workspaces..."

  # Build the web client first (its dist/ is shipped in the published tarball).
  & npm run build --workspace=@blackbelt-technology/pi-dashboard-web | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "npm run build (web client) failed (exit $LASTEXITCODE)" }

  # Pack root + every workspace under packages/.
  & npm --prefix $RepoRoot pack -ws --include-workspace-root --pack-destination $PackDir | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "npm pack failed (exit $LASTEXITCODE)" }

  $Tgzs = @(Get-ChildItem -Path $PackDir -Filter "*.tgz" | ForEach-Object { $_.FullName })
  Write-Host "[smoke] packed $($Tgzs.Count) tarballs"
  if ($Tgzs.Count -eq 0) { throw "no tarballs produced in $PackDir" }

  # Install into an isolated prefix under TMP_HOME.
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  Push-Location $InstallDir
  try {
    & npm init -y | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "npm init -y failed (exit $LASTEXITCODE)" }

    Write-Host "[smoke] installing tarballs into $InstallDir..."
    & npm install @Tgzs --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm install of tarballs failed (exit $LASTEXITCODE)" }
  } finally {
    Pop-Location
  }

  # On Windows the npm bin shim is `pi-dashboard.cmd`, not bare `pi-dashboard`.
  $Bin = Join-Path $InstallDir "node_modules\.bin\pi-dashboard.cmd"
  if (-not (Test-Path -LiteralPath $Bin)) {
    throw "[smoke] FAIL: pi-dashboard.cmd not found at $Bin"
  }

  Write-Host "[smoke] launching pi-dashboard on port $Port..."

  # Override HOME and USERPROFILE so ~/.pi/dashboard/* lands in the temp tree.
  # PowerShell `~` resolves to USERPROFILE on Windows; both must be set to
  # mimic the bash `HOME=` override.
  $env:HOME = $TmpHome
  $env:USERPROFILE = $TmpHome
  $env:PI_DASHBOARD_PORT = "$Port"

  $server = Start-Process -FilePath $Bin `
    -NoNewWindow -PassThru `
    -RedirectStandardOutput $ServerLog `
    -RedirectStandardError $ServerErr
  Write-Host "[smoke] server pid: $($server.Id)"

  # Poll /api/health for up to 60s. See header rationale.
  $deadline = (Get-Date).AddSeconds(60)
  $ready = $false
  $url = "http://localhost:$Port/api/health"

  while ((Get-Date) -lt $deadline) {
    if ($server.HasExited) {
      Write-Host "[smoke] FAIL: server exited early (exit $($server.ExitCode))"
      Write-Host "---- server.log (last 100 lines) ----"
      if (Test-Path $ServerLog) { Get-Content -Tail 100 $ServerLog | ForEach-Object { Write-Host $_ } }
      Write-Host "---- server.err.log (last 100 lines) ----"
      if (Test-Path $ServerErr) { Get-Content -Tail 100 $ServerErr | ForEach-Object { Write-Host $_ } }
      Write-Host "--------------------------------------"
      exit 1
    }

    try {
      $resp = Invoke-RestMethod -Uri $url -TimeoutSec 5
      if ($null -ne $resp -and $resp.ok -eq $true) {
        Write-Host "[smoke] OK server healthy (mode=$($resp.mode), uptime=$($resp.uptime)s)"
        $ready = $true
        break
      }
    } catch {
      # Server not yet listening / connection refused — retry after sleep.
    }

    Start-Sleep -Seconds 2
  }

  if (-not $ready) {
    Write-Host "[smoke] FAIL: /api/health did not return ok=true within 60s"
    Write-Host "---- server.log (last 100 lines) ----"
    if (Test-Path $ServerLog) { Get-Content -Tail 100 $ServerLog | ForEach-Object { Write-Host $_ } }
    Write-Host "---- server.err.log (last 100 lines) ----"
    if (Test-Path $ServerErr) { Get-Content -Tail 100 $ServerErr | ForEach-Object { Write-Host $_ } }
    Write-Host "--------------------------------------"
    exit 1
  }

  # Confirm UI is served.
  try {
    Invoke-WebRequest -Uri "http://localhost:$Port/" -TimeoutSec 5 -UseBasicParsing | Out-Null
    Write-Host "[smoke] OK web UI reachable"
  } catch {
    Write-Host "[smoke] FAIL: web UI not reachable: $($_.Exception.Message)"
    Write-Host "---- server.log (last 100 lines) ----"
    if (Test-Path $ServerLog) { Get-Content -Tail 100 $ServerLog | ForEach-Object { Write-Host $_ } }
    Write-Host "---- server.err.log (last 100 lines) ----"
    if (Test-Path $ServerErr) { Get-Content -Tail 100 $ServerErr | ForEach-Object { Write-Host $_ } }
    Write-Host "--------------------------------------"
    exit 1
  }

  Write-Host "[smoke] OK standalone npm install smoke passed"
}
finally {
  if ($null -ne $server -and -not $server.HasExited) {
    try { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue } catch {}
    Start-Sleep -Seconds 1
    try { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue } catch {}
  }
  if ($Keep) {
    Write-Host "[smoke] kept temp HOME at: $TmpHome"
  } else {
    try { Remove-Item -Recurse -Force -LiteralPath $Tmp -ErrorAction SilentlyContinue } catch {}
  }
}
