# Test: openspec CLI shim resolves via Git Bash on Windows (T-C1 / test-plan #C1).
# See change: provision-openspec-cli-in-sessions.
#
# The bridge (openspec-cli-shim.ts) provisions bare `openspec` by writing an
# EXTENSIONLESS `#!/bin/sh` shim that `exec`s the pinned bin via an ABSOLUTE node
# path, then prepending the shim dir to PATH. This smoke reproduces that exact
# mechanism and proves the observable on Windows: the bash tool runs through
# `bash.exe -c`, which ignores PATHEXT (so a `.cmd` would never resolve bare
# `openspec`) and needs no `node` on the pre-existing PATH.
$ErrorActionPreference = "Stop"

Write-Host "=== Test: openspec shim resolves via Git Bash (Windows) ==="

# 1. Locate bash.exe (Git for Windows). Skip cleanly if absent.
$bash = (Get-Command bash -ErrorAction SilentlyContinue).Source
if (-not $bash) {
    Write-Host "SKIP: bash.exe (Git for Windows) not on PATH"
    exit 0
}

# 2. Locate node + the pinned openspec bin (installed by `npm install`).
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Write-Host "FAIL: node not found to build the shim"; exit 1 }

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$bin = Join-Path $repoRoot "node_modules/@fission-ai/openspec/bin/openspec.js"
if (-not (Test-Path $bin)) {
    Write-Host "SKIP: pinned openspec bin not installed at $bin (run npm install)"
    exit 0
}

# 3. Reproduce the bridge shim: extensionless #!/bin/sh, absolute node, LF endings.
$shimDir = Join-Path $env:TEMP ("qa-openspec-shim-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $shimDir -Force | Out-Null
try {
    # Git Bash consumes POSIX paths; forward-slash them and keep LF newlines.
    $nodePosix = $node -replace '\\', '/'
    $binPosix = $bin -replace '\\', '/'
    $shim = "#!/bin/sh`nexec `"$nodePosix`" `"$binPosix`" `"`$@`"`n"
    $shimPath = Join-Path $shimDir "openspec"
    [System.IO.File]::WriteAllText($shimPath, ($shim -replace "`r`n", "`n"))

    # 4. Invoke `openspec --version` through bash.exe with a PATH that has NO
    #    `openspec` and NO `node` beyond the shim dir — the shim's absolute node
    #    must carry it. Convert the shim dir to a POSIX path for the bash PATH.
    $shimPosix = ($shimDir -replace '\\', '/') -replace '^([A-Za-z]):', '/$1'
    $out = & $bash -c "export PATH='$shimPosix'; command -v openspec >/dev/null && openspec --version" 2>&1
    $code = $LASTEXITCODE

    if ($code -ne 0) {
        Write-Host "FAIL: shim did not resolve/run via bash.exe (exit $code): $out"
        exit 1
    }
    if ("$out" -notmatch "1\.6\.0") {
        Write-Host "FAIL: expected openspec 1.6.0, got: $out"
        exit 1
    }
    Write-Host "openspec via Git Bash shim: $out"
    Write-Host "PASS: extensionless shim resolves bare openspec on Windows (no node on PATH)"
} finally {
    Remove-Item -Recurse -Force $shimDir -ErrorAction SilentlyContinue
}
