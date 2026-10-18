/**
 * `browser/open` — the plugin-server end of the `browser_show_in_pane` /
 * `browser_await_human` bridge tools (change: add-browser-editor-pane-tab, D5).
 *
 * The caller's `sessionId` comes ONLY from the request lane's `meta` (the
 * bridge socket key) — never from the payload — so an agent cannot open a tab
 * in another session's pane. The handler resolves the tab, asks the host to
 * broadcast `editor_tab_open` through `ctx.openEditorTab` (own prefix only),
 * rate-limits `show` (not `takeover`), and audits EVERY call as kind `open`.
 */
import type { AuditRing } from "./audit.js";
import { isRelayConnectPage } from "./redact.js";
import type { RelayLike } from "./relay/relay-manager.js";

/** One accepted `show` per (session, instance) per window. */
export const OPEN_RATE_LIMIT_MS = 5000;

type OpenKind = "show" | "takeover";

export interface OpenHandlerDeps {
  manager: { readonly enabled: boolean; find(instanceId: string): RelayLike | undefined };
  audit: AuditRing;
  openEditorTab(sessionId: string, path: string): void;
  now?: () => number;
}

export interface OpenResult {
  path: string;
  instanceId: string;
  tabId: number;
}

export class OpenHandler {
  private readonly deps: OpenHandlerDeps;
  /** `${sessionId}\0${instanceId}` → time of the last ACCEPTED `show`. */
  private readonly lastShow = new Map<string, number>();
  private readonly now: () => number;

  constructor(deps: OpenHandlerDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
  }

  /** Live limiter entries (bounded by live (session, instance) pairs). */
  get limiterSize(): number {
    return this.lastShow.size;
  }

  /** Drop every limiter entry of a closed instance. */
  onInstanceClosed(instanceId: string): void {
    for (const key of [...this.lastShow.keys()]) {
      if (key.endsWith(`\0${instanceId}`)) this.lastShow.delete(key);
    }
  }

  /** Lane handler: returns the opened path or THROWS an Error naming the cause. */
  handle = (payload: unknown, meta: { sessionId: string }): OpenResult => this._open(payload, meta.sessionId, false);

  /**
   * Live view on connect (D7): open `tabId` of `instanceId` for `sessionId` as an
   * agent-initiated `show` that is EXEMPT from the 5 s limiter (it neither checks
   * nor consumes it, so a following `browser_show_in_pane` is not limited by it)
   * and audits `open` with detail exactly `auto` (spec: browser-relay). A separate method, not
   * a payload flag: the lane can never request the exemption.
   * See change: add-dedicated-agent-browser.
   */
  openAuto(sessionId: string, instanceId: string, tabId: number): OpenResult {
    return this._open({ instanceId, tabId, kind: "show" }, sessionId, true);
  }

  private _open(payload: unknown, sessionId: string, auto: boolean): OpenResult {
    const meta = { sessionId };
    const p = (typeof payload === "object" && payload !== null ? payload : {}) as {
      instanceId?: unknown;
      tabId?: unknown;
      kind?: unknown;
    };
    const kind: OpenKind = p.kind === "takeover" ? "takeover" : "show";
    const label = auto ? "auto" : kind;
    const instanceId = typeof p.instanceId === "string" ? p.instanceId.slice(0, 128) : "";
    const refuse = (reason: string, profile = "unknown", tab?: number): never => {
      this.deps.audit.append({
        profileDirectory: profile,
        instanceId: instanceId || "unknown",
        kind: "open",
        detail: `${label} refused reason:${reason}${tab !== undefined ? ` tab:${tab}` : ""}`,
      });
      throw new Error(reason);
    };

    if (!this.deps.manager.enabled) return refuse("disabled");
    const inst = instanceId ? this.deps.manager.find(instanceId) : undefined;
    if (!inst) return refuse("unknown-instance");

    const tabs = inst.tabList().filter((t) => !isRelayConnectPage(t.url));
    let tabId: number;
    if (p.tabId === undefined) {
      const last = tabs[tabs.length - 1];
      if (!last) return refuse("no-tab", inst.profileDirectory);
      tabId = last.tabId;
    } else {
      if (typeof p.tabId !== "number" || !Number.isInteger(p.tabId) || !tabs.some((t) => t.tabId === p.tabId)) {
        return refuse("unknown-tab", inst.profileDirectory, typeof p.tabId === "number" ? p.tabId : undefined);
      }
      tabId = p.tabId;
    }

    const t = this.now();
    this._prune(t);
    if (kind === "show" && !auto) {
      const key = `${meta.sessionId}\0${instanceId}`;
      const last = this.lastShow.get(key);
      if (last !== undefined && t - last < OPEN_RATE_LIMIT_MS) return refuse("rate-limited", inst.profileDirectory, tabId);
      this.lastShow.set(key, t);
    }

    const path = `browser:${instanceId}:${tabId}`;
    try {
      this.deps.openEditorTab(meta.sessionId, path);
    } catch (err) {
      if (kind === "show" && !auto) this.lastShow.delete(`${meta.sessionId}\0${instanceId}`);
      return refuse(`host-refused:${(err as Error).message.slice(0, 80)}`, inst.profileDirectory, tabId);
    }
    this.deps.audit.append({
      profileDirectory: inst.profileDirectory,
      instanceId,
      kind: "open",
      detail: auto ? "auto" : `${label} accepted tab:${tabId}`,
    });
    return { path, instanceId, tabId };
  }

  private _prune(t: number): void {
    for (const [key, ts] of this.lastShow) if (t - ts >= OPEN_RATE_LIMIT_MS) this.lastShow.delete(key);
  }
}
