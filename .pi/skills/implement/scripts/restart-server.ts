/**
 * Restart the dashboard server via POST /api/restart.
 * Preserves current dev/prod mode unless --dev or --prod is given.
 *
 * Invoke:
 *   npx tsx ./scripts/restart-server.ts             # restart, keep mode
 *   npx tsx ./scripts/restart-server.ts --dev       # restart in dev
 *   npx tsx ./scripts/restart-server.ts --prod      # restart in production
 *
 * Cross-platform — Node built-ins only.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

function getDashboardPort(): number {
  try {
    const cfg = JSON.parse(
      readFileSync(join(homedir(), '.pi', 'dashboard', 'config.json'), 'utf8')
    ) as { port?: number };
    if (typeof cfg.port === 'number') return cfg.port;
  } catch {
    /* default */
  }
  return 8000;
}

const arg = process.argv[2];
let body: string | undefined;
switch (arg) {
  case undefined:
    body = undefined;
    break;
  case '--dev':
    body = JSON.stringify({ dev: true });
    break;
  case '--prod':
    body = JSON.stringify({ dev: false });
    break;
  default:
    console.error(`usage: restart-server.ts [--dev|--prod]`);
    process.exit(2);
}

const port = getDashboardPort();
const url = `http://localhost:${port}/api/restart`;

try {
  const resp = await fetch(url, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body,
    signal: AbortSignal.timeout(5000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
} catch (err) {
  console.error(
    `restart failed (server not reachable on port ${port}?): ${(err as Error).message}`
  );
  process.exit(1);
}

console.log('→ restart accepted, waiting for health...');
for (let i = 1; i <= 10; i++) {
  await sleep(1000);
  try {
    const r = await fetch(`http://localhost:${port}/api/health`, {
      signal: AbortSignal.timeout(1000),
    });
    if (r.ok) {
      console.log(`✓ server healthy after ${i}s`);
      process.exit(0);
    }
  } catch {
    /* keep polling */
  }
}

console.error('⚠ server did not become healthy within 10s — check ~/.pi/dashboard/server.log');
process.exit(1);
