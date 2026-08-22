/**
 * Pi Gateway - WebSocket server for bridge extension connections.
 */

import type http from "node:http";
import type { IncomingMessage } from "node:http";
import type { ExtensionToServerMessage, ServerToExtensionMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { WebSocket, WebSocketServer } from "ws";
import type { TicketConsumption } from "../auth/ws-ticket.js";
import type { SessionManager } from "../session/memory-session-manager.js";
import { attributeOrigin, UNATTRIBUTED_REMOTE } from "../session/session-origin.js";
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
import { decideBridgeUpgrade, isLoopbackAddress } from "./bridge-upgrade-auth.js";
import { bindGatewaySocket, unbindGatewaySocket } from "./gateway-socket-bind.js";
import { createProvisionalRegistry } from "./provisional-registration.js";

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
  /**
   * Authorisation for TCP bridge upgrades (D10b, task 6.3). Omitted, the TCP
   * listener keeps its historical accept-anything behaviour — which is
   * exactly what makes the container's `0.0.0.0` default indefensible, so
   * production wiring always supplies it.
   */
  bridgeAuth?: {
    consumeTicket: (ticket: string | null | undefined) => TicketConsumption;
    /** `true` once the D10b deprecation window has closed. */
    requireTicketOnLoopback?: boolean;
    /** Checks `X-Pi-Local-Token` for a loopback bridge (D6, task 5.3). */
    verifyLocalToken?: (headers: Record<string, unknown> | undefined) => boolean;
    log?: (msg: string) => void;
  };
  /** Bounded window the contention probe waits for the incumbent's pong. */
  contentionProbeWindow?: number;
  /** TTL for provisional registrations; test seam for the 30s default. */
  provisionalTtlMs?: number;
  /**
   * Test seam: the peer address the origin gate sees. Every test peer is
   * loopback (and therefore local), so without this the remote branch of the
   * gate is unreachable from a test — which is precisely how it shipped inert.
   */
  peerAddressForTest?: string;
  /**
   * This dashboard's persistent instance id, returned to a bridge opening a
   * provisional registration so it can verify the target's identity before
   * committing a move (D11/D14, task 9.7).
   */
  instanceId?: string;
}

export interface PiGateway {
  start(port: number, host?: string): void;
  /**
   * Bind the local unix-domain socket. Async and REFUSABLE: a path with a
   * live listener aborts with `GatewaySocketConflictError` rather than
   * unlinking an incumbent (D9).
   */
  startOnSocket(socketPath: string): Promise<void>;
  stop(): void;
  /**
   * Resolved listening endpoint after start(): a port number for TCP, the
   * socket PATH for a UDS listener, or null when not started. A UDS
   * `address()` is a string, so the old number-only accessor blanked the
   * gateway endpoint in the settings UI (task 2.9).
   */
  address(): number | string | null;
  /** The active transport, for callers that must branch on it. */
  transport(): { transport: "tcp"; port: number } | { transport: "unix"; path: string } | null;
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
  /** The UDS listener, when this instance serves bridges over a socket (D1). */
  let socketServer: http.Server | null = null;
  let socketPath: string | null = null;

  // Map sessionId → WebSocket
  const connections = new Map<string, WebSocket>();
  // Intent-only registrations (D11, task 9.3a). Deliberately separate from
  // `connections`: an entry here is NOT a routing claim.
  const provisionalRegistry = createProvisionalRegistry({ ttlMs: options?.provisionalTtlMs });
  /**
   * Device id resolved during the upgrade, keyed by the upgrade request so the
   * connection handler can read it. Weak: entries die with the request.
   */
  const upgradeDeviceId = new WeakMap<IncomingMessage, string>();
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

  /**
   * Install the WS-level ping/pong heartbeat.
   *
   * Transport-agnostic ON PURPOSE: `bridge-contention.ts` uses pong frames as
   * its liveness oracle, and the POSIX default is heading toward a
   * socket-only listener (D6/D10). Leaving this inside `start()` — the TCP
   * path — would ship socket-only startup with no heartbeat and a silently
   * no-op contention probe.
   * See change: add-pi-gateway-transport-identity.
   */
  const startHeartbeat = () => {
    if (pingTimer) return;
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
  };

