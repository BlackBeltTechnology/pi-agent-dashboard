/**
 * Run npm test (or a scoped test), tee output to <tmpdir>/pi-test.log,
 * then summarize failures. Implements AGENTS.md "Running Tests" pattern.
 *
 * Invoke:
 *   npx tsx ./scripts/run-tests-triage.ts                       # all tests
 *   npx tsx ./scripts/run-tests-triage.ts packages/server       # one workspace
 *   npx tsx ./scripts/run-tests-triage.ts -t 'my test name'     # by test name
 *
 * After running, the log retains the full output for re-grep:
 *   Linux/macOS:  /tmp/pi-test.log
 *   Windows:      %TEMP%\pi-test.log
 *
 * Cross-platform — npm + npx are cross-platform.
 */
import { spawn } from 'node:child_process';
import { createWriteStream, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LOG = join(tmpdir(), 'pi-test.log');
const FAIL_RX = /FAIL|✗|✘/;

function pickCommand(args: string[]): { cmd: string; cmdArgs: string[]; label: string } {
  if (args.length === 0) {
    return { cmd: 'npm', cmdArgs: ['test'], label: 'npm test' };
  }
  const first = args[0];
  if (first === '-t') {
    const rest = args.slice(1).join(' ');
    return {
      cmd: 'npx',
      cmdArgs: ['vitest', 'run', '-t', rest],
      label: `npx vitest run -t '${rest}'`,
    };
  }
  if (first.startsWith('packages/')) {
    return { cmd: 'npm', cmdArgs: ['test', '-w', first], label: `npm test -w ${first}` };
  }
  return { cmd: 'npx', cmdArgs: ['vitest', 'run', first], label: `npx vitest run ${first}` };
}

function resolveBinary(cmd: string): string {
  // On Windows, npm/npx are .cmd shims; explicit suffix + shell:false avoids DEP0190.
  if (process.platform !== 'win32') return cmd;
  return cmd === 'npm' || cmd === 'npx' ? `${cmd}.cmd` : cmd;
}

const { cmd, cmdArgs, label } = pickCommand(process.argv.slice(2));
console.log(`→ ${label} (output → ${LOG})`);

const logStream = createWriteStream(LOG);
const child = spawn(resolveBinary(cmd), cmdArgs, { shell: false });

child.stdout.on('data', (chunk: Buffer) => {
  process.stdout.write(chunk);
  logStream.write(chunk);
});
child.stderr.on('data', (chunk: Buffer) => {
  process.stderr.write(chunk);
  logStream.write(chunk);
});

const exitCode: number = await new Promise((resolve) => {
  child.on('close', (code) => {
    logStream.end(() => resolve(code ?? 1));
  });
});

console.log('\n─── Failure summary ──────────────────────────────');
try {
  const lines = readFileSync(LOG, 'utf8').split('\n');
  const failures = lines
    .map((line, idx) => ({ line, idx: idx + 1 }))
    .filter(({ line }) => FAIL_RX.test(line))
    .slice(0, 30);

  if (failures.length === 0) {
    console.log('no FAIL markers found');
  } else {
    for (const { idx, line } of failures) {
      console.log(`${idx}: ${line}`);
    }
    console.log('\nFor each FAIL, get context with:');
    console.log(`  grep -n -B 5 -A 30 'FAIL ' ${LOG}     (or read ${LOG} around line numbers above)`);
  }
} catch (err) {
  console.error(`(could not read log: ${(err as Error).message})`);
}

process.exit(exitCode);
