/**
 * Full rebuild after an openspec-apply or multi-component change.
 * Runs: build client → restart server → reload all bridges (in order).
 *
 * Deploys the checked-out dev version to the local running instance. NOT a
 * feature-implementation step — worktree / Docker-isolated work does not run this.
 * For the implementation-phase code-review gate, see review-changes.ts.
 *
 * Invoke:  npx tsx .pi/skills/implement/scripts/full-rebuild.ts
 *
 * Cross-platform — uses npm CLI (npm is cross-platform).
 */
import { spawnSync } from 'node:child_process';
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

async function healthPid(port: number): Promise<number | null> {
  try {
    const r = await fetch(`http://localhost:${port}/api/health`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!r.ok) return null;
    const body = (await r.json()) as { pid?: number };
    return typeof body.pid === 'number' ? body.pid : null;
  } catch {
    return null;
  }
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
const oldPid = await healthPid(port);
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

// Wait for the NEW server (pid change) — reloading against the old/down one
// fails with ECONNREFUSED.
let healthy = false;
for (let i = 1; i <= 60; i++) {
  await sleep(1000);
  const pid = await healthPid(port);
  if (pid !== null && pid !== oldPid) {
    console.log(`✓ server healthy after ${i}s (pid ${pid})`);
    healthy = true;
    break;
  }
}
if (!healthy) {
  console.error('✗ server did not come back within 60s — check ~/.pi/dashboard/server.log');
  process.exit(1);
}

// Bridges reconnect with backoff after a restart; retry while none are back.
console.log('→ 3/3: npm run reload');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
for (let attempt = 1; ; attempt++) {
  const r = spawnSync(npmCmd, ['run', 'reload'], { encoding: 'utf8', shell: false });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const noneYet = out.includes('No connected pi sessions found.');
  if (r.status !== 0 || !noneYet || attempt >= 6) {
    process.stdout.write(out);
    if (r.status !== 0) {
      console.error(`✗ npm run reload failed with exit ${r.status}`);
      process.exit(r.status ?? 1);
    }
    break;
  }
  console.log(`  no sessions reconnected yet — retrying in 5s (${attempt}/5)`);
  await sleep(5000);
}

console.log('✓ full rebuild complete (client built, server restarted, bridges reloaded)');
