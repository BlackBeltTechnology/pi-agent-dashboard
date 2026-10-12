/**
 * Host B entry: the out-of-process ACP adapter (`durable: true`).
 *
 * Launched by `bin/acp-bridge.mjs` under the rpc-keeper:
 * `node acp-bridge.mjs --agent <id>`. Mints the dashboard session UUID, reads the
 * agent definition from `~/.pi/dashboard/config.json` by id, mounts the adapter
 * core, and connects to the local gateway with backoff. The adapter registers
 * FIRST (frames buffer until the socket opens), so the spawn watchdog is
 * satisfied within seconds even while the agent is still starting.
 *
 * Exits 0 on a clean stop, non-zero on any startup / runtime failure (the cause
 * is already shown in the session by the core).
 *
 * See change: add-acp-session-driver (D1, D2, D5).
 */
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { AcpAgentConfig, AcpSettings } from "@blackbelt-technology/pi-dashboard-shared/acp/acp-config.js";
import { acpEventLogPath, acpSessionFile } from "@blackbelt-technology/pi-dashboard-shared/acp/paths.js";
import { loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { type AcpSessionAdapter, type AcpSessionAdapterOptions, createAcpSessionAdapter } from "./acp-session-adapter.js";
import { createEventLog } from "./event-log.js";
import { createGatewayClient, type GatewayClient } from "./gateway-client.js";

function parseAgentArg(argv: readonly string[]): string | undefined {
  const i = argv.indexOf("--agent");
  const v = i >= 0 ? argv[i + 1] : undefined;
  return v && !v.startsWith("--") ? v : undefined;
}

export interface HostBOptions {
  agent: AcpAgentConfig;
  settings: AcpSettings;
  cwd: string;
  sessionId?: string;
  spawnToken?: string;
  endpoint?: () => string | undefined;
  /** Test seam: replace the real agent spawn. */
  launchAgent?: AcpSessionAdapterOptions["launchAgent"];
  log?: (line: string) => void;
  onExit: (code: number) => void;
}

export interface HostB {
  adapter: AcpSessionAdapter;
  client: GatewayClient;
  sessionId: string;
}

/** Wire adapter ↔ gateway client ↔ durable event log. Starts the session. */
export function startHostB(o: HostBOptions): HostB {
  const sessionId = o.sessionId ?? randomUUID();
  const log = o.log ?? ((l) => process.stderr.write(`${l}\n`));
  const eventLog = createEventLog({ file: acpEventLogPath(sessionId), maxBytes: o.settings.eventLogMaxBytes });
  let adapter: AcpSessionAdapter;
  const client = createGatewayClient({
    endpoint: o.endpoint,
    log,
    onOpen: (first) => {
      if (!first) void adapter.reconnected();
    },
    onMessage: (m) => adapter.handle(m),
    onClose: () => adapter.disconnected(),
  });
  adapter = createAcpSessionAdapter({
    agent: o.agent,
    settings: o.settings,
    cwd: o.cwd,
    sessionId,
    spawnToken: o.spawnToken,
    sessionFile: acpSessionFile(sessionId),
    reportPid: process.pid,
    send: (m) => client.send(m),
    log,
    eventLog,
    launchAgent: o.launchAgent,
    onExit: (code) => {
      // Give the unregister frame a moment to leave before the socket closes.
      setTimeout(() => {
        client.close();
        o.onExit(code);
      }, 150);
    },
  });
  client.connect();
  void adapter.start();
  return { adapter, client, sessionId };
}

async function main(): Promise<void> {
  const agentId = parseAgentArg(process.argv.slice(2));
  const config = loadConfig();
  const agent = config.acpAgents.find((a) => a.id === agentId);
  if (!agent) {
    process.stderr.write(`acp-bridge: unknown or missing --agent ${JSON.stringify(agentId)}\n`);
    process.exit(2);
  }
  // Single-use: read, then scrub so descendants never inherit it.
  const spawnToken = process.env.PI_DASHBOARD_SPAWN_TOKEN;
  delete process.env.PI_DASHBOARD_SPAWN_TOKEN;
  const host = startHostB({
    agent,
    settings: config.acp,
    cwd: process.cwd(),
    spawnToken,
    onExit: (code) => process.exit(code),
  });
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const) process.on(sig, () => void host.adapter.stop());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
