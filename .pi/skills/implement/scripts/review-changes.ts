/**
 * PR-time CodeRabbit ship gate (advisory, OPT-IN).
 *
 * This is the cloud, rate-limited reviewer — reserved for the pull request so its
 * quota is unspent during dev. The dev inner loop uses the `review-code`
 * discipline (eng-disciplines) on an unlimited model engine instead; do NOT call
 * this gate per change.
 *
 * Reviews the CURRENT git working tree's diff — worktree-safe and
 * server-independent (no build, no server restart).
 *
 * Opt in with RUN_CR_REVIEW=1 or --ship:
 *   RUN_CR_REVIEW=1 npx tsx ./scripts/review-changes.ts             # opt in (uncommitted)
 *   npx tsx ./scripts/review-changes.ts --ship -t committed --base main
 *   npx tsx ./scripts/review-changes.ts                            # default: skips → use review-code
 *
 * Always advisory (warn-and-continue, exits 0). CodeRabbit is cloud rate-limited;
 * on missing CLI, auth failure, or usage limit it defers to a later cycle.
 */
import { spawnSync } from 'node:child_process';
import { parseFindings, splitFindings } from './parse-findings.js';

// Opt-in gate: skip unless explicitly requested. Dev inner loop → `review-code`.
const optedIn = process.env.RUN_CR_REVIEW === '1' || process.argv.includes('--ship');
if (!optedIn) {
  console.log('→ review: CodeRabbit gate is opt-in (ship-time). Dev inner loop → `review-code` skill.');
  console.log('   Opt in with:  RUN_CR_REVIEW=1  or  --ship');
  process.exit(0);
}

// Pass through any CodeRabbit flags (e.g. -t committed --base main); default to uncommitted.
const passthrough = process.argv.slice(2).filter((a) => a !== '--ship' && a !== '--no-review');
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
