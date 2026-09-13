/**
 * In-process relay test doubles (change: add-browser-relay test-plan "New infra
 * needed"): an in-memory `RelaySocket` pair plus a fake Chrome extension that
 * speaks protocol v2 over it.
 *
 * Why not a real `ws` pair: the extension side is a WIRE PROTOCOL, and what the
 * relay tests must pin is the protocol handling (handshake gating, command
 * ids, event routing) — not TCP. An in-memory pair is deterministic, needs no
 * port, and lets a test inject `bufferedAmount` to exercise backpressure, which
 * a real socket cannot do on demand.
 */
import type { RelaySocket } from "../extension-socket.js";

type Listener = (...args: never[]) => void;

/** A `RelaySocket` whose `send` delivers to its paired peer synchronously. */
export class FakeSocket implements RelaySocket {
  readyState = 1;
  bufferedAmount = 0;
  /** Every payload this socket sent, in order. */
  readonly sent: string[] = [];
  /** Every payload this socket RECEIVED from its peer, in order. */
  readonly received: string[] = [];
  readonly closed: Array<{ code: number; reason: string }> = [];
  peer?: FakeSocket;
  private readonly listeners = new Map<string, Listener[]>();

  send(data: string): void {
    this.sent.push(data);
    this.peer?.deliver(data);
  }

  close(code = 1000, reason = ""): void {
    if (this.readyState !== 1) return;
    this.readyState = 3;
    this.closed.push({ code, reason });
    this.emit("close", code, reason);
    this.peer?.remoteClose(code, reason);
  }

  on(event: string, listener: Listener): this {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) (listener as (...a: unknown[]) => void)(...args);
  }

  /** Deliver an inbound frame (as the peer's `send` would). */
  deliver(data: unknown): void {
    this.received.push(String(data));
    this.emit("message", data);
  }

  /** The peer closed: surface a local close WITHOUT bouncing back to it. */
  remoteClose(code: number, reason: string): void {
    if (this.readyState !== 1) return;
    this.readyState = 3;
    this.closed.push({ code, reason });
    this.emit("close", code, reason);
  }

  /** Parse every frame this socket sent. */
  json(): Array<Record<string, unknown>> {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  }

  /** Parse every frame this socket received from its peer. */
  receivedJson(): Array<Record<string, unknown>> {
    return this.received.map((s) => JSON.parse(s) as Record<string, unknown>);
  }
}

/** Two `FakeSocket`s wired to each other. */
export function socketPair(): [FakeSocket, FakeSocket] {
  const a = new FakeSocket();
  const b = new FakeSocket();
  a.peer = b;
  b.peer = a;
  return [a, b];
}

export interface FakeTab {
  id: number;
  title: string;
  url: string;
}

interface WireCommand {
  id?: number;
  method?: string;
  params?: unknown;
}

interface RecordedCommand {
  tabId: number;
  sessionId?: string;
  method: string;
  params: unknown;
}

/**
 * The extension half of the pair: answers `chrome.debugger.*` /
 * `chrome.tabs.*` commands and can emit `chrome.debugger.onEvent` for a tab.
 */
export class FakeExtension {
  /** Every `chrome.debugger.sendCommand` (i.e. every CDP method) received. */
  readonly cdpCommands: RecordedCommand[] = [];
  /** Override a command's result by method name. */
  respond: (method: string, params: unknown) => unknown = () => ({});

  constructor(
    private readonly socket: FakeSocket,
    private readonly tabs: FakeTab[] = [],
  ) {
    socket.on("message", ((data: unknown) => this._onMessage(data)) as never);
  }

  private _onMessage(data: unknown): void {
    const msg = JSON.parse(String(data)) as WireCommand;
    if (typeof msg.id !== "number" || typeof msg.method !== "string") return;
    if (msg.method === "chrome.debugger.attach" || msg.method === "chrome.debugger.detach") {
      this._respond(msg.id, undefined);
      return;
    }
    if (msg.method === "chrome.tabs.create") {
      const url = (msg.params as [RecordedCommand["params"]])?.[0] as { url?: string } | undefined;
      const tab = this.tabs[0] ?? { id: 99, title: "created", url: url?.url ?? "" };
      this._respond(msg.id, tab);
      return;
    }
    if (msg.method === "chrome.tabs.remove") {
      this._respond(msg.id, undefined);
      return;
    }
    if (msg.method === "chrome.debugger.sendCommand") {
      const [target, method, params] = (msg.params ?? []) as [
        { tabId: number; sessionId?: string },
        string,
        unknown,
      ];
      this.cdpCommands.push({ tabId: target.tabId, sessionId: target.sessionId, method, params });
      if (method === "Target.getTargetInfo") {
        const tab = this.tabs.find((t) => t.id === target.tabId);
        this._respond(msg.id, {
          targetInfo: {
            targetId: `target-${target.tabId}`,
            title: tab?.title ?? "",
            url: tab?.url ?? "",
            attached: true,
            type: "page",
          },
        });
        return;
      }
      this._respond(msg.id, this.respond(method, params));
      return;
    }
    // Unknown command: answer with an empty result rather than hanging.
    this._respond(msg.id, undefined);
  }

  private _respond(id: number, result: unknown): void {
    this._toRelay({ id, result });
  }

  /** Send a frame TO the relay side (the peer), never onto our own socket. */
  private _toRelay(payload: unknown): void {
    this.socket.send(JSON.stringify(payload));
  }

  /** Push `chrome.tabs.onCreated` per tab, then `extension.initialized`. */
  initialize(): void {
    for (const tab of this.tabs) {
      this._toRelay({
        method: "chrome.tabs.onCreated",
        params: [{ ...tab, index: 0, windowId: 1, active: true, pinned: false }],
      });
    }
    this._toRelay({ method: "extension.initialized", params: [] });
  }

  /** `chrome.debugger.onDetach` for a tab — the DevTools path uses reason `canceled_by_user`. */
  detach(tabId: number, reason: string): void {
    this._toRelay({ method: "chrome.debugger.onDetach", params: [{ tabId }, reason] });
  }

  tabRemoved(tabId: number): void {
    this._toRelay({
      method: "chrome.tabs.onRemoved",
      params: [tabId, { windowId: 1, isWindowClosing: false }],
    });
  }

  /** Emit one `chrome.debugger.onEvent` (a CDP event for a tab). */
  emitChromeEvent(tabId: number, method: string, params: unknown): void {
    this._toRelay({
      method: "chrome.debugger.onEvent",
      params: [{ tabId }, method, params],
    });
  }

  /** A `Page.screencastFrame` for a tab, with the metadata the tap scales by. */
  emitFrame(tabId: number, opts: { data?: string; deviceWidth?: number; deviceHeight?: number; sessionId?: number } = {}): void {
    this.emitChromeEvent(tabId, "Page.screencastFrame", {
      data: opts.data ?? "AAAA",
      sessionId: opts.sessionId ?? 1,
      metadata: {
        deviceWidth: opts.deviceWidth ?? 1280,
        deviceHeight: opts.deviceHeight ?? 800,
        timestamp: 1,
      },
    });
  }
}

/** Let every already-queued microtask + delivered frame settle. */
export async function flush(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise((r) => setImmediate(r));
}

/** A viewer socket that records the frames it received. */
export function viewerSocket(): FakeSocket & { frames: () => Array<Record<string, unknown>> } {
  const socket = new FakeSocket();
  const frames = () =>
    socket
      .json()
      .filter((m) => m.type === "browser_relay_frame");
  return Object.assign(socket, { frames });
}
