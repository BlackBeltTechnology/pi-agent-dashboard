/**
 * Host A — the in-process ACP host (`durable: false`, default).
 *
 * No keeper, no adapter process, no gateway client: the core runs in the server
 * process, attached to the gateway through a `LocalBridgeSocket`. The only child
 * is the agent itself, spawned here so its pid + `ChildProcess` can be returned
 * as an ordinary `SpawnResult` (the headless PID registry then kills it like any
 * session). The session ends when the server stops (`stopAllLocalAcpSessions`).
 *
 * Start is DEFERRED by one macrotask: the core registers synchronously from
 * `start()`, but spawn callers arm the register watchdog and record correlation
 * only AFTER `spawnPiSession` returns — registering first would leave the
 * watchdog armed forever. The agent is launched immediately (its pid is needed
 * for the result) and a buffering handle replays an early `error` / `exit`
 * (Node emits spawn errors on the next tick, before the core attaches).
 *
 * See change: add-acp-session-driver (D1, D2).
 */
import { randomUUID } from "node:crypto";
import type { AcpAgentConfig, AcpSettings } from "@blackbelt-technology/pi-dashboard-shared/acp/acp-config.js";
import { acpSessionFile } from "@blackbelt-technology/pi-dashboard-shared/acp/paths.js";
import type { ChildProcess } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import type { LocalGatewaySocket } from "../pi/pi-gateway.js";
import { type AcpSessionAdapter, type AgentHandle, createAcpSessionAdapter } from "./acp-session-adapter.js";
import { launchAgentProcess } from "./child-env.js";
import { LocalBridgeSocket } from "./local-bridge-socket.js";

export interface LocalHostDeps {
  attachLocalConnection(socket: LocalGatewaySocket): void;
  log(line: string): void;
}

export interface LocalAcpStart {
  success: boolean;
  message: string;
  sessionId?: string;
  pid?: number;
  process?: ChildProcess;
}

const active = new Map<string, AcpSessionAdapter>();

/** Wrap a child so listeners attached AFTER an early event still observe it. */
function bufferedHandle(child: ChildProcess): AgentHandle {
  let earlyError: Error | undefined;
  let earlyExit: [number | null, NodeJS.Signals | null] | undefined;
  const errorListeners: Array<(e: Error) => void> = [];
  const exitListeners: Array<(c: number | null, s: NodeJS.Signals | null) => void> = [];
  child.on("error", (e) => {
    earlyError = e;
    for (const l of errorListeners) l(e);
  });
  child.on("exit", (c, s) => {
    earlyExit = [c, s];
    for (const l of exitListeners) l(c, s);
  });
  const handle: AgentHandle = {
    stdin: child.stdin as NonNullable<ChildProcess["stdin"]>,
    stdout: child.stdout as NonNullable<ChildProcess["stdout"]>,
    stderr: child.stderr,
    pid: child.pid,
    kill: (sig) => child.kill(sig),
    on(event: "exit" | "error", listener: never) {
      if (event === "error") {
        errorListeners.push(listener);
        if (earlyError) (listener as (e: Error) => void)(earlyError);
      } else {
        exitListeners.push(listener);
        if (earlyExit) (listener as (c: number | null, s: NodeJS.Signals | null) => void)(...earlyExit);
      }
      return handle;
    },
  };
  return handle;
}

export function startLocalAcpSession(
  deps: LocalHostDeps,
  o: {
    agent: AcpAgentConfig;
    settings: AcpSettings;
    cwd: string;
    spawnToken?: string;
    sessionId?: string;
    /** Test seam: replace the real agent spawn. */
    launch?: () => ChildProcess;
  },
): LocalAcpStart {
  const sessionId = o.sessionId ?? randomUUID();
  const log = (l: string) => deps.log(l);
  let child: ChildProcess;
  try {
    child = o.launch ? o.launch() : launchAgentProcess({ agent: o.agent, cwd: o.cwd, warn: (w) => log(`[acp:${o.agent.id}] ${w}`) });
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : String(err) };
  }
  const handle = bufferedHandle(child);

  let adapter: AcpSessionAdapter;
  const socket = new LocalBridgeSocket((m) => adapter.handle(m));
  adapter = createAcpSessionAdapter({
    agent: o.agent,
    settings: o.settings,
    cwd: o.cwd,
    sessionId,
    spawnToken: o.spawnToken,
    sessionFile: acpSessionFile(sessionId),
    // No reportPid: the server's own pid must never reach the gateway's force-kill path.
    send: (m) => socket.receive(m),
    log,
    launchAgent: () => handle,
    onExit: () => {
      active.delete(sessionId);
      socket.close();
    },
  });
  active.set(sessionId, adapter);
  deps.attachLocalConnection(socket);
  setTimeout(() => {
    adapter.start().catch((e) => log(`[acp:${o.agent.id}] start failed: ${e instanceof Error ? e.message : String(e)}`));
  }, 0);
  return { success: true, message: `ACP agent "${o.agent.id}" started in-process`, sessionId, pid: child.pid, process: child };
}

/** Server shutdown: end every in-process session and kill its agent. */
export async function stopAllLocalAcpSessions(): Promise<void> {
  await Promise.all([...active.values()].map((a) => a.stop()));
}

export function localAcpSessionCount(): number {
  return active.size;
}
