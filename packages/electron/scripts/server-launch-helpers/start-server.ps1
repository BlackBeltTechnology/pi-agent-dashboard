# =============================================================================
# start-server.ps1 - manual launch of the bundled dashboard server (PowerShell)
#
# Resolves bundled node.exe + bundled jiti loader from THIS script's location
# and invokes the same argv shape that the Electron main process uses.
# No system Node required.
#
# Usage:
#   .\start-server.ps1                 # defaults to: cli.ts start
#   .\start-server.ps1 status
#   .\start-server.ps1 stop
#   .\start-server.ps1 restart
#
# Argv contract: packages/shared/src/platform/node-spawn.ts
#   ::buildNodeImportArgvParts
# See change: add-bundle-manual-launch-scripts.
# =============================================================================

$ErrorActionPreference = 'Stop'

# $PSScriptRoot = directory of this script (no trailing separator)
$svrDir = $PSScriptRoot

# Bundled node lives one level up under resources\node\
$nodeExe = Join-Path (Split-Path $svrDir -Parent) 'node\node.exe'
if (-not (Test-Path $nodeExe)) {
  Write-Error "Bundled node.exe not found at: $nodeExe"
  exit 1
}

# jiti loader as file:// URL (forward slashes required)
$jitiPath = Join-Path $svrDir 'node_modules\jiti\lib\jiti-register.mjs'
if (-not (Test-Path $jitiPath)) {
  Write-Error "Bundled jiti loader not found at: $jitiPath"
  exit 1
}
$jitiUrl = "file:///" + ($jitiPath -replace '\\','/')

# Entry as raw Windows path (Node's drive-letter heuristic accepts it;
# jiti's JITI VERSION CONTRACT requires raw path for entry position).
$cli = Join-Path $svrDir 'packages\server\src\cli.ts'
if (-not (Test-Path $cli)) {
  Write-Error "Bundled cli.ts not found at: $cli"
  exit 1
}

# Default subcommand = "start" when invoked with no args
$childArgs = if ($args.Count -eq 0) { @('start') } else { $args }

Set-Location $svrDir
& $nodeExe --import $jitiUrl $cli @childArgs
$ec = $LASTEXITCODE

Write-Host ""
Write-Host "Server exited with code $ec"
exit $ec
