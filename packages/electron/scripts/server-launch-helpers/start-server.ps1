# =============================================================================
# start-server.ps1 - manual launch of the bundled dashboard server (PowerShell)
#
# Resolves bundled node.exe + the bundled TypeScript loader from THIS script's
# location and invokes the same argv shape that the Electron main process uses.
# Loader: Node-native (default) or jiti when PI_DASHBOARD_TS_LOADER=jiti.
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
# See changes: add-bundle-manual-launch-scripts, fix-appimage-cold-boot-latency.
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

# TypeScript loader as file:// URL (forward slashes required):
# native by default, jiti when PI_DASHBOARD_TS_LOADER=jiti.
$useJiti = $env:PI_DASHBOARD_TS_LOADER -ceq 'jiti'
# Unknown non-empty values warn and fall back to native (parity with selectTsLoader).
if ($env:PI_DASHBOARD_TS_LOADER -and -not $useJiti -and $env:PI_DASHBOARD_TS_LOADER -cne 'native') {
  Write-Warning "unknown PI_DASHBOARD_TS_LOADER=`"$($env:PI_DASHBOARD_TS_LOADER)`"; using the native TypeScript loader (valid: native, jiti)."
}
$loaderPath = if ($useJiti) {
  Join-Path $svrDir 'node_modules\jiti\lib\jiti-register.mjs'
} else {
  Join-Path $svrDir 'node_modules\@blackbelt-technology\pi-dashboard-shared\src\platform\native-ts-register.mjs'
}
if (-not (Test-Path $loaderPath)) {
  Write-Error "Bundled TypeScript loader not found at: $loaderPath"
  exit 1
}
$loaderUrl = "file:///" + ($loaderPath -replace '\\','/')

# Entry: jiti's JITI VERSION CONTRACT requires the RAW Windows path; the
# native loader gets a file:// URL so A:/B: drives are not parsed as URL schemes.
$cliPath = Join-Path $svrDir 'packages\server\src\cli.ts'
if (-not (Test-Path $cliPath)) {
  Write-Error "Bundled cli.ts not found at: $cliPath"
  exit 1
}
$cli = if ($useJiti) { $cliPath } else { "file:///" + ($cliPath -replace '\\','/') }

# Default subcommand = "start" when invoked with no args
$childArgs = if ($args.Count -eq 0) { @('start') } else { $args }

Set-Location $svrDir
& $nodeExe --import $loaderUrl $cli @childArgs
$ec = $LASTEXITCODE

Write-Host ""
Write-Host "Server exited with code $ec"
exit $ec
