/**
 * Screencast-tap adapter for the dedicated instance (change:
 * add-dedicated-agent-browser, D4, task 3.4).
 *
 * `ScreencastTap` wants `sessionIdForTab(tabId)` (synchronous) and
 * `sendToTab(sessionId, method, params)`. The relay answers them from the
 * extension's single debugger session; here every tapped tab gets its OWN
 * server-owned flattened session (`Target.attachToTarget`), so frames never reach
 * the agent client and the tap never shares a session with it.
 *
 * Because `sessionIdForTab` is synchronous and the attach is not, the tap is
 * handed a stable SYNTHETIC id (`tap:<targetId>`); `sendToTab` resolves it to
 * the real Chrome session, attaching lazily on first use. Chrome's events for a
 * real tap session are routed back with `onSessionEvent`, which re-addresses
 * them to the synthetic id. A tap session is never client-addressable.
 */

const SYNTHETIC_PREFIX = "tap:";

export interface TapAdapterDeps {
  /** The visible target behind a numeric tab id, when it has a live server session. */
  targetForTab(tabId: number): string | undefined;
  /** One command over the pipe (resolves with the CDP result). */
  call(method: string, params: object | undefined, sessionId?: string): Promise<unknown>;
  /** Consume a tap-session event addressed by synthetic id; true = consumed. */
  onEvent(syntheticSessionId: string, method: string, params: unknown): boolean;
}

export class TapAdapter {
  private readonly deps: TapAdapterDeps;
  /** targetId → real session id (attached). */
  private readonly realByTarget = new Map<string, string>();
  private readonly targetByReal = new Map<string, string>();
  private readonly attaching = new Map<string, Promise<string>>();
  /** targetIds whose next browser-level `attachedToTarget` is OUR tap attach. */
  private readonly expectedAttach = new Set<string>();
  private closed = false;

  constructor(deps: TapAdapterDeps) {
    this.deps = deps;
  }

  /** `ScreencastTapDeps.sessionIdForTab`. */
  sessionIdForTab(tabId: number): string | undefined {
    const targetId = this.deps.targetForTab(tabId);
    return targetId === undefined ? undefined : `${SYNTHETIC_PREFIX}${targetId}`;
  }

  /** `ScreencastTapDeps.sendToTab`. Sends synchronously when the session is already attached. */
  sendToTab(syntheticSessionId: string, method: string, params: unknown): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("dedicated instance closed"));
    if (!syntheticSessionId.startsWith(SYNTHETIC_PREFIX)) return Promise.reject(new Error("not a tap session"));
    const targetId = syntheticSessionId.slice(SYNTHETIC_PREFIX.length);
    const real = this.realByTarget.get(targetId);
    const body = (params ?? undefined) as object | undefined;
    if (real !== undefined) return this.deps.call(method, body, real);
    return this.ensureSession(targetId).then((sessionId) => this.deps.call(method, body, sessionId));
  }

  private ensureSession(targetId: string): Promise<string> {
    const pending = this.attaching.get(targetId);
    if (pending) return pending;
    this.expectedAttach.add(targetId);
    const attach = this.deps
      .call("Target.attachToTarget", { targetId, flatten: true })
      .then((result) => {
        const sessionId = (result as { sessionId?: unknown } | undefined)?.sessionId;
        if (typeof sessionId !== "string") throw new Error("Target.attachToTarget returned no sessionId");
        this.register(sessionId, targetId);
        return sessionId;
      })
      .finally(() => {
        this.attaching.delete(targetId);
        this.expectedAttach.delete(targetId);
      });
    this.attaching.set(targetId, attach);
    return attach;
  }

  private register(sessionId: string, targetId: string): void {
    this.realByTarget.set(targetId, sessionId);
    this.targetByReal.set(sessionId, targetId);
  }

  /**
   * Browser-level `Target.attachedToTarget`: Chrome announces our tap attach
   * before replying to it. True = it was ours (the instance must not treat it as
   * an auto-attached page session).
   */
  claimAttach(sessionId: string, targetId: string): boolean {
    if (!this.expectedAttach.has(targetId)) return false;
    this.register(sessionId, targetId);
    return true;
  }

  isTapSession(sessionId: string): boolean {
    return this.targetByReal.has(sessionId);
  }

  /** An event on a real tap session. */
  onSessionEvent(sessionId: string, method: string, params: unknown): void {
    const targetId = this.targetByReal.get(sessionId);
    if (targetId === undefined) return;
    this.deps.onEvent(`${SYNTHETIC_PREFIX}${targetId}`, method, params);
  }

  /** Chrome detached a session (target gone). True = it was a tap session. */
  onDetached(sessionId: string): boolean {
    const targetId = this.targetByReal.get(sessionId);
    if (targetId === undefined) return false;
    this.targetByReal.delete(sessionId);
    this.realByTarget.delete(targetId);
    return true;
  }

  /** Real session ids still attached (the instance detaches them on close). */
  realSessions(): string[] {
    return [...this.targetByReal.keys()];
  }

  /** After this, `sendToTab` rejects. Call after `ScreencastTap.closeAll()`. */
  close(): void {
    this.closed = true;
  }
}
