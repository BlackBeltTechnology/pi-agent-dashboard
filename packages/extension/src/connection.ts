/**
 * WebSocket connection manager with exponential backoff reconnection
 * and message buffering during disconnection.
 */

export interface ConnectionManagerOptions {
  url: string;
  WebSocketImpl?: any;
  maxBufferSize?: number;
  /** Server liveness watchdog: force reconnect after this many ms without any received message. Default 60000. Set 0 to disable. */
  watchdogTimeout?: number;
  onMessage?: (data: unknown) => void;
  onReconnect?: () => void;
}

export class ConnectionManager {
  private url: string;
  private WS: any;
  private ws: any | null = null;
  private buffer: string[] = [];
  private maxBufferSize: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoff = 0;
  private intentionalClose = false;
  private hasConnectedBefore = false;
  private onMessage?: (data: unknown) => void;
  private onReconnect?: () => void;

  private static readonly INITIAL_BACKOFF = 1000;
  private static readonly MAX_BACKOFF = 30000;
  private static readonly WATCHDOG_CHECK_INTERVAL = 15_000;
  private static readonly DEFAULT_WATCHDOG_TIMEOUT = 60_000;

  private lastMessageAt = 0;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private watchdogTimeout: number;

  /**
   * Auto-start suppression deadline (epoch ms). When the server announces
   * a deliberate restart/shutdown via `server_restarting`, the bridge sets
   * this to `Date.now() + quiesceMs` so the spawn step in `autoStartServer`
   * is skipped while the orchestrator does its work. Discovery + reconnect
   * are NOT suppressed.
   * See change: fix-restart-bridge-auto-start-race.
   */
  private suppressUntil = 0;

  constructor(options: ConnectionManagerOptions) {
    this.url = options.url;
    this.WS = options.WebSocketImpl ?? (globalThis as any).WebSocket;
    this.maxBufferSize = options.maxBufferSize ?? 10000;
    this.watchdogTimeout = options.watchdogTimeout ?? ConnectionManager.DEFAULT_WATCHDOG_TIMEOUT;
    this.onMessage = options.onMessage;
    this.onReconnect = options.onReconnect;
  }

  connect(): void {
    this.intentionalClose = false;
    this.createConnection();
    this.startWatchdog();
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.stopWatchdog();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }

  send(message: unknown): void {
    const data = JSON.stringify(message);

    if (this.ws?.readyState === 1) {
      try {
        this.ws.send(data);
      } catch {
        // Connection died between readyState check and send — buffer instead
        this.bufferMessage(data);
      }
    } else {
      this.bufferMessage(data);
    }
  }

  private bufferMessage(data: string): void {
    this.buffer.push(data);
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer.shift();
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === 1;
  }

  /**
   * Pause auto-start spawn for `ms` milliseconds. Idempotent: only extends
   * the suppression window, never shortens it. See change:
   * fix-restart-bridge-auto-start-race.
   */
  pauseAutoStart(ms: number): void {
    if (!Number.isFinite(ms) || ms <= 0) return;
    const next = Date.now() + ms;
    if (next > this.suppressUntil) this.suppressUntil = next;
  }

  /**
   * Returns true while the auto-start spawn step should be suppressed.
   * See change: fix-restart-bridge-auto-start-race.
   */
  shouldSuppressAutoStart(): boolean {
    return Date.now() < this.suppressUntil;
  }

  /**
   * Update the WebSocket URL and reconnect.
   * Used when mDNS discovers the server on a different address/port.
   */
  updateUrl(newUrl: string): void {
    if (newUrl === this.url) return;
    this.url = newUrl;
    // Force reconnect to new URL
    if (this.ws) {
      this.handleDisconnect();
    }
  }

  private createConnection(): void {
    try {
      this.ws = new this.WS(this.url);
    } catch {
      // Constructor failed — schedule reconnect
      this.ws = null;
      if (!this.intentionalClose) {
        this.scheduleReconnect();
      }
      return;
    }

    this.ws.onopen = () => {
      // Reset backoff on successful connection
      this.backoff = 0;
      this.lastMessageAt = Date.now();

      // Notify reconnect if this isn't the first connection
      if (this.hasConnectedBefore) {
        this.onReconnect?.();
      }
      this.hasConnectedBefore = true;

      // Flush buffer
      const buffered = [...this.buffer];
      this.buffer = [];
      for (const data of buffered) {
        this.ws?.send(data);
      }
    };

    this.ws.onmessage = (ev: { data: string }) => {
      this.lastMessageAt = Date.now();
      try {
        const parsed = JSON.parse(ev.data);
        this.onMessage?.(parsed);
      } catch {
        // Ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      this.handleDisconnect();
    };

    this.ws.onerror = () => {
      // Node 22's built-in WebSocket may fire onerror WITHOUT onclose
      // on connection failure. Handle once and prevent re-entrant calls
      // (ws.close() can re-trigger onerror synchronously).
      this.handleDisconnect();
    };
  }

  private handleDisconnect(): void {
    if (!this.ws) return; // Already handled — idempotent guard
    const ws = this.ws;
    this.ws = null;
    // Detach handlers to prevent re-entrant calls from ws.close()
    ws.onclose = null;
    ws.onerror = null;
    ws.onopen = null;
    ws.onmessage = null;
    try { ws.close(); } catch { /* ignore — may already be closed */ }
    if (!this.intentionalClose) {
      this.scheduleReconnect();
    }
  }

  private startWatchdog(): void {
    this.stopWatchdog();
    if (this.watchdogTimeout <= 0) return;
    this.watchdogTimer = setInterval(() => {
      if (this.ws && this.lastMessageAt > 0 && Date.now() - this.lastMessageAt >= this.watchdogTimeout) {
        // Server has gone silent — force close to trigger reconnect
        this.handleDisconnect();
      }
    }, ConnectionManager.WATCHDOG_CHECK_INTERVAL);
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.backoff === 0) {
      this.backoff = ConnectionManager.INITIAL_BACKOFF;
    } else {
      this.backoff = Math.min(this.backoff * 2, ConnectionManager.MAX_BACKOFF);
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.createConnection();
    }, this.backoff);
  }
}
