# =============================================================================
# start-server.ps1 - manual launch of the bundled dashboard server (PowerShell)
#
# Resolves bundled node.exe + the bundled TypeScript loader from THIS script's
# location and invokes the same argv shape that the Electron main process uses.
# Loader: the Node-native register module (the only server loader).
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
# See changes: add-bundle-manual-launch-scripts, fix-appimage-cold-boot-latency,
# strip-only-native-ts-loader.
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

# TypeScript loader as file:// URL (forward slashes required): the Node-native
# register module only.
$loaderPath = Join-Path $svrDir 'node_modules\@blackbelt-technology\pi-dashboard-shared\src\platform\native-ts-register.mjs'
if (-not (Test-Path $loaderPath)) {
  Write-Error "Bundled TypeScript loader not found at: $loaderPath"
  exit 1
}
$loaderUrl = "file:///" + ($loaderPath -replace '\\','/')

# Entry: RAW Windows path (Node path.resolve()s the main entry under any
# --import loader, so a file:// entry breaks).
$cli = Join-Path $svrDir 'node_modules\@blackbelt-technology\pi-dashboard-server\src\cli.ts'
if (-not (Test-Path $cli)) {
  Write-Error "Bundled cli.ts not found at: $cli"
  exit 1
}

# Default subcommand = "start" when invoked with no args
$childArgs = if ($args.Count -eq 0) { @('start') } else { $args }

Set-Location $svrDir
& $nodeExe --import $loaderUrl $cli @childArgs
$ec = $LASTEXITCODE

Write-Host ""
Write-Host "Server exited with code $ec"
exit $ec
