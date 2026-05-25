/**
 * Print the current dashboard server mode ("dev" or "production"),
 * or "not-running" if the server isn't reachable.
 *
 * Invoke:  npx tsx ./scripts/check-mode.ts
 *
 * Cross-platform — Node built-ins only.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function getDashboardPort(): number {
  try {
    const cfg = JSON.parse(
      readFileSync(join(homedir(), '.pi', 'dashboard', 'config.json'), 'utf8')
    ) as { port?: number };
    if (typeof cfg.port === 'number') return cfg.port;
  } catch {
    /* fall through to default */
  }
  return 8000;
}

const port = getDashboardPort();

try {
  const resp = await fetch(`http://localhost:${port}/api/health`, {
    signal: AbortSignal.timeout(2000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = (await resp.json()) as { mode?: string };
  console.log(data.mode ?? 'unknown');
} catch {
  console.log(`not-running (no response on port ${port})`);
  process.exit(1);
}
