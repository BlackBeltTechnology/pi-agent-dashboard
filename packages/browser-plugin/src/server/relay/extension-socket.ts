/**
 * Extension-side WebSocket adapter (change: add-browser-relay, design D2).
 *
 * Speaks the Playwright Chrome Extension's protocol-v2 wire format: outbound
 * `{id, method, params}` commands with promise-mapped responses, inbound
 * `{id, result|error}` responses and `{method, params}` events.
 *
 * WHY THIS EXISTS rather than reusing upstream's `ExtensionConnection`: that
 * class is private to `vendor/playwright-core/src/tools/mcp/cdpRelay.ts` and
 * `CDPRelayServer` — its only exported user — also owns the HTTP/WS listener we
 * are explicitly replacing (instances receive ALREADY-UPGRADED sockets from the
 * core upgrade gate). Re-exporting it would mean editing a hash-pinned vendor
 * file. So `RelayInstance` constructs the vendored *logic* classes
 * (`ExtensionProtocolV2` + `BrowserModel`, both exported) and supplies this
 * adapter as their transport. The vendored files stay byte-identical, which is
 * what makes an upstream refresh a re-copy.
 */

/** Structural subset of `ws.WebSocket` the relay needs. */
export interface RelaySocket {
  readyState: number;
  /** Bytes queued but not yet flushed — the per-viewer backpressure signal. */
  bufferedAmount?: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: string, listener: (...args: never[]) => void): unknown;
}

/** `ws` readyState values. */
export const WS_OPEN = 1;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  error: Error;
}

interface WireMessage {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: string;
}

export class ExtensionSocket {
  private readonly callbacks = new Map<number, Pending>();
  private lastId = 0;

  onmessage?: (method: string, params: unknown) => void;
  onclose?: (reason: string) => void;

  constructor(private readonly ws: RelaySocket) {
    ws.on("message", ((data: unknown) => this._onMessage(data)) as never);
    ws.on("close", ((code: number, reason: unknown) => this._onClose(code, reason)) as never);
    ws.on("error", (() => this._dispose()) as never);
  }

  get isOpen(): boolean {
    return this.ws.readyState === WS_OPEN;
  }

  /** Send one command and resolve with the extension's `result`. */
  send(method: string, params: unknown): Promise<unknown> {
    if (!this.isOpen) {
      return Promise.reject(new Error(`Unexpected WebSocket state: ${this.ws.readyState}`));
    }
    const id = ++this.lastId;
    this.ws.send(JSON.stringify({ id, method, params }));
    const error = new Error(`Protocol error: ${method}`);
    return new Promise((resolve, reject) => {
      this.callbacks.set(id, { resolve, reject, error });
    });
  }

  close(reason: string): void {
    if (this.isOpen) this.ws.close(1000, reason);
  }

  private _onMessage(data: unknown): void {
    const text = typeof data === "string" ? data : String(data);
    let parsed: WireMessage;
    try {
      parsed = JSON.parse(text) as WireMessage;
    } catch {
      // Malformed frame from the extension: a protocol desync we cannot recover
      // from — drop the socket rather than guess at a partial message.
      this._dispose();
      this.ws.close();
      return;
    }
    if (parsed.id !== undefined && this.callbacks.has(parsed.id)) {
      const pending = this.callbacks.get(parsed.id)!;
      this.callbacks.delete(parsed.id);
      if (parsed.error !== undefined) {
        pending.error.message = parsed.error;
        pending.reject(pending.error);
      } else {
        pending.resolve(parsed.result);
      }
      return;
    }
    if (parsed.id !== undefined) return; // response for an id we never sent
    if (typeof parsed.method === "string") this.onmessage?.(parsed.method, parsed.params);
  }

  private _onClose(_code: number, reason: unknown): void {
    const message = typeof reason === "string" ? reason : String(reason ?? "");
    this._dispose();
    this.onclose?.(message);
  }

  private _dispose(): void {
    for (const pending of this.callbacks.values()) pending.reject(new Error("WebSocket closed"));
    this.callbacks.clear();
  }
}
