/**
 * `BusClient` — a headless, ticket-authenticated WebSocket client for the
 * dashboard control plane. Imports the `packages/shared` protocol types and
 * exposes typed `send`, correlated `await`/`until`, bus-consistent `read`, and a
 * `plugin` passthrough over a single connection.
 *
 * Correlation strategy (per design.md):
 *   - EXACT where a correlation id exists: `spawn_session` → `session_added`
 *     .spawnRequestId, `resume_session` → `resume_result.requestId`.
 *   - STRUCTURAL otherwise: key on `sessionId` + the target `SessionStatus`
 *     transition observed on the subscription stream. Concurrency across
 *     sessions is safe because every wait is keyed by session id.
 *
 * See OpenSpec change: add-dashboard-bus-client-scripting.
 */
import crypto from "node:crypto";
import { WebSocket as NodeWebSocket } from "ws";
import type {
  BrowserToServerMessage,
  ServerToBrowserMessage,
  SessionsSnapshotMessage,
  SessionAddedMessage,
  SessionUpdatedMessage,
  SessionRemovedMessage,
  ResumeResultBrowserMessage,
  SpawnResultBrowserMessage,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type {
  DashboardSession,
  SessionStatus,
} from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { discoverHost, discoverPort } from "./port-discovery.js";
import {
  BusTimeoutError,
  NoPluginHandlerError,
  OffBoxError,
  TicketConsumedError,
  TicketExpiredError,
} from "./errors.js";
import { isTicketExpired, TICKET_TTL_MS, type Ticket, type WsTicketScope } from "./ticket.js";

/** PluginIds with a working server-side `plugin_action` handler as-built.
 *  flows/kb/automation lit up by change: fix-plugin-action-fanout-and-handlers
 *  (pluginId fan-out + real per-plugin handlers). */
export const KNOWN_PLUGIN_HANDLERS: readonly string[] = ["goal", "flows", "kb", "automation"] as const;

const DEFAULT_WAIT_TIMEOUT_MS = 30_000;

type AnyWebSocket = Pick<
  NodeWebSocket,
  "send" | "close" | "readyState" | "on" | "once" | "removeListener"
>;

export interface BusClientOptions {
  host?: string;
  port?: number;
  /** Injectable clock (default `Date.now`) — lets tests drive ticket expiry. */
  clock?: () => number;
  /** Injectable fetch (default global `fetch`) — for ticket minting. */
  fetchImpl?: typeof fetch;
  /** Injectable WebSocket ctor (default `ws`). */
  WebSocketCtor?: new (url: string) => AnyWebSocket;
}

export interface SpawnOptions {
  cwd: string;
  attachProposal?: string;
  gitWorktreeBase?: string;
  initialPrompt?: string;
  timeout?: number;
}

export interface ResumeOptions {
  sessionId: string;
  mode: "continue" | "fork";
  entryId?: string;
  placement?: "front" | "keep";
  timeout?: number;
}

type Waiter = {
  predicate: (msg: ServerToBrowserMessage) => boolean;
  resolve: (msg: ServerToBrowserMessage) => void;
  reject: (err: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
};

export class BusClient {
  readonly #host: string;
  readonly #port: number;
  readonly #clock: () => number;
  readonly #fetch: typeof fetch;
  readonly #WebSocketCtor: new (url: string) => AnyWebSocket;

  #ws: AnyWebSocket | null = null;
  #consumed = new Set<string>();
  #sessions = new Map<string, DashboardSession>();
  #waiters = new Set<Waiter>();

  constructor(opts: BusClientOptions = {}) {
    this.#host = discoverHost(opts.host);
    this.#port = discoverPort(opts.port);
    this.#clock = opts.clock ?? Date.now;
    this.#fetch = opts.fetchImpl ?? fetch;
    this.#WebSocketCtor =
      opts.WebSocketCtor ?? (NodeWebSocket as unknown as new (url: string) => AnyWebSocket);
  }

  get baseUrl(): string {
    return `http://${this.#host}:${this.#port}`;
  }

  // ── Ticket + connect ────────────────────────────────────────────

  /**
   * Mint a single-use WS ticket. Denied for off-box / untrusted callers
   * (`networkGuard`) → `OffBoxError` (explicit, never a hang).
   */
  async mintTicket(scope: WsTicketScope = "browser"): Promise<Ticket> {
    let res: Response;
    try {
      res = await this.#fetch(`${this.baseUrl}/api/ws-ticket`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      });
    } catch (err) {
      throw new OffBoxError(
        `ws-ticket mint failed to reach ${this.baseUrl}: ${(err as Error).message}`,
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new OffBoxError();
    }
    const json = (await res.json()) as {
      success: boolean;
      data?: { ticket: string };
      error?: string;
    };
    if (!json.success || !json.data?.ticket) {
      throw new OffBoxError(`ws-ticket mint rejected: ${json.error ?? "unknown"}`);
    }
    return { value: json.data.ticket, mintedAt: this.#clock(), ttlMs: TICKET_TTL_MS, scope };
  }

  /**
   * Open the socket with a specific ticket and await the first
   * `sessions_snapshot`. Rejects with a DISTINCT typed error for a
   * locally-expired or already-consumed ticket (not a generic socket close).
   */
  async connectWithTicket(ticket: Ticket): Promise<void> {
    if (this.#consumed.has(ticket.value)) throw new TicketConsumedError();
    if (isTicketExpired(ticket, this.#clock())) throw new TicketExpiredError();

    const url = `ws://${this.#host}:${this.#port}/ws?ticket=${encodeURIComponent(ticket.value)}`;
    const ws = new this.#WebSocketCtor(url);
    this.#ws = ws;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const snapshotWaiter: Waiter = {
        predicate: (m) => m.type === "sessions_snapshot",
        resolve: () => {
          if (settled) return;
          settled = true;
          resolve();
        },
        reject: (e) => {
          if (settled) return;
          settled = true;
          reject(e);
        },
      };
      this.#waiters.add(snapshotWaiter);

      ws.on("open", () => {
        this.#consumed.add(ticket.value);
      });
      ws.on("message", (data: unknown) => this.#onMessage(data));
      ws.on("error", (err: Error) => {
        if (settled) return;
        this.#waiters.delete(snapshotWaiter);
        settled = true;
        // Server rejects a bad ticket with a 403/401 upgrade → cross-check local
        // state so the caller still gets the distinct ticket error where it applies.
        if (this.#consumed.has(ticket.value) && ws.readyState !== 1) {
          reject(new TicketConsumedError());
        } else if (isTicketExpired(ticket, this.#clock())) {
          reject(new TicketExpiredError());
        } else {
          reject(err);
        }
      });
      ws.on("close", () => {
        this.#failAllWaiters(new BusTimeoutError("socket closed"));
      });
    });
  }

  /** Full connect: discover port → mint ticket → open socket → subscribe. */
  async connect(): Promise<void> {
    const ticket = await this.mintTicket("browser");
    await this.connectWithTicket(ticket);
  }

  // ── Message pump ────────────────────────────────────────────────

  #onMessage(data: unknown): void {
    let msg: ServerToBrowserMessage;
    try {
      const raw =
        typeof data === "string"
          ? data
          : data instanceof Buffer
            ? data.toString("utf8")
            : String(data);
      msg = JSON.parse(raw) as ServerToBrowserMessage;
    } catch {
      return;
    }
    this.#applyState(msg);
    // Snapshot the waiter set — a waiter's resolve may add/remove waiters.
    for (const waiter of [...this.#waiters]) {
      if (!this.#waiters.has(waiter)) continue;
      if (waiter.predicate(msg)) {
        if (waiter.timer) clearTimeout(waiter.timer);
        this.#waiters.delete(waiter);
        waiter.resolve(msg);
      }
    }
  }

  #applyState(msg: ServerToBrowserMessage): void {
    switch (msg.type) {
      case "sessions_snapshot": {
        const snap = msg as SessionsSnapshotMessage;
        this.#sessions = new Map(snap.sessions.map((s) => [s.id, s]));
        break;
      }
      case "session_added": {
        const added = msg as SessionAddedMessage;
        this.#sessions.set(added.session.id, added.session);
        break;
      }
      case "session_updated": {
        const upd = msg as SessionUpdatedMessage;
        const existing = this.#sessions.get(upd.sessionId);
        if (existing) this.#sessions.set(upd.sessionId, { ...existing, ...upd.updates });
        break;
      }
      case "session_removed": {
        const rem = msg as SessionRemovedMessage;
        this.#sessions.delete(rem.sessionId);
        break;
      }
      default:
        break;
    }
  }

  #failAllWaiters(err: Error): void {
    for (const waiter of [...this.#waiters]) {
      if (waiter.timer) clearTimeout(waiter.timer);
      this.#waiters.delete(waiter);
      waiter.reject(err);
    }
  }

  // ── Primitives ──────────────────────────────────────────────────

  /** Send one typed command verbatim over the WS. */
  send<T extends BrowserToServerMessage>(msg: T): void {
    if (!this.#ws || this.#ws.readyState !== 1) {
      throw new Error("bus client not connected");
    }
    this.#ws.send(JSON.stringify(msg));
  }

  /**
   * Resolve on the first event matching `predicate`. Rejects with a
   * `BusTimeoutError` naming `label` if nothing matches within `timeout`.
   */
  waitFor<E extends ServerToBrowserMessage = ServerToBrowserMessage>(
    predicate: (msg: ServerToBrowserMessage) => boolean,
    opts: { timeout?: number; label?: string } = {},
  ): Promise<E> {
    const timeout = opts.timeout ?? DEFAULT_WAIT_TIMEOUT_MS;
    const label = opts.label ?? "event";
    return new Promise<E>((resolve, reject) => {
      const waiter: Waiter = {
        predicate,
        resolve: (m) => resolve(m as E),
        reject,
      };
      waiter.timer = setTimeout(() => {
        this.#waiters.delete(waiter);
        reject(new BusTimeoutError(`timed out after ${timeout}ms waiting for ${label}`));
      }, timeout);
      this.#waiters.add(waiter);
    });
  }

  /** Typed structural await: resolve on the first message matching all keys in `pattern`. */
  await<E extends ServerToBrowserMessage>(
    pattern: Partial<E> & { type: E["type"] },
    opts: { timeout?: number } = {},
  ): Promise<E> {
    return this.waitFor<E>(
      (m) =>
        Object.entries(pattern).every(
          ([k, v]) => (m as unknown as Record<string, unknown>)[k] === v,
        ),
      { timeout: opts.timeout, label: `event ${String(pattern.type)}` },
    );
  }

  /**
   * Structural wait: resolve when `sessionId` reaches `status` on the stream.
   * Keyed by session id so concurrent sessions never cross. Resolves
   * immediately if the session is already at the target status.
   */
  until(
    sessionId: string,
    status: SessionStatus,
    opts: { timeout?: number } = {},
  ): Promise<void> {
    const current = this.#sessions.get(sessionId);
    if (current?.status === status) return Promise.resolve();
    return this.waitFor(
      (m) => {
        if (m.type === "session_added" && (m as SessionAddedMessage).session.id === sessionId) {
          return (m as SessionAddedMessage).session.status === status;
        }
        if (m.type === "session_updated" && (m as SessionUpdatedMessage).sessionId === sessionId) {
          return (m as SessionUpdatedMessage).updates.status === status;
        }
        return false;
      },
      { timeout: opts.timeout, label: `session ${sessionId} → ${status}` },
    ).then(() => undefined);
  }

  /**
   * Spawn a session, exact-correlated on `spawnRequestId`. Resolves with its id.
   *
   * Exact correlation requires the server's **headless** spawn strategy (the
   * dashboard/electron default), which echoes the client-minted `requestId` as
   * `session_added.spawnRequestId`. The `tmux` strategy does NOT echo it (and
   * registers with an empty cwd first), so exact correlation is unavailable
   * there — the wait falls through to its timeout. A failed spawn is surfaced
   * immediately from `spawn_result` rather than waiting out the timeout.
   */
  async spawn(opts: SpawnOptions): Promise<string> {
    const requestId = crypto.randomUUID();
    const added = this.waitFor<SessionAddedMessage>(
      (m) => m.type === "session_added" && (m as SessionAddedMessage).spawnRequestId === requestId,
      { timeout: opts.timeout, label: `spawn(${opts.cwd})` },
    );
    const result = this.waitFor<SpawnResultBrowserMessage>(
      (m) => m.type === "spawn_result" && (m as SpawnResultBrowserMessage).requestId === requestId,
      { timeout: opts.timeout, label: `spawn(${opts.cwd})` },
    );
    this.send({
      type: "spawn_session",
      cwd: opts.cwd,
      requestId,
      ...(opts.attachProposal ? { attachProposal: opts.attachProposal } : {}),
      ...(opts.gitWorktreeBase ? { gitWorktreeBase: opts.gitWorktreeBase } : {}),
      ...(opts.initialPrompt ? { initialPrompt: opts.initialPrompt } : {}),
    });
    // Fail fast on an explicit spawn failure; otherwise the exact-correlated
    // session_added resolves the id (headless strategy).
    const res = await result;
    if (!res.success) {
      added.catch(() => {}); // avoid an unhandled rejection when we bail early
      throw new Error(`spawn failed: ${res.message}${res.code ? ` (${res.code})` : ""}`);
    }
    return (await added).session.id;
  }

  /** Resume/fork a session, exact-correlated on `resume_result.requestId`. */
  async resume(opts: ResumeOptions): Promise<string> {
    const requestId = crypto.randomUUID();
    const result = this.waitFor<ResumeResultBrowserMessage>(
      (m) =>
        m.type === "resume_result" &&
        (m as ResumeResultBrowserMessage).requestId === requestId,
      { timeout: opts.timeout, label: `resume(${opts.sessionId})` },
    );
    this.send({
      type: "resume_session",
      sessionId: opts.sessionId,
      mode: opts.mode,
      requestId,
      ...(opts.entryId ? { entryId: opts.entryId } : {}),
      ...(opts.placement ? { placement: opts.placement } : {}),
    });
    const res = await result;
    if (!res.success) {
      throw new Error(`resume failed: ${res.message}`);
    }
    return res.newSessionId ?? res.sessionId;
  }

  /** Send a prompt to a session (no correlation id in the protocol). */
  prompt(
    sessionId: string,
    text: string,
    opts: { delivery?: "steer" | "followUp" } = {},
  ): void {
    this.send({
      type: "send_prompt",
      sessionId,
      text,
      ...(opts.delivery ? { delivery: opts.delivery } : {}),
    });
  }

  /**
   * Emit a `plugin_action`. Only pluginIds with a working server-side handler
   * (`KNOWN_PLUGIN_HANDLERS`: goal, flows, kb, automation) are allowed; others
   * throw `NoPluginHandlerError` rather than silently dropping the message. The
   * server fans out by pluginId (change: fix-plugin-action-fanout-and-handlers),
   * so an unknown pluginId that slips past this guard yields a structured
   * `plugin_action_error` from the gateway.
   */
  plugin(
    pluginId: string,
    action: string,
    payload?: Record<string, unknown>,
    opts: { sessionId?: string | null } = {},
  ): void {
    if (!KNOWN_PLUGIN_HANDLERS.includes(pluginId)) {
      throw new NoPluginHandlerError(pluginId);
    }
    this.send({
      type: "plugin_action",
      pluginId,
      sessionId: opts.sessionId ?? null,
      action,
      ...(payload ? { payload } : {}),
    });
  }

  // ── Bus-consistent reads (snapshot + deltas; metadata only) ──────

  readonly read = {
    sessions: (): DashboardSession[] => [...this.#sessions.values()],
    session: (id: string): DashboardSession | undefined => this.#sessions.get(id),
  };

  close(): void {
    this.#failAllWaiters(new BusTimeoutError("client closed"));
    this.#ws?.close();
    this.#ws = null;
  }
}
