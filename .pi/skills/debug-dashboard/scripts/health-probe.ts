/**
 * Probe the dashboard /api/health endpoint and print mode + uptime + version.
 * Prints "not-running" + tail of server.log if no response.
 *
 * mode/uptime/version come from `/api/health` (server-computed, REST-only —
 * a Tier-3 non-goal). The live `activeSessions` count is read from the WS
 * subscription snapshot via the bus client, so it is bus-consistent with what
 * the web client sees. See OpenSpec change: add-dashboard-bus-client-scripting.
 *
 * Invoke:
 *   npx tsx ./scripts/health-probe.ts          # human-readable summary
 *   npx tsx ./scripts/health-probe.ts --json   # raw JSON
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BusClient } from '@blackbelt-technology/pi-dashboard-bus-client';

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

function tailLog(logPath: string, n: number): string[] {
  try {
    const lines = readFileSync(logPath, 'utf8').split('\n');
    return lines.slice(-n);
  } catch {
    return [];
  }
}

const port = getDashboardPort();
const json = process.argv[2] === '--json';

let data: Record<string, unknown> | undefined;
try {
  const resp = await fetch(`http://localhost:${port}/api/health`, {
    signal: AbortSignal.timeout(2000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  data = (await resp.json()) as Record<string, unknown>;
} catch {
  console.log(`not-running (no response on port ${port})`);
  const logPath = join(homedir(), '.pi', 'dashboard', 'server.log');
  const tail = tailLog(logPath, 10);
  if (tail.length) {
    console.log('  tail of server.log:');
    for (const line of tail) console.log(`    ${line}`);
  }
  process.exit(1);
}

if (json) {
  console.log(JSON.stringify(data, null, 2));
  process.exit(0);
}

// Live active-session count from the WS subscription snapshot (bus-consistent).
let snapshotActive: number | undefined;
{
  const bus = new BusClient();
  try {
    await bus.connect();
    snapshotActive = bus.read.sessions().filter((s) => s.status !== 'ended').length;
  } catch {
    /* fall back to the /api/health figure below */
  } finally {
    bus.close();
  }
}

const server = (data.server ?? {}) as Record<string, unknown>;
const proxy = (data.proxy ?? {}) as Record<string, unknown>;
const agents = Array.isArray(data.agents) ? (data.agents as unknown[]) : [];
const plugins = Array.isArray(data.plugins) ? (data.plugins as Array<{ enabled?: boolean }>) : [];

const uptimeSec = Number(data.uptime ?? 0);
const uptimeFmt =
  uptimeSec > 3600
    ? `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m`
    : `${uptimeSec}s`;

const fields: Array<[string, string]> = [
  ['port', String(port)],
  ['mode', String(data.mode ?? '?')],
  ['ok', String(data.ok ?? '?')],
  ['version', String(data.version ?? '?')],
  ['launchSource', String(data.launchSource ?? '?')],
  ['uptime', uptimeFmt],
  ['pid', String(data.pid ?? '?')],
  ['activeSessions', String(snapshotActive ?? server.activeSessions ?? agents.length ?? '?')],
  ['plugins', `${plugins.filter((p) => p.enabled).length} enabled / ${plugins.length} total`],
  ['proxy', String(proxy.status ?? '?')],
];
for (const [k, v] of fields) console.log(`${k.padEnd(16)} ${v}`);
if (data.restartRequired) console.log('⚠ restart required');
