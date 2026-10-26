# L2 (Windows): the credential data key in Windows Credential Manager (E92).
#
# An INTERACTIVE user session (Credential Manager needs the user's logon session; a
# service or SYSTEM context is a different test): start the server with a plaintext
# vault, then
#   - `cmdkey /list` shows the target `data-key-v1.pi-dashboard-credential-key`
#     (CI spike C10; the Windows target is `<username>.<service>`, not the service alone)
#   - vault.json is an envelope (`pi-dashboard-encrypted:v1`), the plaintext marker is gone
#   - after a restart the vault still decodes (the account is still listed)
# Isolation: a temp USERPROFILE/HOME for the vault and a non-8000 port. The Credential
# Manager entry is real (it is the point) and is deleted at the end with `cmdkey /delete`.
#
# Exit 77 = precondition not met (non-interactive session, no launcher) - loud SKIP.
# Override the launcher with PI_DASHBOARD_CMD (default `pi-dashboard`).
#
# See change: encrypt-credentials-at-rest (test-plan E92; spike C9-C11).
$ErrorActionPreference = "Stop"

Write-Host "=== Test: Windows Credential Manager data key ==="

# PI_QA_ALLOW_NONINTERACTIVE=1: a service-hosted runner whose account still has a Credential Manager
# (GitHub windows-latest as runneradmin: CI spike C9 round-tripped there). Opt-in only.
if (-not [Environment]::UserInteractive -and $env:PI_QA_ALLOW_NONINTERACTIVE -ne "1") {
    Write-Host "SKIP: non-interactive session (Credential Manager needs the user's logon session)"
    exit 77
}
$launcher = if ($env:PI_DASHBOARD_CMD) { $env:PI_DASHBOARD_CMD } else { "pi-dashboard" }
if (-not (Get-Command $launcher -ErrorAction SilentlyContinue)) {
    Write-Host "SKIP: $launcher not on PATH"
    exit 77
}

$port = if ($env:QA_PORT) { $env:QA_PORT } else { "18341" }
$piPort = if ($env:QA_PI_PORT) { $env:QA_PI_PORT } else { "19341" }
$service = "pi-dashboard-credential-key"
$target = "data-key-v1.$service"
$work = Join-Path $env:TEMP ("pi-qa-keychain-" + [guid]::NewGuid().ToString("N"))
$qaHome = Join-Path $work "home"
$vault = Join-Path $qaHome ".pi\dashboard\vault.json"
$realHome = $env:USERPROFILE

function Stop-Dash { $env:HOME = $qaHome; $env:USERPROFILE = $qaHome; & $launcher stop 2>$null | Out-Null }
function Wait-Health([int]$seconds) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        try { if ((Invoke-WebRequest -Uri "http://localhost:$port/api/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { return $true } } catch { }
        Start-Sleep -Seconds 1
    }
    return $false
}
function Start-Dash {
    $env:HOME = $qaHome; $env:USERPROFILE = $qaHome
    & $launcher start --port $port --pi-port $piPort --no-tunnel 2>&1 | ForEach-Object { Write-Host "    start: $_" }
}
function Show-ServerLog {
    $log = Join-Path $qaHome ".pi\dashboard\server.log"
    if (Test-Path $log) { Write-Host "--- server.log (tail)"; Get-Content $log -Tail 40 | ForEach-Object { Write-Host "    $_" } }
    else { Write-Host "--- no server.log at $log" }
}

try {
    New-Item -ItemType Directory -Path (Split-Path $vault) -Force | Out-Null
    '{"accounts":[{"id":"qa1","provider":"gemini","kind":"key","namespace":"user","label":"qa-label","value":"qa-plain-value-0001"}]}' |
        Set-Content -Path $vault -Encoding ascii -NoNewline

    Start-Dash
    if (-not (Wait-Health 120)) { Show-ServerLog; Write-Host "FAIL: health never answered"; exit 1 }
    Start-Sleep -Seconds 2

    $list = (& cmdkey /list 2>&1 | Out-String)
    if ($list -notmatch [regex]::Escape($target)) { Write-Host "FAIL: cmdkey /list shows no '$target'"; exit 1 }
    $first = (Get-Content -Path $vault -TotalCount 1)
    if ($first -ne "pi-dashboard-encrypted:v1") { Write-Host "FAIL: vault.json first line is '$first', expected 'pi-dashboard-encrypted:v1'"; exit 1 }
    if ((Get-Content -Path $vault -Raw) -match "qa-plain-value-0001") { Write-Host "FAIL: the plaintext marker is still readable in vault.json"; exit 1 }
    Write-Host "OK: Credential Manager target present; vault.json is an envelope"

    Stop-Dash
    Start-Sleep -Seconds 2
    Start-Dash
    if (-not (Wait-Health 120)) { Show-ServerLog; Write-Host "FAIL: health never answered after the restart"; exit 1 }
    $env:HOME = $qaHome; $env:USERPROFILE = $qaHome
    $body = (& $launcher api GET /api/vault --port $port 2>&1 | Out-String)
    if ($body -notmatch "qa-label") { Write-Host "FAIL: the vault does not decode after the restart: $body"; exit 1 }
    Write-Host "PASS: Windows Credential Manager holds the data key; the vault decodes after a restart"
    exit 0
} finally {
    Stop-Dash
    & cmdkey /delete:$target 2>$null | Out-Null
    $env:USERPROFILE = $realHome
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $work
}
