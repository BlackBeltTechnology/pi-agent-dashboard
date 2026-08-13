/**
 * Pi Gateway - WebSocket server for bridge extension connections.
 */

import type { ExtensionToServerMessage, ServerToExtensionMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { WebSocket, WebSocketServer } from "ws";
import type { SessionManager } from "../session/memory-session-manager.js";
import { getSpawnRegisterWatchdog } from "../spawn-process/spawn-register-watchdog.js";
import {
  CONTENTION_PROBE_WINDOW,
  type ContentionTracker,
  createContentionTracker,
  decideClaim,
  formatContentionLine,
  formatPid,
  isSocketAlive,
  type ProbeableSocket,
  resolveProbe,
} from "./bridge-contention.js";

/**
 * How many times a contended claim may be re-decided when the routing entry's
 * holder changes mid-probe. Each retry REQUIRES an observed holder change, so
 * this cannot spin against a stable incumbent.
 * See change: fix-duplicate-bridge-registration.
 */
const MAX_CLAIM_ATTEMPTS = 3;

export const HEARTBEAT_TIMEOUT = 180_000;
export const WS_PING_INTERVAL = 60_000;
export { CONTENTION_PROBE_WINDOW };

export interface PiGatewayOptions {
  heartbeatTimeout?: number;
  pingInterval?: number;
  /** Bounded window the contention probe waits for the incumbent's pong. */
  contentionProbeWindow?: number;
}

export interface PiGateway {
  start(port: number, host?: string): void;
  stop(): void;
  /** Resolved listening port after start() (useful when start(0) is used). Returns null if not started or closed. */
  address(): number | null;
  sendToSession(sessionId: string, msg: ServerToExtensionMessage): boolean;
  broadcast(msg: ServerToExtensionMessage): void;
  connectionCount(): number;
  findSessionByCwd(cwd: string): string | undefined;
  /** All connected sessions whose cwd prefix-matches `cwd` (folder-scoped reload). */
  findSessionsByCwd(cwd: string): string[];
  getConnectedSessionIds(): string[];
  isSessionConnected(sessionId: string): boolean;
  /** Force-close the WebSocket connection for a session */
  closeSession(sessionId: string): boolean;
  /**
   * Contention records, cumulative refusal counter and rate limiter.
   * See change: fix-duplicate-bridge-registration (D4, D6).
   */
  contention: ContentionTracker;
  /**
   * True when a live bridge serves `sessionFile` under ANY session id, using
   * D1's liveness definition (not raw `readyState`). The resume guard keys on
   * this. See change: fix-duplicate-bridge-registration (D5).
   */
  findLiveSessionBySessionFile(sessionFile: string): string | undefined;
  onEvent?: (sessionId: string, msg: ExtensionToServerMessage) => void;
  onEmpty?: () => void;
  onConnection?: () => void;
  onDisconnect?: (sessionId: string) => void;
  onSessionCreated?: (sessionId: string) => void;
  /**
   * Fired after a `session_register` message has been processed and the
   * session is in the manager. Receives the registered sessionId and its
   * cwd. Wired by the dashboard server to consume any pending
   * spawn-with-attach intent. See change:
   * add-folder-task-checker-and-spawn-attach.
   */
  onSessionRegistered?: (sessionId: string, cwd: string) => void;
}

export function createPiGateway(
  sessionManager: SessionManager,
  options?: PiGatewayOptions,
): PiGateway {
  const hbTimeout = options?.heartbeatTimeout ?? HEARTBEAT_TIMEOUT;
  const pingMs = options?.pingInterval ?? WS_PING_INTERVAL;
  const probeWindow = options?.contentionProbeWindow ?? CONTENTION_PROBE_WINDOW;
  const contention = createContentionTracker();
  let wss: WebSocketServer | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;

  // Map sessionId → WebSocket
  const connections = new Map<string, WebSocket>();
  // Track connection liveness for WS ping/pong (miss counter: kill after 2 consecutive misses)
  const aliveMisses = new Map<WebSocket, number>();
  // Map sessionId → heartbeat timeout
  const heartbeatTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // Map sessionId → { setAt: timestamp, sleepRetried: boolean } for sleep detection
  const heartbeatMeta = new Map<string, { setAt: number; sleepRetried: boolean }>();

  let onEvent: ((sessionId: string, msg: ExtensionToServerMessage) => void) | undefined;
  let onEmpty: (() => void) | undefined;
  let onConnection: (() => void) | undefined;
  let onDisconnect: ((sessionId: string) => void) | undefined;
  let onSessionCreated: ((sessionId: string) => void) | undefined;
  let onSessionRegistered: ((sessionId: string, cwd: string) => void) | undefined;

  function checkEmpty() {
    if (connections.size === 0) {
      onEmpty?.();
    }
  }

  function resetHeartbeat(sessionId: string) {
    const existing = heartbeatTimers.get(sessionId);
    if (existing) clearTimeout(existing);

    const now = Date.now();
    heartbeatMeta.set(sessionId, { setAt: now, sleepRetried: false });

    heartbeatTimers.set(
      sessionId,
      setTimeout(() => {
        // If the WebSocket TCP connection is still open, don't kill the session.
        // The bridge is just busy (e.g. running a long tool execution) and can't
        // send heartbeats, but the connection itself is alive. Reschedule.
        const ws = connections.get(sessionId);
        if (ws && ws.readyState === WebSocket.OPEN) {
          console.error(`[gateway] heartbeat timeout but WS still OPEN for ${sessionId}, rescheduling`);
          resetHeartbeat(sessionId);
          return;
        }
        // Session status check: if the session is still streaming/active
        // (not manually ended), give it more time to reconnect.
        // Forked child processes (vitest) can kill the WS connection by
        // inheriting and closing the FD, but the bridge will reconnect
        // once the event loop is free.
        const session = sessionManager.get(sessionId);
        const meta = heartbeatMeta.get(sessionId);
        if (session && session.status !== "ended" && !meta?.sleepRetried) {
          console.error(`[gateway] heartbeat timeout but session ${sessionId} still active, giving reconnect grace period`);
          if (meta) {
            meta.sleepRetried = true;
            meta.setAt = Date.now();
          }
          heartbeatTimers.set(
            sessionId,
            setTimeout(() => {
              const ws2 = connections.get(sessionId);
              if (ws2 && ws2.readyState === WebSocket.OPEN) {
                resetHeartbeat(sessionId);
                return;
              }
              console.error(`[gateway] session timed out: ${sessionId} (reconnect grace period expired)`);
              // Expiry only DETECTS an ending that already happened; the
              // session's last activity is the evidence.
              // See change: fix-ended-session-missing-endedat.
              sessionManager.unregister(sessionId, { witnessed: false });
              connections.delete(sessionId);
              heartbeatTimers.delete(sessionId);
              heartbeatMeta.delete(sessionId);
              checkEmpty();
            }, hbTimeout),
          );
          return;
        }
        console.error(`[gateway] heartbeat timeout, WS state=${ws?.readyState} for ${sessionId}`);

        const meta2 = heartbeatMeta.get(sessionId);
        const elapsed = Date.now() - (meta2?.setAt ?? now);

        // Detect sleep: elapsed >> expected means system was suspended
        if (meta2 && !meta2.sleepRetried && elapsed > hbTimeout * 2) {
          // Give one more cycle for the extension to reconnect
          meta2.sleepRetried = true;
          meta2.setAt = Date.now();
          heartbeatTimers.set(
            sessionId,
            setTimeout(() => {
              const ws2 = connections.get(sessionId);
              if (ws2 && ws2.readyState === WebSocket.OPEN) {
                resetHeartbeat(sessionId);
                return;
              }
              console.error(`[gateway] session timed out: ${sessionId} (sleep recovery failed)`);
              // Detection, not observation — see above.
              sessionManager.unregister(sessionId, { witnessed: false });
              connections.delete(sessionId);
              heartbeatTimers.delete(sessionId);
              heartbeatMeta.delete(sessionId);
              checkEmpty();
            }, hbTimeout),
          );
          return;
        }

        console.error(`[gateway] session timed out: ${sessionId} (no heartbeat for ${hbTimeout}ms)`);
        // Heartbeat expiry — evidence-derived, not detection time.
        // See change: fix-ended-session-missing-endedat.
        sessionManager.unregister(sessionId, { witnessed: false });
        connections.delete(sessionId);
        heartbeatTimers.delete(sessionId);
        heartbeatMeta.delete(sessionId);
        checkEmpty();
      }, hbTimeout)
    );
  }

  return {
    set onEvent(handler: ((sessionId: string, msg: ExtensionToServerMessage) => void) | undefined) {
      onEvent = handler;
    },

    set onEmpty(handler: (() => void) | undefined) {
      onEmpty = handler;
    },

    set onConnection(handler: (() => void) | undefined) {
      onConnection = handler;
    },

    set onDisconnect(handler: ((sessionId: string) => void) | undefined) {
      onDisconnect = handler;
    },

    set onSessionCreated(handler: ((sessionId: string) => void) | undefined) {
      onSessionCreated = handler;
    },

    set onSessionRegistered(handler: ((sessionId: string, cwd: string) => void) | undefined) {
      onSessionRegistered = handler;
    },

    address() {
      const addr = wss?.address();
      if (addr && typeof addr === "object") return addr.port;
      return null;
    },
    start(port: number, host?: string) {
      wss = new WebSocketServer(host ? { port, host } : { port });

      // WS-level ping/pong: detect truly dead connections.
      // Pong responses are processed in the event loop, so a busy bridge
      // won't respond to pings. We check the underlying TCP socket's
      // writable state as a fallback — if TCP is alive, the bridge is just
      // busy, not dead.
      const PING_MISS_THRESHOLD = 3;
      if (pingMs > 0) pingTimer = setInterval(() => {
        if (!wss) return;
        for (const client of wss.clients) {
          const misses = aliveMisses.get(client) ?? 0;
          if (misses >= PING_MISS_THRESHOLD) {
            // Check if the underlying TCP socket is still alive.
            // If the socket is writable, the connection is physically intact —
            // the bridge is just too busy to process pong frames.
            const socket = (client as any)._socket;
            const socketAlive = socket && !socket.destroyed && socket.writable;
            if (socketAlive) {
              // TCP alive but no pong — bridge is busy. Reset counter, keep alive.
              console.error(`[gateway] ping: ${misses} misses but TCP alive, keeping session (socket.destroyed=${socket?.destroyed} writable=${socket?.writable})`);
              aliveMisses.set(client, 0);
              client.ping();
              continue;
            }
            // TCP is dead — clean up
            console.error(`[gateway] ping: TCP dead (socket=${!!socket} destroyed=${socket?.destroyed} writable=${socket?.writable})`);
            
            for (const [sid, ws] of connections) {
              if (ws === client) {
                console.error(`[gateway] connection dead (ping timeout, ${misses} misses): ${sid}`);
                // Ping timeout — same family as heartbeat expiry.
                // See change: fix-ended-session-missing-endedat.
                sessionManager.unregister(sid, { witnessed: false });
                connections.delete(sid);
                const timer = heartbeatTimers.get(sid);
                if (timer) clearTimeout(timer);
                heartbeatTimers.delete(sid);
                heartbeatMeta.delete(sid);
                break;
              }
            }
            client.terminate();
            aliveMisses.delete(client);
            checkEmpty();
            continue;
          }
          aliveMisses.set(client, misses + 1);
          client.ping();
        }
      }, pingMs);

      wss.on("connection", (ws) => {
        let currentSessionId: string | null = null;
        // Serializes this socket's messages. The contention decision is async
        // (it may probe the incumbent), and a bridge sends `session_register`
        // immediately followed by events; without this queue a later message
        // would overtake the deferred register and be dropped as unowned.
        let queue: Promise<void> = Promise.resolve();
        // Set once this socket has been terminally refused; it must never
        // influence gateway state again, even for in-flight frames.
        let refused = false;
        aliveMisses.set(ws, 0);
        ws.on("pong", () => { aliveMisses.set(ws, 0); });

        /**
         * Probe the incumbent for a pong within the bounded window, then apply
         * D1's two-factor rule. See change: fix-duplicate-bridge-registration.
         */
        function probeIncumbent(incumbent: WebSocket): Promise<boolean> {
          return new Promise((resolve) => {
            let settled = false;
            const onPong = () => {
              if (settled) return;
              settled = true;
              incumbent.off("pong", onPong);
              clearTimeout(timer);
              resolve(true);
            };
            const timer = setTimeout(() => {
              if (settled) return;
              settled = true;
              incumbent.off("pong", onPong);
              resolve(false);
            }, probeWindow);
            // Do not hold the event loop open for the probe window.
            (timer as any).unref?.();
            incumbent.on("pong", onPong);
            try {
              incumbent.ping();
            } catch {
              /* a socket that cannot even be pinged will fail the writability factor */
            }
          });
        }

        /** Terminally refuse this socket: tell it why, then close it. */
        function refuse(sessionId: string, incumbentPid?: number, newcomerPid?: number) {
          refused = true;
          const emit = contention.record(sessionId, incumbentPid, newcomerPid);
          if (emit) {
            console.error(formatContentionLine(sessionId, incumbentPid, newcomerPid));
          }
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: "register_rejected",
                sessionId,
                reason: "another live bridge already serves this session id",
              }),
            );
          }
          ws.close();
        }

        /**
         * Resolve whether `ws` may claim the routing entry for `sessionId`.
         * Returns false when the socket was refused (caller must return).
         */
        async function claim(sessionId: string, newcomerPid?: number): Promise<boolean> {
          let attempt = 0;
          while (attempt < MAX_CLAIM_ATTEMPTS) {
          const incumbent = connections.get(sessionId);
          const session = sessionManager.get(sessionId);
          const decision = decideClaim({
            incumbent,
            newcomer: ws,
            incumbentSource: incumbent ? session?.source : undefined,
            incumbentPid: session?.pid,
            newcomerPid,
          });

          if (decision.outcome === "accept") {
            // A same-pid displacement replaces a LIVE incumbent with no probe
            // and no refusal, so it is otherwise indistinguishable from an
            // ordinary re-register. Log it: the pid is self-reported, and this
            // is the one path that bypasses the contention rule.
            if (decision.reason === "same-pid") {
              console.error(
                `[gateway] same-pid reconnect replaces incumbent: ${sessionId} pid=${formatPid(newcomerPid)}`,
              );
            }
            return true;
          }

          // Contended: probe the incumbent within the bounded window.
          const held = incumbent as WebSocket;
          const ponged = await probeIncumbent(held);

          // The newcomer may itself have died during the probe window. Handing
          // it the routing entry would point the map at a dead socket and wedge
          // the session until the heartbeat grace path reaps it.
          if (ws.readyState !== WebSocket.OPEN) return false;

          // The holder may have changed during the probe: two newcomers have
          // independent message queues, so their claims race against one
          // incumbent. Accepting here on the strength of a probe against a
          // socket that no longer holds the entry would let the second
          // newcomer overwrite the first — reintroducing last-writer-wins,
          // precisely what this rule exists to prevent. Re-decide against the
          // CURRENT holder instead.
          if (connections.get(sessionId) !== held) {
            if (refused) return false;
            attempt++;
            continue;
          }

          const resolved = resolveProbe(held, ponged);
          if (resolved.outcome === "displace") {
            held.terminate();
            connections.delete(sessionId);
            return true;
          }
          refuse(sessionId, session?.pid, newcomerPid);
          return false;
          }

          // Bounded: each retry requires the holder to have changed mid-probe,
          // so this cannot spin on a stable incumbent.
          console.error(
            `[gateway] contention for ${sessionId} did not settle in ${MAX_CLAIM_ATTEMPTS} attempts; refusing newcomer`,
          );
          refuse(sessionId, sessionManager.get(sessionId)?.pid, newcomerPid);
          return false;
        }

        ws.on("message", (raw) => {
          // Any received message proves the connection is alive
          aliveMisses.set(ws, 0);
          queue = queue.then(() => handleMessage(raw)).catch(() => {});
        });

        async function handleMessage(raw: unknown) {
          // A refused socket may never mutate gateway state again, not even
          // via frames already in flight when it lost.
          // See change: fix-duplicate-bridge-registration (D0).
          if (refused) return;
          try {
            const msg = JSON.parse(String(raw)) as ExtensionToServerMessage;

            if (msg.type === "session_register") {
              await handleRegister(msg);
              return;
            }

            // Track session identity from any message with a sessionId.
            // This is a claim on the routing table, so it is contention-checked
            // too — but a non-register message never displaces a live
            // incumbent, it is simply not routable.
            if (!currentSessionId && "sessionId" in msg && (msg as any).sessionId) {
              const sid: string = (msg as any).sessionId;
              const incumbent = connections.get(sid);
              if (incumbent && incumbent !== ws && incumbent.readyState === WebSocket.OPEN) {
                // Held by a live socket: this socket never becomes the entry.
                currentSessionId = sid;
                return;
              }
              currentSessionId = sid;
              connections.set(sid, ws);
              // Auto-create a placeholder session so events aren't lost
              if (!sessionManager.get(sid)) {
                sessionManager.register({
                  id: sid,
                  cwd: "",
                  source: "unknown",
                });
                onSessionCreated?.(sid);
              }
              resetHeartbeat(sid);
              onConnection?.();
            }

            // Ownership gate: a socket that does not hold the entry for the id
            // it names may not reset the incumbent's heartbeat, overwrite its
            // metrics, unregister it, or reach `onEvent`.
            // `plugin_pi_message` is gated on the CONNECTION's registered
            // session, matching how it is attributed below. Gating it on the
            // body field instead would let a bridge name any session and have
            // its own message silently dropped, so the attribution that treats
            // that field as untrusted could never be reached.
            // See change: add-dashboard-mcp-server.
            const named =
              msg.type === "plugin_pi_message"
                ? currentSessionId
                : "sessionId" in msg
                  ? (msg as any).sessionId
                  : undefined;
            if (named && connections.get(named) !== ws) return;

            handleOwnedMessage(msg);
          } catch {
            // Ignore malformed messages
          }
        }

        async function handleRegister(msg: Extract<ExtensionToServerMessage, { type: "session_register" }>) {
          // The contention decision runs BEFORE every register side effect:
          // the watchdog clear, the placeholder cleanup, `resetHeartbeat`, the
          // callbacks and `onEvent`. A refused newcomer that reached any of
          // them would strip the incumbent's `sessionFile`, consume its spawn
          // token, or reset its reconnect-grace timer.
          // See change: fix-duplicate-bridge-registration (D0).
          const ok = await claim(msg.sessionId, msg.pid);
          if (!ok) return;

          try {
            // Clear spawn-register watchdog BEFORE any throwing logic. See change: spawn-failure-diagnostics.
            // Priority: token > pid > cwd. Token is the strongest identity
            // (spawn-correlation-token); pid catches headless without token;
            // cwd is the legacy fallback for tmux/wt with neither.
            const watchdog = getSpawnRegisterWatchdog();
            if (msg.spawnToken) watchdog.clearByToken(msg.spawnToken);
            if (msg.pid !== undefined) watchdog.clearByPid(msg.pid);
            watchdog.clearByCwd(msg.cwd);

            // If session ID changed (e.g., after /reload), clean up the old placeholder
            if (currentSessionId && currentSessionId !== msg.sessionId) {
                const oldSession = sessionManager.get(currentSessionId);
                // Clean up if it's an auto-created placeholder (source unknown)
                // or a ghost session (no sessionFile, created by duplicate bridge)
                if (oldSession && (oldSession.source === "unknown" || !oldSession.sessionFile)) {
                  sessionManager.unregister(currentSessionId);
                  connections.delete(currentSessionId);
                }
              }
              currentSessionId = msg.sessionId;
              connections.set(msg.sessionId, ws);

              sessionManager.register({
                id: msg.sessionId,
                cwd: msg.cwd,
                name: msg.name,
                source: msg.source,
                model: msg.model,
                thinkingLevel: msg.thinkingLevel,
                sessionFile: msg.sessionFile,
                sessionDir: msg.sessionDir,
                firstMessage: msg.firstMessage,
                pid: msg.pid,
                // Forward registerReason so server.ts onChange can apply
                // the configured reattach placement policy.
                // See change: reattach-move-to-front.
                registerReason: msg.registerReason,
                // Fact-forwarding for the first-register auto-hide heuristic.
                // Normalize untrusted socket inputs to known types before
                // forwarding so a malformed payload cannot skew visibility.
                // See change: auto-hide-headless-worker-sessions.
                hasUI: typeof msg.hasUI === "boolean" ? msg.hasUI : undefined,
                visibilityIntent:
                  msg.visibilityIntent === "hidden" || msg.visibilityIntent === "visible"
                    ? msg.visibilityIntent
                    : undefined,
              });
              console.error(`[gateway] session registered: ${msg.sessionId} cwd=${msg.cwd}`);

              resetHeartbeat(msg.sessionId);
              onConnection?.();
              onSessionRegistered?.(msg.sessionId, msg.cwd);
              onEvent?.(msg.sessionId, msg);
          } catch {
            // Ignore malformed messages
          }
        }

        function handleOwnedMessage(msg: ExtensionToServerMessage) {
            if (msg.type === "session_heartbeat" && msg.sessionId) {
              resetHeartbeat(msg.sessionId);
              // Store process metrics on the session if provided
              if (msg.metrics) {
                sessionManager.update(msg.sessionId, {
                  processMetrics: { ...msg.metrics, updatedAt: Date.now() },
                });
              }
              // Respond with ack so the bridge can track server liveness
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "heartbeat_ack" }));
              }
            }

            if (msg.type === "session_unregister" && msg.sessionId) {
              console.error(`[gateway] session unregistered: ${msg.sessionId} (explicit)`);
              sessionManager.unregister(msg.sessionId);
              connections.delete(msg.sessionId);
              // Session end is one of the four D4 clearing triggers.
              contention.clear(msg.sessionId);
              const timer = heartbeatTimers.get(msg.sessionId);
              if (timer) {
                clearTimeout(timer);
                heartbeatTimers.delete(msg.sessionId);
              }
              heartbeatMeta.delete(msg.sessionId);
              checkEmpty();
            }

            if (msg.type === "model_update") {
              const session = sessionManager.get(msg.sessionId);
              if (session) {
                const updates: Partial<typeof session> = { model: msg.model };
                if (msg.thinkingLevel !== undefined) {
                  updates.thinkingLevel = msg.thinkingLevel;
                }
                sessionManager.update(msg.sessionId, updates);
              }
            }

            // Notify listeners.
            //
            // `plugin_pi_message` is attributed to the CONNECTION's registered
            // session (`currentSessionId`), not to `msg.sessionId`. The body
            // field is required by the protocol type and is therefore always
            // present, so preferring it would let a bridge attribute its
            // message to any session it names. Plugins make trust decisions on
            // this id — mcp-server-plugin mints a session-scoped credential
            // from it — so it must be the connection's own identity.
            //
            // The guarantee is exactly "the session this socket registered as",
            // which is the pi gateway's existing per-connection identity model;
            // it is not a claim about the gateway port's own authentication.
            // Every other message type keeps the previous precedence.
            // See change: add-dashboard-mcp-server.
            const eventSessionId =
              msg.type === "plugin_pi_message"
                ? currentSessionId
                : "sessionId" in msg
                  ? (msg as any).sessionId
                  : undefined;
            onEvent?.(eventSessionId ?? currentSessionId ?? "", msg);
        }

        ws.on("close", () => {
          // Identity-scoped cleanup: only the socket that still OWNS the routing
          // entry may run id-keyed teardown. A displaced or refused socket
          // closing must not raise a disconnect on a live session, clear the
          // incumbent's heartbeat/reconnect-grace timers, or finalize an
          // automation run another socket is serving.
          // See change: fix-duplicate-bridge-registration (D3).
          if (currentSessionId && connections.get(currentSessionId) === ws) {
            console.error(`[gateway] connection closed: ${currentSessionId}`);
            // Headless automation runs are one-shot and never reconnect.
            // Treating a WS close as terminal for them finalizes the run
            // immediately instead of holding it in the human-oriented
            // reconnect-grace path (which would leave the run `running` for
            // the full heartbeat window and starve `concurrency: skip`).
            // Every other session keeps the grace behavior unchanged.
            // See change: finalize-automation-run-on-session-death.
            const session = sessionManager.get(currentSessionId);
            if (session?.kind === "automation" && session.status !== "ended") {
              console.error(`[gateway] automation session ${currentSessionId} closed; finalizing now (no reconnect grace)`);
              const timer = heartbeatTimers.get(currentSessionId);
              if (timer) clearTimeout(timer);
              heartbeatTimers.delete(currentSessionId);
              heartbeatMeta.delete(currentSessionId);
              connections.delete(currentSessionId);
              onDisconnect?.(currentSessionId);
              // unregister LAST: it fires onUnregister → plugin onSessionEnded
              // → engine finalize; do it after local cleanup so the death
              // signal sees a fully torn-down connection.
              sessionManager.unregister(currentSessionId);
              checkEmpty();
            } else {
              // Don't immediately unregister - wait for heartbeat timeout
              // This handles temporary disconnects
              onDisconnect?.(currentSessionId);
            }
            // The incumbent leaving is one of the four D4 clearing triggers.
            contention.clear(currentSessionId);
          }
          aliveMisses.delete(ws);
        });
      });
    },

    stop() {
      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
      for (const timer of heartbeatTimers.values()) {
        clearTimeout(timer);
      }
      heartbeatTimers.clear();
      heartbeatMeta.clear();
      aliveMisses.clear();
      // Forcibly terminate every accepted socket, not just the ones holding a
      // routing entry — `wss.close()` does not terminate clients, so a socket
      // outside `connections` would survive teardown and re-register against
      // the fresh server. See change: fix-duplicate-bridge-registration (D3).
      for (const client of wss?.clients ?? []) {
        client.terminate();
      }
      connections.clear();
      wss?.close();
      wss = null;
    },

    sendToSession(sessionId: string, msg: ServerToExtensionMessage): boolean {
      const ws = connections.get(sessionId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
        return true;
      }
      return false;
    },

    broadcast(msg: ServerToExtensionMessage): void {
      const payload = JSON.stringify(msg);
      for (const ws of connections.values()) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(payload);
        }
      }
    },

    connectionCount(): number {
      return connections.size;
    },

    isSessionConnected(sessionId: string): boolean {
      const ws = connections.get(sessionId);
      return ws !== undefined && ws.readyState === WebSocket.OPEN;
    },

    findSessionByCwd(cwd: string): string | undefined {
      // Find a connected session whose cwd matches or is a prefix
      for (const sid of connections.keys()) {
        const session = sessionManager.get(sid);
        if (session && (session.cwd === cwd || session.cwd.startsWith(cwd + "/") || cwd.startsWith(session.cwd + "/"))) {
          return sid;
        }
      }
      return undefined;
    },

    findSessionsByCwd(cwd: string): string[] {
      // Plural of findSessionByCwd: every OPEN-socket session governed by `cwd`.
      // Mirrors getConnectedSessionIds' readyState filter so stale sockets
      // never inflate a folder-scoped reload. See change:
      // folder-resource-activation-toggle.
      const ids: string[] = [];
      for (const sid of connections.keys()) {
        if (connections.get(sid)?.readyState !== WebSocket.OPEN) continue;
        const session = sessionManager.get(sid);
        if (session && (session.cwd === cwd || session.cwd.startsWith(`${cwd}/`) || cwd.startsWith(`${session.cwd}/`))) {
          ids.push(sid);
        }
      }
      return ids;
    },

    getConnectedSessionIds(): string[] {
      return [...connections.keys()].filter(
        (sid) => connections.get(sid)?.readyState === WebSocket.OPEN,
      );
    },

    closeSession(sessionId: string): boolean {
      const ws = connections.get(sessionId);
      if (ws) {
        ws.close();
        connections.delete(sessionId);
        contention.clear(sessionId);
        return true;
      }
      return false;
    },

    contention,

    findLiveSessionBySessionFile(sessionFile: string): string | undefined {
      // Liveness is D1's definition, not raw `readyState`: a half-open
      // incumbent must NOT lock out a resume.
      // See change: fix-duplicate-bridge-registration (D5).
      if (!sessionFile) return undefined;
      for (const [sid, ws] of connections) {
        if (ws.readyState !== WebSocket.OPEN) continue;
        if (!isSocketAlive(ws as unknown as ProbeableSocket)) continue;
        const session = sessionManager.get(sid);
        if (session?.sessionFile === sessionFile) return sid;
      }
      return undefined;
    },
  };
}
