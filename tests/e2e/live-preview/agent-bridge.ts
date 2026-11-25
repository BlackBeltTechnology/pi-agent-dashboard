import { WebSocket } from "ws";
import { createPreviewPathLink, installBaseReservationListener, type PreviewPathLink } from "../../../packages/extension/src/preview-path-link.ts";
import type { IsolatedServer } from "./isolated-server.js";
import type { FakeSession } from "./operator.js";

/**
 * The AGENT side of the reserve-path pair (D9): a fake pi bridge session on the gateway socket that runs the REAL extension
 * code (`createPreviewPathLink` + the neutral `mock-site:base-reservation` listener) over its own authenticated socket — exactly
 * what `serve_mock_site` reaches through `pi.events`. `events` is the `{ emit }` a `startMockSite({ events })` call takes.
 * It is also a `FakeSession` (id/name/close), so a viewer pane can be opened for it with `operator.openLivePreview`.
 * See change: serve-live-previews-on-capability-origin (D9, rows F16, F17, X26).
 */
export interface ReserveAnswer {
  /** `/preview/<pid>/` or null (no tier-5 viewer / refused). */
  base: string | null;
  /** Raw `preview_path_result` frames received since this bridge connected (last = this answer). */
  frame?: Record<string, unknown>;
}

export class AgentBridge implements FakeSession {
  readonly id: string;
  readonly name: string;
  /** Every `preview_path_result` frame the server sent, in order. */
  readonly results: Record<string, unknown>[] = [];
  private ws!: WebSocket;
  private link!: PreviewPathLink;
  private readonly handlers = new Map<string, Array<(data: unknown) => void>>();
  private readonly server: IsolatedServer;

  /** The `pi.events` seam of the extension: `emit` reaches the installed reservation listener synchronously. */
  readonly events = {
    on: (channel: string, handler: (data: unknown) => void): (() => void) => {
      const list = this.handlers.get(channel) ?? [];
      list.push(handler);
      this.handlers.set(channel, list);
      return () => this.handlers.set(channel, (this.handlers.get(channel) ?? []).filter((h) => h !== handler));
    },
    emit: (channel: string, data: unknown): void => {
      for (const h of this.handlers.get(channel) ?? []) h(data);
    },
  };

  private constructor(server: IsolatedServer, id: string, name: string) {
    this.server = server;
    this.id = id;
    this.name = name;
  }

  /** Connect + register a session. A fixed `id` re-registers the same session (a bridge reconnect after a server restart). */
  static async connect(server: IsolatedServer, opts: { id?: string; name?: string } = {}): Promise<AgentBridge> {
    const id = opts.id ?? `lp-ag-${Math.random().toString(36).slice(2, 10)}`;
    const bridge = new AgentBridge(server, id, opts.name ?? `lp-agent-${id.slice(-4)}`);
    await bridge.open();
    return bridge;
  }

  private async open(): Promise<void> {
    this.ws = new WebSocket(`ws+unix://${this.server.gatewaySocket}:/`);
    await new Promise<void>((resolve, reject) => {
      this.ws.once("open", () => resolve());
      this.ws.once("error", reject);
    });
    this.link = createPreviewPathLink({
      send: (msg) => {
        if (this.ws.readyState !== WebSocket.OPEN) return false;
        this.ws.send(JSON.stringify(msg));
        return true;
      },
      sessionId: () => this.id,
      timeoutMs: 5_000,
    });
    this.handlers.clear();
    installBaseReservationListener(this.events, () => this.link);
    this.ws.on("message", (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.type === "preview_path_result") this.results.push(msg);
      this.link.handleResult(msg as { type?: string; requestId?: unknown; path?: unknown; error?: unknown });
    });
    this.ws.on("close", () => this.link.reset());
    this.ws.send(JSON.stringify({ type: "session_register", sessionId: this.id, name: this.name, cwd: "/tmp", source: "tui", pid: 700_000 + Math.floor(Math.random() * 90_000) }));
  }

  /** Re-open the gateway socket with the same session id (after `isolatedServer.restart()`). */
  async reconnect(): Promise<void> {
    await this.close();
    await this.open();
  }

  /** `preview_path_request` for `port` through the real bridge link; the matching server frame is returned with the answer. */
  async request(port: number): Promise<ReserveAnswer> {
    const before = this.results.length;
    const reservation = await this.link.request(port);
    return { base: reservation?.base ?? null, frame: this.results.length > before ? this.results[this.results.length - 1] : undefined };
  }

  async close(): Promise<void> {
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((r) => {
      this.ws.once("close", () => r());
      this.ws.close();
    });
  }
}
