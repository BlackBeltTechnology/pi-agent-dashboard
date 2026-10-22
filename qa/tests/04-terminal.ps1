# Test: Terminal (PTY / ConPTY) spawning works (Windows)
$ErrorActionPreference = "Stop"

Write-Host "=== Test: Terminal spawning (ConPTY) ==="

# Ensure server is running
try {
    $response = Invoke-WebRequest -Uri "http://localhost:8000/api/health" -UseBasicParsing -TimeoutSec 3
    if ($response.StatusCode -ne 200) {
        Write-Host "FAIL: Server not running"
        exit 1
    }
} catch {
    Write-Host "FAIL: Server not running ($_)"
    exit 1
}

# Try to create a terminal session via the API
# `pi-dashboard api` mints local proof; a bare request is refused by the strict `requireLocalProof` default.
$body = (@{ cwd = $env:TEMP } | ConvertTo-Json -Compress)
try {
    $null = & pi-dashboard api POST /api/terminals --data ($body -replace '"','\"') 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Terminal API responded OK"
    } else {
        throw "terminal API exit $LASTEXITCODE"
    }
} catch {
    Write-Host "NOTE: Terminal API call failed, falling back to node-pty load check"
}

# Fallback / additional check: verify node-pty loads (links against ConPTY on Windows)
$nodeCheck = @"
try {
  const pty = require('node-pty');
  const p = pty.spawn('powershell.exe', ['-NoLogo', '-Command', 'echo hello-pty'], { cols: 80, rows: 24 });
  let output = '';
  p.onData(d => { output += d; });
  setTimeout(() => {
    if (output.includes('hello-pty')) {
      console.log('node-pty + ConPTY: OK');
      process.exit(0);
    } else {
      console.error('node-pty started but no output received');
      process.exit(1);
    }
  }, 3000);
} catch (e) {
  console.error('node-pty failed:', e.message);
  process.exit(1);
}
"@

$nodeCheck | node -
if ($LASTEXITCODE -ne 0) {
    Write-Host "FAIL: node-pty / ConPTY not working"
    exit 1
}

Write-Host "PASS: Terminal spawning works"
exit 0
