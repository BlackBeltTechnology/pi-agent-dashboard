/**
 * List recent GitHub Actions runs for this repo.
 * Wraps `gh run list` with sensible defaults and filters.
 *
 * Invoke:
 *   npx tsx ./scripts/list-recent-runs.ts                       # last 10 runs
 *   npx tsx ./scripts/list-recent-runs.ts --failed              # last 10 failed
 *   npx tsx ./scripts/list-recent-runs.ts --workflow publish.yml
 *   npx tsx ./scripts/list-recent-runs.ts -L 30                 # last 30
 *
 * Cross-platform — requires `gh` CLI (cross-platform).
 */
import { spawnSync } from 'node:child_process';

// gh is a .exe on Windows, plain binary on Unix — no .cmd suffix needed.
// Use shell:false to avoid Node DEP0190.
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

function parseArgs(argv: string[]): {
  limit: number;
  onlyFailed: boolean;
  workflow?: string;
} {
  let limit = 10;
  let onlyFailed = false;
  let workflow: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--failed') onlyFailed = true;
    else if (a === '--workflow') workflow = argv[++i];
    else if (a === '-L') limit = Number(argv[++i]) || 10;
    else {
      console.error(`unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return { limit, onlyFailed, workflow };
}

ensureGh();
const { limit, onlyFailed, workflow } = parseArgs(process.argv.slice(2));

const args = ['run', 'list', '-L', String(limit)];
if (workflow) args.push('--workflow', workflow);

const res = spawnSync(GH, args, { encoding: 'utf8', shell: false });
if (res.status !== 0) {
  if (res.stderr) process.stderr.write(res.stderr);
  process.exit(res.status ?? 1);
}

const out = res.stdout;
if (!onlyFailed) {
  process.stdout.write(out);
  process.exit(0);
}

// Filter to failure rows. `gh run list` tabular output uses status in col 1.
const lines = out.split('\n');
const filtered = lines.filter((line, idx) => {
  if (idx === 0) return true; // header
  return /^(failure|cancelled|timed_out)\b/.test(line);
});
process.stdout.write(filtered.join('\n'));
