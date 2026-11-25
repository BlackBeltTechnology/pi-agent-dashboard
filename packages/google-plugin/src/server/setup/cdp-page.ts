/**
 * Minimal CDP client for the setup run: one browser-level WebSocket (no
 * `Origin` header — the dedicated proxy refuses one), one flattened session per
 * page, and the handful of page operations the recipe needs. It never logs and
 * never puts a protocol payload into an error: a failure is
 * `CdpError("<method>")` only, because payloads can hold page text, including
 * the client secret. See change: add-gmail-auto-setup.
 */
import WebSocket from "ws";

/** The slice of `ws`'s `WebSocket` the client uses (a fake in tests). */
export interface WsLike {
  send(data: string): void;
  close(): void;
  on(event: "open" | "close" | "error", cb: () => void): unknown;
  on(event: "message", cb: (data: unknown) => void): unknown;
}
export type WsFactory = (url: string) => WsLike;

/** No `origin` option → ws sends no Origin header. */
export const defaultWsFactory: WsFactory = (url) =>
  new WebSocket(url, { perMessageDeflate: false, handshakeTimeout: 10_000 }) as unknown as WsLike;

export class CdpError extends Error {
  readonly method: string;
  readonly code?: number;
  constructor(method: string, code?: number) {
    super(`cdp ${method} failed`);
    this.name = "CdpError";
    this.method = method;
    this.code = code;
  }
}

/** `Page.navigate` refused (deny set, allowed domains) or failed at the network layer. */
export class NavigationError extends Error {
  constructor() {
    super("navigation failed");
    this.name = "NavigationError";
  }
}

export interface CdpEvent {
  method: string;
  params?: Record<string, unknown>;
  sessionId?: string;
}

interface Pending {
  method: string;
  resolve(v: unknown): void;
  reject(e: unknown): void;
}

export class CdpConnection {
  private nextId = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly eventListeners = new Set<(ev: CdpEvent) => void>();
  private readonly closeListeners = new Set<() => void>();
  closed = false;

  private readonly ws: WsLike;

  private constructor(ws: WsLike) {
    this.ws = ws;
    ws.on("message", (data) => this.onMessage(data));
    ws.on("close", () => this.onClosed());
    ws.on("error", () => undefined); // a failing socket also emits "close"
  }

  static connect(url: string, factory: WsFactory = defaultWsFactory): Promise<CdpConnection> {
    return new Promise((resolve, reject) => {
      const ws = factory(url);
      ws.on("open", () => resolve(new CdpConnection(ws)));
      ws.on("error", () => reject(new CdpError("connect")));
      ws.on("close", () => reject(new CdpError("connect")));
    });
  }

  send<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<T> {
    if (this.closed) return Promise.reject(new CdpError(method));
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { method, resolve: resolve as (v: unknown) => void, reject });
      try {
        this.ws.send(JSON.stringify({ id, method, params, sessionId }));
      } catch {
        this.pending.delete(id);
        reject(new CdpError(method));
      }
    });
  }

  onEvent(cb: (ev: CdpEvent) => void): void {
    this.eventListeners.add(cb);
  }

  onClose(cb: () => void): void {
    this.closeListeners.add(cb);
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      /* already closed */
    }
  }

  private onMessage(data: unknown): void {
    let msg: { id?: number; result?: unknown; error?: { code?: number }; method?: string; params?: Record<string, unknown>; sessionId?: string };
    try {
      msg = JSON.parse(typeof data === "string" ? data : String(data));
    } catch {
      return;
    }
    if (typeof msg.id === "number") {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new CdpError(p.method, msg.error.code));
      else p.resolve(msg.result ?? {});
      return;
    }
    if (typeof msg.method === "string") {
      const ev: CdpEvent = { method: msg.method, params: msg.params, sessionId: msg.sessionId };
      for (const l of this.eventListeners) l(ev);
    }
  }

  private onClosed(): void {
    if (this.closed) return;
    this.closed = true;
    for (const [, p] of this.pending) p.reject(new CdpError(p.method));
    this.pending.clear();
    for (const l of this.closeListeners) l();
  }
}

/** Fixed page expressions; nothing user-controlled is ever interpolated. */
export const EXPR = {
  /** Cheap keep-alive. */
  ping: "1",
  info: "({href:location.href,lang:document.documentElement.lang,ready:document.readyState})",
  text: "document.body?document.body.innerText:''",
  dialogText: "(document.querySelector('[role=dialog]')||{innerText:''}).innerText",
} as const;

export interface PageInfo {
  href: string;
  lang: string;
  ready: string;
}

export interface AxNode {
  backendNodeId: number;
  role: string;
  name: string;
  checked?: boolean;
  disabled?: boolean;
}

interface RawAxNode {
  ignored?: boolean;
  role?: { value?: string };
  name?: { value?: string };
  backendDOMNodeId?: number;
  properties?: Array<{ name: string; value?: { value?: unknown } }>;
}

const SIGN_IN_PATTERN = {
  urlPattern: "https://accounts.google.com/*",
  resourceType: "Document",
  requestStage: "Request",
};

