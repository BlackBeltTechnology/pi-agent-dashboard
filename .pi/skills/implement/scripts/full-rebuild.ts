/**
 * Full rebuild after an openspec-apply or multi-component change.
 * Runs: build client → restart server → reload all bridges (in order).
 *
 * Invoke:  npx tsx ./scripts/full-rebuild.ts
 *
 * Cross-platform — uses npm CLI (npm is cross-platform).
 */
import { spawnSync } from 'node:child_process';
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
    /* default */
  }
  return 8000;
}

function runNpm(args: string[]): void {
  // On Windows, npm is npm.cmd; explicit suffix + shell:false avoids DEP0190.
  const cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: false });
  if (result.status !== 0) {
    console.error(`✗ npm ${args.join(' ')} failed with exit ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

const port = getDashboardPort();

console.log('→ 1/3: npm run build');
runNpm(['run', 'build']);

console.log('→ 2/3: restart server');
try {
  const resp = await fetch(`http://localhost:${port}/api/restart`, {
    method: 'POST',
    signal: AbortSignal.timeout(5000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
} catch (err) {
  console.error(
    `✗ restart failed (server not reachable on port ${port}?): ${(err as Error).message}`
  );
  process.exit(1);
}

console.log('→ 3/3: npm run reload');
runNpm(['run', 'reload']);

console.log('✓ full rebuild complete (client built, server restarted, bridges reloaded)');
