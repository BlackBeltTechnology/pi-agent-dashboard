# Test: the agent credential guard blocks the REAL Windows forms of the vault path (E64)
#
# The L1 suites drive win32 forms through an injected flavour on POSIX CI; this
# runs the shipped guard natively on a Windows host, where `realpath`, drive-letter
# case and `\` handling are the platform's own. Two probes through the guard handler
# (the same `tool_call` handler the bridge installs):
#   - `read C:\Users\<user>\.pi\dashboard\vault.json`
#   - bash `type C:\Users\<user>\.pi\dashboard\vault.json`
# Each MUST come back `block: true` with a `credential_guard` reason, and an
# unrelated file MUST pass. Then the native guard suites run.
#
# Scope note: this drives the guard handler directly, not a faux-model bridged
# session. The bridged form needs the faux scenario `tool-read-credentials`
# (test-plan "New infra"; added with task F5) - when it lands, extend this
# script with a `pi` session driven through it and assert 0 gate prompts.
#
# Needs a repo checkout with deps installed (the shipped package excludes tests).
# Exit 77 = precondition not met (no checkout / no tsx) - loud SKIP, not FAIL.
#
# See change: encrypt-credentials-at-rest (test-plan E64).
$ErrorActionPreference = "Stop"

Write-Host "=== Test: credential guard on win32 paths ==="

$repo = $env:PI_DASHBOARD_REPO
if (-not $repo) { $repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path }
if (-not (Test-Path (Join-Path $repo "packages\extension\src\credential-guard.ts"))) {
    Write-Host "SKIP: no repo checkout with packages/extension/src/credential-guard.ts at $repo (set PI_DASHBOARD_REPO)"
    exit 77
}
if (-not (Test-Path (Join-Path $repo "node_modules\tsx"))) {
    Write-Host "SKIP: tsx not installed under $repo (run pnpm install)"
    exit 77
}

$probe = Join-Path $repo "packages\extension\qa-credential-guard-probe.mts"
@'
import os from "node:os";
import path from "node:path";
import { createCredentialGuard } from "./src/credential-guard.ts";

const home = os.homedir();
const vault = path.join(home, ".pi", "dashboard", "vault.json");
const logs: string[] = [];
const guard = createCredentialGuard({ env: {}, homedir: home, log: (l: string) => logs.push(l) });
const run = (toolName: string, input: unknown) =>
  guard.handler({ toolName, toolCallId: "qa", input }, { cwd: home, hasUI: true }) as { block?: boolean; reason?: string } | undefined;

const failures: string[] = [];
for (const [name, tool, input] of [
  ["read", "read", { path: vault }],
  ["read (forward slashes)", "read", { path: vault.replaceAll("\\", "/") }],
  ["read (lower-case drive)", "read", { path: vault.charAt(0).toLowerCase() + vault.slice(1) }],
  ["bash type", "bash", { command: `type ${vault}` }],
] as const) {
  const r = run(tool, input);
  if (!r?.block || !/credential_guard/.test(r.reason ?? "")) failures.push(`${name}: not blocked (${JSON.stringify(r)})`);
}
const ok = run("read", { path: path.join(home, ".pi", "agent", "settings.json") });
if (ok?.block) failures.push("settings.json was blocked (false positive)");
if (logs.some((l) => l.includes(vault))) failures.push("a log line carries the path");
if (failures.length > 0) { console.error(failures.join("\n")); process.exit(1); }
console.log("guard blocked 4/4 vault forms and passed settings.json");
'@ | Set-Content -Path $probe -Encoding utf8

$failed = $false
try {
    Push-Location (Join-Path $repo "packages\extension")
    try {
        & npx tsx $probe
        if ($LASTEXITCODE -ne 0) { $failed = $true; Write-Host "FAIL: the guard did not block the Windows vault path forms" }
    } finally { Pop-Location }
} finally { Remove-Item -Force -ErrorAction SilentlyContinue $probe }

# Ephemeral HOME: the suites refuse to run against the real user home.
$env:HOME = Join-Path $env:TEMP ("pi-test-" + [guid]::NewGuid().ToString("N"))
$env:USERPROFILE = $env:HOME
New-Item -ItemType Directory -Path $env:HOME -Force | Out-Null
Push-Location (Join-Path $repo "packages\extension")
try {
    & npx vitest run src/__tests__/credential-guard.test.ts src/__tests__/credential-guard-wiring.test.ts
    if ($LASTEXITCODE -ne 0) { $failed = $true; Write-Host "FAIL: credential-guard suites" }
} finally { Pop-Location }

if ($failed) { exit 1 }
Write-Host "PASS: credential guard blocks the native Windows vault path forms"
exit 0
