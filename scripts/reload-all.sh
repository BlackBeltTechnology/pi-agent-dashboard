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
  # The host the server binds: the dial below is an address LITERAL derived from it.
  BIND_HOST=$(node -e "try{console.log(require('$CONFIG_FILE').bindHost||'')}catch{console.log('')}" 2>/dev/null)
else
  PORT="$DEFAULT_PORT"
  DEV_BUILD="false"
  BIND_HOST=""
fi

# Step 1: Optional type-check
if $CHECK; then
  echo "=== Type-checking bridge ==="
  node scripts/tsc7.mjs --noEmit
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

PI_RELOAD_BIND_HOST="$BIND_HOST" node --input-type=module -e "
import WebSocket from 'ws';

const port = ${PORT};
// Prove we are on this host: required when `requireLocalProof` is on.
// A per-request PROOF of the local token, bound to the address literal dialled,
// the method and the request target; the raw token is never sent.
// See changes: harden-trust-and-credential-boundaries, loopback-credential-proof.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHmac, randomBytes } from 'node:crypto';
let localToken = '';
try { localToken = readFileSync(join(homedir(), '.pi', 'dashboard', 'local', 'token'), 'utf-8').trim(); } catch {}
// --- local credential proof mint (byte-identical to shared mintProof; guarded by scripts/__tests__/reload-all-mint.test.mjs) ---
function mintProofHeader(token, binding, purpose, now, nonce) {
  const key = createHmac('sha256', Buffer.from(token.trim(), 'utf8')).update('pi-dashboard/local-credential-proof/v1').digest();
  const ts = String(now).padStart(13, '0');
  const mac = createHmac('sha256', key).update('pi-lcp/v1/client\n' + binding + '\n' + ts + '\n' + nonce + '\n' + purpose).digest('base64url');
  return 'v1.' + ts + '.' + nonce + '.' + mac;
}
// --- end local credential proof mint ---
function proofHeaders(method, urlStr) {
  if (!localToken) return {};
  const u = new URL(urlStr);
  const binding = u.hostname + ':' + (u.port || '80');
  const purpose = 'http ' + method.toUpperCase() + ' ' + u.pathname + u.search;
  return { 'X-Pi-Local-Proof': mintProofHeader(localToken, binding, purpose, Date.now(), randomBytes(16).toString('base64url')) };
}
// Dial the literal the server's bind maps to, never 'localhost'.
const bindHost = process.env.PI_RELOAD_BIND_HOST || '';
const dialHost = (bindHost === '' || bindHost === '0.0.0.0' || bindHost === '::' || bindHost === '[::]' || bindHost === 'localhost') ? '127.0.0.1'
  : (bindHost === '::1' || bindHost === '[::1]') ? '[::1]'
  : (bindHost.includes(':') && !bindHost.startsWith('[')) ? '[' + bindHost + ']' : bindHost;
const wsUrl = 'ws://' + dialHost + ':' + port + '/ws';
const ws = new WebSocket(wsUrl, { headers: proofHeaders('GET', wsUrl) });

ws.on('error', (err) => {
  console.error('Cannot connect to dashboard server on port ' + port + ':', err.message);
  process.exit(1);
});

ws.on('open', () => {
  // Request session list via REST, then reload each
  const sessionsUrl = 'http://' + dialHost + ':' + port + '/api/sessions';
  fetch(sessionsUrl, { headers: proofHeaders('GET', sessionsUrl) })
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