export class CdpPage {
  private readonly conn: CdpConnection;
  private readonly sessionId: string;
  private readonly targetId: string;

  private constructor(conn: CdpConnection, sessionId: string, targetId: string) {
    this.conn = conn;
    this.sessionId = sessionId;
    this.targetId = targetId;
  }

  /**
   * Open the run's own tab (the proxy forces it into the ephemeral context) and
   * arm the redirect guard: a top-level `https://accounts.google.com/*` request
   * is failed BEFORE it renders and `onSignInBlocked` fires, so this tab never
   * shows a password form.
   */
  static async open(conn: CdpConnection, opts: { onSignInBlocked(): void }): Promise<CdpPage> {
    const { targetId } = await conn.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await conn.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
    conn.onEvent((ev) => {
      if (ev.sessionId !== sessionId || ev.method !== "Fetch.requestPaused") return;
      const requestId = ev.params?.requestId;
      if (typeof requestId === "string") {
        conn.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }, sessionId).catch(() => undefined);
      }
      opts.onSignInBlocked();
    });
    // Guard first: nothing may load before the pattern is armed.
    await conn.send("Fetch.enable", { patterns: [SIGN_IN_PATTERN] }, sessionId);
    await conn.send("Page.enable", {}, sessionId);
    await conn.send("DOM.enable", {}, sessionId);
    await conn.send("Accessibility.enable", {}, sessionId);
    return new CdpPage(conn, sessionId, targetId);
  }

  private send<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>): Promise<T> {
    return this.conn.send<T>(method, params, this.sessionId);
  }

  async navigate(url: string): Promise<void> {
    let res: { errorText?: string };
    try {
      res = await this.send<{ errorText?: string }>("Page.navigate", { url });
    } catch {
      throw new NavigationError();
    }
    if (res.errorText) throw new NavigationError();
  }

  async evaluate<T = unknown>(expression: string): Promise<T> {
    const res = await this.send<{ result?: { value?: T }; exceptionDetails?: unknown }>("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) throw new CdpError("Runtime.evaluate");
    return res.result?.value as T;
  }

  info(): Promise<PageInfo> {
    return this.evaluate<PageInfo>(EXPR.info);
  }

  async text(): Promise<string> {
    return String((await this.evaluate<string>(EXPR.text)) ?? "");
  }

  async dialogText(): Promise<string> {
    return String((await this.evaluate<string>(EXPR.dialogText)) ?? "");
  }

  async ping(): Promise<void> {
    await this.evaluate(EXPR.ping);
  }

  /** First non-ignored AX node with exactly this role and accessible name. */
  async queryAXTree(role: string, name: string): Promise<AxNode | undefined> {
    const { root } = await this.send<{ root: { nodeId: number } }>("DOM.getDocument", { depth: 0 });
    const { nodes } = await this.send<{ nodes?: RawAxNode[] }>("Accessibility.queryAXTree", {
      nodeId: root.nodeId,
      accessibleName: name,
      role,
    });
    const raw = (nodes ?? []).find((n) => !n.ignored && typeof n.backendDOMNodeId === "number");
    if (!raw || typeof raw.backendDOMNodeId !== "number") return undefined;
    const prop = (n: string) => raw.properties?.find((p) => p.name === n)?.value?.value;
    const checked = prop("checked");
    return {
      backendNodeId: raw.backendDOMNodeId,
      role: raw.role?.value ?? role,
      name: raw.name?.value ?? name,
      checked: checked === undefined ? undefined : checked === true || checked === "true",
      disabled: prop("disabled") === true,
    };
  }

  /** Click the centre of the node's content box. */
  async clickNode(node: AxNode): Promise<void> {
    await this.send("DOM.scrollIntoViewIfNeeded", { backendNodeId: node.backendNodeId }).catch(() => undefined);
    const { model } = await this.send<{ model: { content: number[] } }>("DOM.getBoxModel", {
      backendNodeId: node.backendNodeId,
    });
    const q = model.content;
    const x = (q[0]! + q[2]! + q[4]! + q[6]!) / 4;
    const y = (q[1]! + q[3]! + q[5]! + q[7]!) / 4;
    const base = { x, y, button: "left", clickCount: 1 };
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", ...base });
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...base });
  }

  /** Focus + select the field, then insert `text` (replaces the content). */
  async fill(node: AxNode, text: string): Promise<void> {
    const { object } = await this.send<{ object: { objectId: string } }>("DOM.resolveNode", {
      backendNodeId: node.backendNodeId,
    });
    await this.send("Runtime.callFunctionOn", {
      objectId: object.objectId,
      functionDeclaration: "function(){this.focus();if(this.select)this.select();}",
    });
    await this.send("Input.insertText", { text });
  }

  async bringToFront(): Promise<void> {
    await this.send("Page.bringToFront");
  }

  /** Best effort; the ephemeral context is discarded on disconnect anyway. */
  async close(): Promise<void> {
    await this.conn.send("Target.closeTarget", { targetId: this.targetId }).catch(() => undefined);
  }
}
