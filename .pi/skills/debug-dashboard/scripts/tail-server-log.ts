/**
 * Tail the dashboard server log. Default: last 50 lines of the CURRENT run
 * (everything since the most recent "=== [timestamp] ===" banner).
 *
 * Invoke:
 *   npx tsx ./scripts/tail-server-log.ts                # last 50 lines, current run
 *   npx tsx ./scripts/tail-server-log.ts 200            # last 200 lines, current run
 *   npx tsx ./scripts/tail-server-log.ts --all 100      # last 100 lines, entire log
 *   npx tsx ./scripts/tail-server-log.ts --follow       # follow (tail -f)
 *   npx tsx ./scripts/tail-server-log.ts --errors       # only error-like lines, current run
 *
 * Cross-platform — Node built-ins only.
 */
import { createReadStream, readFileSync, statSync, existsSync, watchFile } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const LOG = join(homedir(), '.pi', 'dashboard', 'server.log');
const BANNER = /^=== \[/;
const ERROR_RX = /error|fail|warn|throw|crash|fatal/i;

if (!existsSync(LOG)) {
  console.error(`no log file at ${LOG}`);
  process.exit(1);
}

function readLines(): string[] {
  return readFileSync(LOG, 'utf8').split('\n');
}

function currentRun(lines: string[]): string[] {
  // Find the last banner line; return everything from there.
  let last = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (BANNER.test(lines[i])) {
      last = i;
      break;
    }
  }
  return last === -1 ? lines : lines.slice(last);
}

const args = process.argv.slice(2);
const mode = args[0];

if (mode === '--follow' || mode === '-f') {
  // Print last 20 lines then watch for appends.
  let size = statSync(LOG).size;
  const tail = readLines().slice(-20).join('\n');
  process.stdout.write(tail + '\n');
  watchFile(LOG, { interval: 500 }, (curr) => {
    if (curr.size > size) {
      createReadStream(LOG, { start: size, end: curr.size }).pipe(process.stdout);
      size = curr.size;
    } else if (curr.size < size) {
      // log rotated / truncated
      size = curr.size;
    }
  });
} else if (mode === '--all') {
  const n = Number(args[1] ?? 50) || 50;
  console.log(readLines().slice(-n).join('\n'));
} else if (mode === '--errors') {
  const run = currentRun(readLines());
  const matches = run.filter((l) => ERROR_RX.test(l)).slice(-50);
  if (matches.length === 0) {
    console.log('(no error-like lines in current run)');
  } else {
    console.log(matches.join('\n'));
  }
} else if (!mode || /^\d+$/.test(mode)) {
  const n = Number(mode ?? 50) || 50;
  const run = currentRun(readLines());
  console.log(run.slice(-n).join('\n'));
} else {
  console.error('usage: tail-server-log.ts [--follow] [--all <N>] [--errors] [<lines>]');
  process.exit(2);
}
