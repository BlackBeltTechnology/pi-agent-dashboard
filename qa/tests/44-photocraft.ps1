# Test: @blackbelt-technology/pi-dashboard-photocraft installs and provisions (Windows x64).
#
# See 44-photocraft.sh for rationale (change: add-photocraft-plugin, test-plan #E36).
# Same checks: bin runs without a TS loader, ensure twice (cacheHit false -> true),
# no desktop executable in the cache, real photocraft-cli runs headless, MCP handshake.
$ErrorActionPreference = "Stop"

Write-Host "=== Test: pi-photocraft install + provisioning smoke ==="

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..\..")
$work = Join-Path $env:TEMP "pi-photocraft-smoke-$(Get-Random)"
New-Item -ItemType Directory -Path $work -Force | Out-Null
try {
    Push-Location $work
    $env:NODE_OPTIONS = ""
    $env:PHOTOCRAFT_HOME = Join-Path $work "photocraft-home"
    Remove-Item Env:PHOTOCRAFT_BIN -ErrorAction SilentlyContinue
    Remove-Item Env:PHOTOCRAFT_VERSION -ErrorAction SilentlyContinue

    '{ "name": "photocraft-smoke", "version": "0.0.0", "private": true, "type": "module" }' | Set-Content -Path package.json -Encoding utf8

    npm install --no-audit --no-fund --silent "@blackbelt-technology/pi-dashboard-photocraft" 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "NOTE: registry install failed (pre-publish?); packing the local workspaces"
        $tgz = @()
        foreach ($pkg in @("nano-banana", "craft-apps", "photocraft")) {
            $dir = Join-Path $repoRoot "packages\$pkg"
            if (-not (Test-Path $dir)) { Write-Host "FAIL: no local workspace $dir"; exit 1 }
            Push-Location $dir
            $name = (npm pack --silent --pack-destination $work | Select-Object -Last 1)
            Pop-Location
            $tgz += (Join-Path $work $name)
        }
        npm install --no-audit --no-fund --silent @tgz
        if ($LASTEXITCODE -ne 0) { Write-Host "FAIL: fallback install failed"; exit 1 }
    }

    $pc = Join-Path $work "node_modules\.bin\pi-photocraft.cmd"
    if (-not (Test-Path $pc)) { Write-Host "FAIL: $pc missing after install"; exit 1 }

    & $pc --help *> $null
    if ($LASTEXITCODE -ne 0) { Write-Host "FAIL: pi-photocraft --help exited $LASTEXITCODE"; exit 1 }
    Write-Host "OK: --help exits 0 (bin runs without a TS loader)"

    $r1 = (& $pc ensure) | ConvertFrom-Json
    $r2 = (& $pc ensure) | ConvertFrom-Json
    if ($r1.cacheHit -ne $false) { Write-Host "FAIL: first ensure cacheHit=$($r1.cacheHit)"; exit 1 }
    if ($r2.cacheHit -ne $true) { Write-Host "FAIL: second ensure cacheHit=$($r2.cacheHit)"; exit 1 }
    Write-Host "OK: ensure cacheHit false -> true (version $($r1.version), asset $($r1.asset))"

    $desktop = Get-ChildItem -Path $env:PHOTOCRAFT_HOME -Recurse -Filter "photocraft.exe" -ErrorAction SilentlyContinue
    if ($desktop) { Write-Host "FAIL: desktop executable present: $($desktop[0].FullName)"; exit 1 }
    Write-Host "OK: no desktop executable in the cache"

    $version = (& $pc exec --version) -join ""
    if (-not $version.StartsWith("photocraft-cli ")) { Write-Host "FAIL: unexpected --version output: $version"; exit 1 }
    Write-Host "OK: exec --version -> $version"

    & $pc exec run --new '{"width":64,"height":64}' --out (Join-Path $work "x.png") | Out-Null
    if (-not (Test-Path (Join-Path $work "x.png"))) { Write-Host "FAIL: exec run did not write x.png"; exit 1 }
    Write-Host "OK: exec run --new wrote x.png"

    $mcpIn = @(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"qa","version":"1"}}}',
        '{"jsonrpc":"2.0","method":"notifications/initialized"}',
        '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
    ) -join "`n"
    $mcpOut = $mcpIn | & $pc mcp --root $work 2>$null
    $msgs = $mcpOut | Where-Object { $_ } | ForEach-Object { $_ | ConvertFrom-Json }
    $init = $msgs | Where-Object { $_.id -eq 1 }
    $list = $msgs | Where-Object { $_.id -eq 2 }
    if (-not $init -or $init.result.serverInfo.name -ne "photocraft") { Write-Host "FAIL: bad initialize result"; exit 1 }
    $names = $list.result.tools | ForEach-Object { $_.name }
    if (($names -notcontains "doc_open") -or ($names -notcontains "command_run")) { Write-Host "FAIL: tool list $($names -join ',')"; exit 1 }
    Write-Host "OK: MCP handshake + $($names.Count) tools"

    Write-Host "PASS: pi-photocraft installs and provisions on this platform"
}
finally {
    Pop-Location
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $work
}
