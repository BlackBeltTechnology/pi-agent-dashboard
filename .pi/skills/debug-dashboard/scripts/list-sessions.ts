/**
 * List pi sessions from the dashboard's WebSocket subscription snapshot.
 * Default: only non-ended sessions (active ones).
 * Shows id (truncated), status, model, cwd.
 *
 * Reads the SAME `sessions_snapshot` the web client subscribes to (via
 * `@blackbelt-technology/pi-dashboard-bus-client`), so the list is bus-consistent
 * — no separate REST fetch that could race a stale read.
 * See OpenSpec change: add-dashboard-bus-client-scripting.
 *
 * Invoke:
 *   npx tsx ./scripts/list-sessions.ts            # active sessions (table)
 *   npx tsx ./scripts/list-sessions.ts --all      # include ended sessions
 *   npx tsx ./scripts/list-sessions.ts --json     # snapshot sessions as JSON
 *   npx tsx ./scripts/list-sessions.ts --count    # active count only
 */
import { BusClient } from '@blackbelt-technology/pi-dashboard-bus-client';
import type { DashboardSession } from '@blackbelt-technology/pi-dashboard-shared/types.js';

function formatTable(rows: string[][]): string {
  if (rows.length === 0) return '(empty)';
  const widths = rows[0].map((_, col) =>
    Math.max(...rows.map((r) => (r[col] ?? '').length))
  );
  return rows
    .map((r) => r.map((cell, i) => (cell ?? '').padEnd(widths[i])).join('  '))
    .join('\n');
}

const mode = process.argv[2];
const includeEnded = mode === '--all' || mode === '--json';

const client = new BusClient();
let allSessions: DashboardSession[];
try {
  await client.connect();
  allSessions = client.read.sessions();
} catch (err) {
  console.error(`not-running (bus connect failed): ${(err as Error).message}`);
  process.exit(1);
} finally {
  client.close();
}

const sessions = includeEnded
  ? allSessions
  : allSessions.filter((s) => s.status !== 'ended');

if (mode === '--json') {
  console.log(JSON.stringify(sessions, null, 2));
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
