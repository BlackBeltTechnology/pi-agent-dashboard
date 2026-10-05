#!/usr/bin/env bash
# Build the bridge extension and send /reload to all connected pi sessions.
#
# Usage: ./scripts/reload-all.sh [--skip-build]

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

CONFIG_FILE="$HOME/.pi/dashboard/config.json"
DEFAULT_PORT=8000

CHECK=false
for arg in "$@"; do
  case "$arg" in
    --check) CHECK=true ;;
    -h|--help)
      echo "Usage: $0 [--check]"
      echo "  --check  Run TypeScript type-check before reloading"
      exit 0
      ;;
    *) echo "Unknown option: $arg"; exit 1 ;;
  esac
done

# Read port and devBuildOnReload from config
if command -v node &>/dev/null && [ -f "$CONFIG_FILE" ]; then
  PORT=$(node -e "try{console.log(require('$CONFIG_FILE').port||$DEFAULT_PORT)}catch{console.log($DEFAULT_PORT)}" 2>/dev/null)
  DEV_BUILD=$(node -e "try{console.log(require('$CONFIG_FILE').devBuildOnReload?'true':'false')}catch{console.log('false')}" 2>/dev/null)
else
  PORT="$DEFAULT_PORT"
  DEV_BUILD="false"
fi

# Step 1: Optional type-check
if $CHECK; then
  echo "=== Type-checking bridge ==="
  npx tsc --noEmit
  echo "✓ Type-check passed"
fi

# Step 2: Build client if devBuildOnReload is enabled
if [ "$DEV_BUILD" = "true" ]; then
  echo "=== Building web client ==="
  npm run build
  echo "✓ Client built"
fi

# Step 3: Get connected sessions and send /reload via dashboard API
echo "=== Reloading all pi sessions ==="

node --input-type=module -e "
import WebSocket from 'ws';

const port = ${PORT};
// Prove we are on this host: required when `requireLocalProof` is on.
// See change: harden-trust-and-credential-boundaries.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
let localToken = '';
try { localToken = readFileSync(join(homedir(), '.pi', 'dashboard', 'local', 'token'), 'utf-8').trim(); } catch {}
const authHeaders = localToken ? { 'x-pi-local-token': localToken } : {};
const ws = new WebSocket('ws://localhost:' + port + '/ws', { headers: authHeaders });

ws.on('error', (err) => {
  console.error('Cannot connect to dashboard server on port ' + port + ':', err.message);
  process.exit(1);
});

ws.on('open', () => {
  // Request session list via REST, then reload each
  fetch('http://localhost:' + port + '/api/sessions', { headers: authHeaders })
    .then(r => r.json())
    .then(res => {
      const sessions = res.data || [];
      const active = sessions.filter(s => s.status && s.status !== 'ended');

      if (active.length === 0) {
        console.log('No connected pi sessions found.');
        ws.close();
        return;
      }

      console.log('Found ' + active.length + ' connected session(s):');
      for (const s of active) {
        const name = s.name || s.id.slice(0, 8);
        console.log('  → Reloading: ' + name + ' (' + s.id + ')');
        ws.send(JSON.stringify({
          type: 'send_prompt',
          sessionId: s.id,
          text: '/reload',
        }));
      }

      // Give time for messages to send
      setTimeout(() => {
        console.log('✓ Reload sent to all sessions');
        ws.close();
      }, 500);
    })
    .catch(err => {
      console.error('Failed to fetch sessions:', err.message);
      ws.close();
      process.exit(1);
    });
});
"