  /**
   * One connection handler, shared by every transport (D10). Registered on a
   * `noServer` WebSocketServer for the unix socket and on the TCP listener
   * alike, so the transport is a per-bridge property rather than a
   * per-server mode. See change: add-pi-gateway-transport-identity.
   */
  const attachConnectionHandler = (target: WebSocketServer, transport: "unix" | "tcp") => {
      target.on("connection", (ws, req) => {
        // Origin evidence, derived ONLY from the connection and its credential
        // — never from anything the bridge says about itself. A unix peer
        // opened a file in this HOME's 0700 dir; a loopback TCP peer is on this
        // host; anything else is remote, attributable via its bridge ticket or
        // (failing closed) not at all.
        const sessionOrigin = attributeOrigin({
          transport,
          remote:
            transport === "tcp" &&
            !isLoopbackAddress(
              options?.peerAddressForTest ?? req?.socket?.remoteAddress ?? undefined,
            ),
          deviceId: req ? upgradeDeviceId.get(req) : undefined,
          localInstanceId: options?.instanceId ?? "",
        });
        // `originDeviceId` is ABSENT for a local session (that is how every
        // pre-existing session keeps working), so a remote peer we could not
        // attribute still needs a value — otherwise "unattributable" would
        // silently read back as "local", which is the opposite of failing closed.
        const originDeviceId = sessionOrigin.local
          ? undefined
          : (sessionOrigin.deviceId ?? UNATTRIBUTED_REMOTE);
        let currentSessionId: string | null = null;
        // The session this socket holds an OPEN provisional for, if any. A
        // provisional announces intent and claims nothing, so this socket must
        // stay unrouted for that id until it commits.
        let provisionalSessionId: string | null = null;
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
            // D11 (task 9.3b): the commit is where routing ACTUALLY transfers.
              // Until this frame lands the origin is still the live bridge, so a
              // move that never commits is a no-op rather than an outage.
              if ((msg as { type?: string }).type === "session_move_commit") {
                const commit = msg as unknown as { sessionId: string; token: string };
                const verdict = provisionalRegistry.commit(commit.token);
                if (!verdict.ok) {
                  // Same detail-free refusal as the provisional itself: a cause
                  // here would re-open the enumeration oracle (task 9.3a-iv).
                  ws.send(
                    JSON.stringify(
                      provisionalRegistry.refuseForWire({
                        sessionId: commit.sessionId,
                        cause: verdict.cause,
                      }),
                    ),
                  );
                  return;
                }
                // The routing entry transfers for the id the TOKEN was minted
                // for — never the id on the wire. They are separate inputs, and
                // trusting the wire made this a hijack primitive: open a
                // provisional for a throwaway id, then commit naming a victim,
                // and the victim's routing followed. A mismatch is refused
                // outright rather than silently corrected, because a mover with
                // nothing to hide never sends one.
                const movedId = verdict.sessionId;
                if (commit.sessionId !== movedId) {
                  ws.send(
                    JSON.stringify(
                      provisionalRegistry.refuseForWire({
                        sessionId: commit.sessionId,
                        cause: "unknown-token",
                      }),
                    ),
                  );
                  return;
                }
                // A commit may never displace a LIVE incumbent. Nothing in the
                // protocol proves the mover is the session's origin — the token
                // is minted by whoever asked for it — so without this the move
                // path was a hijack primitive that skipped the contention and
                // liveness probe a plain register goes through.
                //
                // The invariant this restores: a move grants NOTHING a plain
                // `session_register` does not already grant. Adopting a session
                // this instance has never heard of is exactly what a register
                // does; taking one out of a live socket's hands is not.
                //
                // A genuine move never trips this — the session is live on the
                // ORIGIN, not here. Moving back to an instance that once held it
                // is still fine: that entry is gone once the socket closed.
                const incumbent = connections.get(movedId);
                if (incumbent && incumbent !== ws) {
                  ws.send(
                    JSON.stringify(
                      provisionalRegistry.refuseForWire({
                        sessionId: movedId,
                        cause: "session-live-elsewhere",
                      }),
                    ),
                  );
                  return;
                }
                // Hand over the routing entry. The previous holder is NOT probed or
                // refused — this is a cooperative handover the origin asked for,
                // not contention.
                currentSessionId = movedId;
                connections.set(movedId, ws);
                // Materialise the session if this instance never had one: a
                // routing entry with no session record would route frames to a
                // dashboard that cannot render the session.
                if (!sessionManager.get(movedId) && verdict.register) {
                  sessionManager.register({
                    id: movedId,
                    originDeviceId,
                    cwd: verdict.register.cwd,
                    name: verdict.register.name,
                    source: verdict.register.source as never,
                    model: verdict.register.model,
                    sessionFile: verdict.register.sessionFile,
                    sessionDir: verdict.register.sessionDir,
                    firstMessage: verdict.register.firstMessage,
                    pid: verdict.register.pid,
                  });
                }
                resetHeartbeat(movedId);
                console.log(`[gateway] session move committed: ${movedId}`);
                return;
              }

            // Dispatched ahead of the auto-placeholder claim below: that branch
            // handles ANY named message from a socket holding no entry and then
            // returns, so it would swallow the commit frame outright.
            if (!currentSessionId && "sessionId" in msg && (msg as any).sessionId) {
              const sid: string = (msg as any).sessionId;
              // A socket holding an open provisional for this id must NOT be
              // auto-claimed into owning it. Otherwise the very next frame a
              // move target sends laundered its "claims nothing" provisional
              // into a real routing entry, taking the session before the
              // commit that is meant to be the only transfer point.
              // Only observable across two instances: on a single gateway the
              // origin's ownership gate absorbed the frame and hid it.
              if (sid === provisionalSessionId) return;
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
            //
            // `plugin_pi_message` is exempt from the NAMED-id form of this gate:
            // its body `sessionId` is not a routing claim, because the event is
            // attributed to the connection's own registered session (see the
            // `eventSessionId` note in `handleOwnedMessage`). Gating on the body
            // id would silently DROP a forged frame instead of re-attributing
            // it, so the spoof would never reach the plugin under its true
            // identity. The connection must still own its own entry, which
            // keeps refused/displaced sockets out.
            // See change: add-dashboard-mcp-server.
            if (msg.type === "plugin_pi_message") {
              if (!currentSessionId || connections.get(currentSessionId) !== ws) return;
              handleOwnedMessage(msg);
              return;
            }

            const named = "sessionId" in msg ? (msg as any).sessionId : undefined;
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
          // D11 (task 9.3a): a PROVISIONAL register announces intent and stops
          // here — before `claim()`, before `connections.set()`, before every
          // register side effect. It takes no routing entry and no contention
          // slot, so the origin keeps serving until an explicit commit.
          if ((msg as { provisional?: boolean }).provisional) {
            // A move TARGET has never heard of the session — that is precisely
            // what makes it a move. Refusing an unknown session here made every
            // cross-instance move impossible while same-instance ones passed,
            // which is why the unit tests missed it: they modelled origin and
            // target as one gateway. Found by real two-instance verification.
            //
            // Refusing also LEAKED what the refusal was meant to hide: accepted
            // vs rejected told any local caller whether a session lived here.
            // Answering uniformly is both correct and quieter. A provisional
            // still claims nothing, so accepting one grants nothing; the payload
            // is carried so the commit can materialise the session.
            const opened = provisionalRegistry.open({
              sessionId: msg.sessionId,
              instanceId: options?.instanceId ?? "",
              register: {
                cwd: msg.cwd,
                source: msg.source,
                name: msg.name,
                model: msg.model,
                sessionFile: msg.sessionFile,
                sessionDir: msg.sessionDir,
                firstMessage: msg.firstMessage,
                pid: msg.pid,
              },
            });
            provisionalSessionId = msg.sessionId;
            ws.send(
              JSON.stringify({
                type: "provisional_accepted",
                sessionId: msg.sessionId,
                instanceId: opened.instanceId,
                token: opened.token,
              }),
            );
            return;
          }

          const ok = await claim(msg.sessionId, msg.pid);
          if (!ok) return;

          try {
            // Clear spawn-register watchdog BEFORE any throwing logic. See change: spawn-failure-diagnostics.
            // Priority: token > pid > cwd. Token is the strongest identity
            // (spawn-correlation-token); pid catches headless without token;
            // cwd is the legacy fallback for tmux/wt with neither.
            // Tier-aware, not an unconditional cascade: with two concurrent
            // same-cwd spawns, clearing A by its token and then falling through
            // to `clearByCwd` disarmed B's watchdog too, so a B that never
            // registered was never diagnosed and never reclaimed.
            // See change: fix-spawn-correlation-ttl-coupling (D4).
            const watchdog = getSpawnRegisterWatchdog();
            let cleared = msg.spawnToken ? watchdog.clearByToken(msg.spawnToken) : false;
            if (!cleared && msg.pid !== undefined) cleared = watchdog.clearByPid(msg.pid);
            if (!cleared) watchdog.clearByCwd(msg.cwd);

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
                // Derived from the credential, not from the payload.
                originDeviceId,
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
                // The auto-hide heuristic used to read `params.source`, which is
                // the bridge's PRE-decision self-report ("tui") — it cannot yet
                // be "dashboard", so a dashboard spawn reporting `hasUI:false`
                // was hidden from its own sidebar. Same strict-boolean
                // normalization as the untrusted inputs above.
                // See change: fix-spawn-correlation-ttl-coupling (D3).
                dashboardSpawned: msg.dashboardSpawned === true,
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
  };

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
      // BOTH listeners can be bound at once (socket + opt-in TCP, D10). The
      // numeric port is the load-bearing answer — `server.piPort()` feeds it to
      // spawned sessions and the health endpoint — so a bound TCP listener is
      // reported in preference to the socket path, which `transport()` still
      // reports for display.
      // `ws` THROWS on address() in noServer mode (socket-only), so this is a
      // question that must be asked defensively, not a value to read.
      let tcpAddr: ReturnType<NonNullable<typeof wss>["address"]> | null = null;
      try {
        tcpAddr = wss?.address() ?? null;
      } catch {
        tcpAddr = null;
      }
      if (tcpAddr && typeof tcpAddr === "object") return tcpAddr.port;
      const addr = socketServer?.address() ?? tcpAddr;
      if (addr && typeof addr === "object") return addr.port;
      // A UDS listener's address() is the socket PATH, not an object. Returning
      // null here blanked the gateway endpoint in the settings UI (task 2.9),
      // so the path is reported as-is and the accessor is transport-aware.
      if (typeof addr === "string") return addr;
      return null;
    },
    transport() {
      if (socketPath) return { transport: "unix" as const, path: socketPath };
      const addr = socketServer?.address() ?? wss?.address();
      if (addr && typeof addr === "object") return { transport: "tcp" as const, port: addr.port };
      return null;
    },
    /**
     * Bind the local unix-domain socket (POSIX). Separate from `start()`
     * because binding a socket path is asynchronous and may legitimately
     * REFUSE (a live incumbent must never be unlinked — D9).
     *
     * Shares one `WebSocketServer({ noServer: true })` and therefore one
     * upgrade/connection handler with the TCP listener, so the transport is a
     * per-bridge property rather than a per-server mode (D10).
     */
    async startOnSocket(path: string) {
      if (!wss) {
        wss = new WebSocketServer({ noServer: true });
        attachConnectionHandler(wss, "unix");
      }
      const server = await bindGatewaySocket({ socketPath: path });
      // Capture the CURRENT wss: routing socket upgrades through a mutable
      // binding would send them to whatever server a later start() installed.
      const target = wss;
      server.on("upgrade", (req, socket, head) => {
        target.handleUpgrade(req, socket as never, head, (ws) => {
          target.emit("connection", ws, req);
        });
      });
      socketServer = server;
      socketPath = path;
      startHeartbeat();
    },
    start(port: number, host?: string) {
      // A listener already exists (socket transport): replacing `wss` here
      // would orphan it and silently re-route socket upgrades into the TCP
      // server's client set. Both transports are meant to SHARE one
      // WebSocketServer (D10), so refuse the ordering that cannot.
      if (wss) {
        throw new Error(
          "pi-gateway: start() after startOnSocket() would orphan the socket listener; " +
            "start the TCP listener first, or serve the socket transport alone",
        );
      }
      // Every TCP upgrade passes the bridge-auth gate; the unix socket does
      // not (the kernel already decided — D5). `verifyClient` refuses BEFORE
      // the socket exists, so no unauthenticated bridge connection is ever
      // accepted and then closed.
      const bridgeAuth = options?.bridgeAuth;
      const verifyClient = bridgeAuth
        ? (info: { req: IncomingMessage }, done: (ok: boolean, code?: number, msg?: string) => void) => {
            const verdict = decideBridgeUpgrade({
              transport: "tcp",
              remoteAddress: info.req.socket.remoteAddress ?? undefined,
              headers: info.req.headers,
              url: info.req.url,
              secWebSocketProtocol: info.req.headers["sec-websocket-protocol"],
              requireTicketOnLoopback: bridgeAuth.requireTicketOnLoopback,
              consumeTicket: bridgeAuth.consumeTicket,
              verifyLocalToken: bridgeAuth.verifyLocalToken,
            });
            const log = bridgeAuth.log ?? ((m: string) => console.warn(m));
            if (!verdict.allow) {
              // Logged server-side only: the client is told nothing beyond
              // "401", so the named cause is not an oracle.
              log(`[pi-gateway] ${verdict.reason}`);
              done(false, 401, "unauthorised bridge upgrade");
              return;
            }
            if (verdict.deprecated) log(`[pi-gateway] ${verdict.reason}`);
            if (verdict.deviceId) upgradeDeviceId.set(info.req, verdict.deviceId);
            done(true);
          }
        : undefined;
      wss = new WebSocketServer(
        host ? { port, host, verifyClient } : { port, verifyClient },
      );
      attachConnectionHandler(wss, "tcp");
      startHeartbeat();
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
      // Remove the socket file on clean shutdown; idempotent w.r.t. a file
      // that is already gone (task 2.5).
      if (socketPath) {
        // `stop()` is synchronous by contract, so the teardown cannot be
        // awaited here — but it must still be OWNED: an unobserved rejection
        // would leave the socket path behind with no trace of why.
        const pending = unbindGatewaySocket(socketServer, socketPath);
        const path = socketPath;
        pending.catch((err: unknown) => {
          console.error(`[gateway] failed to remove socket ${path}: ${String(err)}`);
        });
        socketServer = null;
        socketPath = null;
      }
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
