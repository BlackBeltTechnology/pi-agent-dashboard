/**
 * Re-run failed jobs of a GitHub Actions run. Preserves successful jobs
 * (saves CI time vs full re-run).
 *
 * Invoke:
 *   npx tsx ./scripts/retrigger-failed.ts <run-id>          # re-run failed jobs
 *   npx tsx ./scripts/retrigger-failed.ts <run-id> --all    # re-run entire workflow
 *   npx tsx ./scripts/retrigger-failed.ts                   # latest failed run, --failed mode
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
let mode = args[1] ?? '--failed';

// If first arg is a mode flag, no run id given.
if (runId === '--failed' || runId === '--all') {
  mode = runId;
  runId = '';
}

if (!runId) {
  const found = findLatestFailedRun();
  if (!found) {
    console.error('no failed runs in last 50');
    process.exit(1);
  }
  runId = found;
  console.log(`→ most recent failed run: ${runId}`);
}

let cmdArgs: string[];
if (mode === '--failed') {
  console.log(`→ re-running failed jobs only: gh run rerun ${runId} --failed`);
  cmdArgs = ['run', 'rerun', runId, '--failed'];
} else if (mode === '--all') {
  console.log(`→ re-running ENTIRE workflow: gh run rerun ${runId}`);
  cmdArgs = ['run', 'rerun', runId];
} else {
  console.error(`usage: retrigger-failed.ts [<run-id>] [--failed|--all]`);
  process.exit(2);
}

const res = spawnSync(GH, cmdArgs, { stdio: 'inherit', shell: false });
if (res.status !== 0) process.exit(res.status ?? 1);

console.log(`\n→ watch live: gh run watch ${runId}`);
