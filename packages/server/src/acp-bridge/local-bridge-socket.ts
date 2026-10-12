/**
 * A duck-typed `WebSocket` for the in-process ACP host (host A).
 *
 * The gateway's per-connection handler only needs `readyState`, `send`, `close`,
 * `terminate`, `ping` and `message` / `close` / `pong` events, so a virtual
 * socket lets the in-process core run through the SAME registration, contention,
 * spawn-token, heartbeat and disconnect code as a real bridge — no gateway fork.
 *
 * Direction: `receive(m)` = core → gateway (bridge frames); the gateway's
 * `send(json)` = gateway → core (`ServerToExtensionMessage`).
 *
 * See change: add-acp-session-driver (D1, host A).
 */
import { EventEmitter } from "node:events";
import type { ExtensionToServerMessage, ServerToExtensionMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import type { LocalGatewaySocket } from "../pi/pi-gateway.js";

const OPEN = 1;
const CLOSED = 3;

export class LocalBridgeSocket extends EventEmitter implements LocalGatewaySocket {
  readyState = OPEN;
  _socket = { destroyed: false, writable: true };
  private readonly toCore: (m: ServerToExtensionMessage) => void;

  constructor(toCore: (m: ServerToExtensionMessage) => void) {
    super();
    this.toCore = toCore;
  }

  /** Gateway → core. */
  send(data: string): void {
    if (this.readyState !== OPEN) return;
    try {
      this.toCore(JSON.parse(data) as ServerToExtensionMessage);
    } catch {
      /* a malformed frame from our own gateway cannot happen; never throw into it */
    }
  }

  /** Core → gateway. Delivered asynchronously, like a real socket. */
  receive(m: ExtensionToServerMessage): void {
    if (this.readyState !== OPEN) return;
    const raw = Buffer.from(JSON.stringify(m));
    queueMicrotask(() => {
      if (this.readyState === OPEN) this.emit("message", raw);
    });
  }

  /** The gateway pings for liveness; an in-process peer answers immediately. */
  ping(): void {
    queueMicrotask(() => {
      if (this.readyState === OPEN) this.emit("pong");
    });
  }

  close(): void {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    this._socket = { destroyed: true, writable: false };
    queueMicrotask(() => this.emit("close"));
  }

  terminate(): void {
    this.close();
  }
}
