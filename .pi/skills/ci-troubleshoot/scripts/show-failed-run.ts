/**
 * Show failed steps + log tails for a GitHub Actions run.
 * If no run-id given, picks the most recent failed run.
 *
 * Invoke:
 *   npx tsx ./scripts/show-failed-run.ts                 # most recent failed
 *   npx tsx ./scripts/show-failed-run.ts <run-id>        # specific run
 *   npx tsx ./scripts/show-failed-run.ts <run-id> --full # full log
 *
 * Cross-platform — requires `gh` CLI (cross-platform).
 */
import { spawnSync } from 'node:child_process';

// gh is a .exe on Windows, plain binary on Unix. shell:false avoids DEP0190.
const GH = 'gh';

function ensureGh(): void {
  const which = spawnSync(GH, ['--version'], { stdio: 'ignore', shell: false });
  if (which.status !== 0) {
    console.error('gh CLI not found. Install: https://cli.github.com/');
    process.exit(127);
  }
  const auth = spawnSync(GH, ['auth', 'status'], { stdio: 'ignore', shell: false });
  if (auth.status !== 0) {
    console.error('gh not authenticated. Run: gh auth login');
    process.exit(1);
  }
}

function findLatestFailedRun(): string | undefined {
  const res = spawnSync(
    GH,
    ['run', 'list', '-L', '50', '--json', 'databaseId,conclusion'],
    { encoding: 'utf8', shell: false }
  );
  if (res.status !== 0) return undefined;
  try {
    const rows = JSON.parse(res.stdout) as Array<{
      databaseId: number;
      conclusion: string;
    }>;
    const failed = rows.find((r) => r.conclusion === 'failure');
    return failed ? String(failed.databaseId) : undefined;
  } catch {
    return undefined;
  }
}

ensureGh();

const args = process.argv.slice(2);
let runId = args[0];
const full = args[1] === '--full' || args[0] === '--full';

if (!runId || runId === '--full') {
  const found = findLatestFailedRun();
  if (!found) {
    console.error('no failed runs in last 50');
    process.exit(1);
  }
  runId = found;
  console.log(`→ most recent failed run: ${runId}`);
}

console.log('─── Run summary ──────────────────────────────────');
const view = spawnSync(GH, ['run', 'view', runId], { stdio: 'inherit', shell: false });
if (view.status !== 0) process.exit(view.status ?? 1);

console.log('\n─── Failed steps ─────────────────────────────────');
const logArgs = ['run', 'view', runId, full ? '--log' : '--log-failed'];
const log = spawnSync(GH, logArgs, { stdio: 'inherit', shell: false });
process.exit(log.status ?? 0);
