/**
 * Implementation-phase code-review gate (advisory CodeRabbit review).
 *
 * Reviews the CURRENT git working tree's diff — worktree-safe and
 * server-independent. No build, no server restart: works in a git worktree and
 * alongside the Docker-isolated instance during feature implementation. Run this
 * at implementation completion, before commit.
 *
 * Invoke:  npx tsx ./scripts/review-changes.ts                    # uncommitted (default)
 *          npx tsx ./scripts/review-changes.ts -t committed --base main
 *          SKIP_CR_REVIEW=1 npx tsx ./scripts/review-changes.ts   # skip the gate
 *
 * Always advisory (warn-and-continue, exits 0). CodeRabbit is cloud rate-limited;
 * on missing CLI, auth failure, or usage limit it defers to a later cycle.
 */
import { spawnSync } from 'node:child_process';
import { parseFindings, splitFindings } from './parse-findings';

if (process.env.SKIP_CR_REVIEW === '1' || process.argv.includes('--no-review')) {
  console.log('→ review: skipped (--no-review / SKIP_CR_REVIEW)');
  process.exit(0);
}

// Pass through any CodeRabbit flags (e.g. -t committed --base main); default to uncommitted.
const passthrough = process.argv.slice(2).filter((a) => a !== '--no-review');
const scope = passthrough.length ? passthrough : ['-t', 'uncommitted'];
const cli = process.platform === 'win32' ? 'coderabbit.cmd' : 'coderabbit';

console.log(`→ review: CodeRabbit (advisory) ${scope.join(' ')}…`);
const res = spawnSync(cli, ['review', '--agent', ...scope], {
  encoding: 'utf8',
  shell: false,
  maxBuffer: 64 * 1024 * 1024,
});

if (res.error || res.status !== 0) {
  // ENOENT (not installed), auth, or rate/usage limit — advisory only, never block.
  const msg = res.error?.message ?? res.stderr?.trim() ?? `exit ${res.status}`;
  console.warn(`⚠ CodeRabbit review unavailable (${msg}). Deferred to a later cycle.`);
  process.exit(0);
}

const { all: findings, mustFix } = splitFindings(parseFindings(res.stdout ?? ''));

if (findings.length === 0) {
  console.log('✓ review: no findings');
  process.exit(0);
}

console.log(`→ review: ${findings.length} finding(s), ${mustFix.length} Critical/Warning`);
for (const f of mustFix) {
  const summary = f.codegenInstructions ?? f.comment ?? '';
  console.log(`   • [${f.severity}] ${summary.split('\n')[0].slice(0, 120)}`);
}
if (mustFix.length > 0) {
  console.warn(
    `⚠ ${mustFix.length} Critical/Warning finding(s) — fix before committing (advisory, not blocking).`
  );
}
process.exit(0);
