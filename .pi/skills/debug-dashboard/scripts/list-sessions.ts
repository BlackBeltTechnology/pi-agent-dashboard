/**
 * List pi sessions via /api/sessions.
 * Default: only non-ended sessions (active ones).
 * Shows id (truncated), status, model, cwd.
 *
 * Invoke:
 *   npx tsx ./scripts/list-sessions.ts            # active sessions (table)
 *   npx tsx ./scripts/list-sessions.ts --all      # include ended sessions
 *   npx tsx ./scripts/list-sessions.ts --json     # raw JSON envelope
 *   npx tsx ./scripts/list-sessions.ts --count    # active count only
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
    /* default */
  }
  return 8000;
}

interface SessionLike {
  id?: string;
  status?: string;
  model?: string;
  cwd?: string;
}

interface SessionsEnvelope {
  success?: boolean;
  data?: SessionLike[];
}

function formatTable(rows: string[][]): string {
  if (rows.length === 0) return '(empty)';
  const widths = rows[0].map((_, col) =>
    Math.max(...rows.map((r) => (r[col] ?? '').length))
  );
  return rows
    .map((r) => r.map((cell, i) => (cell ?? '').padEnd(widths[i])).join('  '))
    .join('\n');
}

const port = getDashboardPort();
const mode = process.argv[2];
const includeEnded = mode === '--all' || mode === '--json';

let allSessions: SessionLike[];
let raw: unknown;
try {
  const resp = await fetch(`http://localhost:${port}/api/sessions`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  raw = await resp.json();
  // Server wraps in { success, data: [...] }; tolerate bare array too.
  if (Array.isArray(raw)) {
    allSessions = raw as SessionLike[];
  } else {
    allSessions = (raw as SessionsEnvelope).data ?? [];
  }
} catch (err) {
  console.error(`not-running (no response on port ${port}): ${(err as Error).message}`);
  process.exit(1);
}

const sessions = includeEnded
  ? allSessions
  : allSessions.filter((s) => s.status !== 'ended');

if (mode === '--json') {
  console.log(JSON.stringify(raw, null, 2));
} else if (mode === '--count') {
  console.log(sessions.length);
} else if (!mode || mode === '--all') {
  if (sessions.length === 0) {
    console.log(includeEnded ? '(no sessions)' : '(no active sessions; use --all to show ended)');
  } else {
    const header = ['ID', 'STATUS', 'MODEL', 'CWD'];
    const sep = header.map((h) => '─'.repeat(Math.max(h.length, 4)));
    const body = sessions.map((s) => [
      (s.id ?? '?').slice(0, 8),
      s.status ?? '?',
      s.model ?? '?',
      s.cwd ?? '?',
    ]);
    console.log(formatTable([header, sep, ...body]));
    if (!includeEnded) {
      const endedCount = allSessions.length - sessions.length;
      if (endedCount > 0) {
        console.log(`\n(${endedCount} ended sessions hidden; use --all to show)`);
      }
    }
  }
} else {
  console.error('usage: list-sessions.ts [--all|--json|--count]');
  process.exit(2);
}
